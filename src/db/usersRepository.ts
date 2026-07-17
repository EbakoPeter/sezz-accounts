import type { SezzAccountsDatabase, UserRow } from "./schema";
import { db as defaultDb } from "./schema";
import type { User, NewUser, UserUpdate } from "@/types/models";
import { generateId } from "@/lib/id";
import { hashNewPassword, verifyPassword } from "@/lib/passwordHash";
import { ROLE_DEFAULT_PERMISSIONS } from "@/lib/permissions";
import {
  ValidationError,
  NotFoundError,
  AuthenticationError,
  AccountLockedError,
} from "@/lib/errors";
import { generateSalt, generateDekBytes, wrapDek, unwrapDek } from "@/lib/encryption";
import { setActiveDek, requireActiveDek } from "@/lib/encryptionSession";
import { generateRecoveryCode, normalizeRecoveryCode } from "@/lib/recoveryCode";
import { computeLockoutDurationMs, remainingLockoutMs } from "@/lib/loginRateLimit";
import { toStorageRow, fromStorageRow, fromStorageRows } from "./encryptedRecord";

const MIN_PASSWORD_LENGTH = 4;
const SENSITIVE_USER_FIELDS = ["displayName"] as const;

function assertValidUsername(username: string): string {
  const trimmed = username.trim();
  if (trimmed.length === 0) {
    throw new ValidationError("Le nom d'utilisateur est obligatoire.");
  }
  return trimmed;
}

function assertValidDisplayName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new ValidationError("Le nom affiché est obligatoire.");
  }
  return trimmed;
}

function assertValidPassword(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new ValidationError(
      `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères.`,
    );
  }
}

export function createUsersRepository(database: SezzAccountsDatabase = defaultDb) {
  async function decryptUser(row: UserRow): Promise<User> {
    return fromStorageRow<User>(row);
  }
  async function decryptUsers(rows: UserRow[]): Promise<User[]> {
    return fromStorageRows<User>(rows);
  }

  async function getRowByUsername(username: string): Promise<UserRow | undefined> {
    return (await database.users.where("username").equalsIgnoreCase(username).first()) as
      UserRow | undefined;
  }

  async function assertUsernameIsUnique(username: string, excludeId?: string): Promise<void> {
    const existing = await getRowByUsername(username);
    if (existing && existing.id !== excludeId) {
      throw new ValidationError(`Le nom d'utilisateur « ${username} » est déjà utilisé.`);
    }
  }

  async function countAdmins(excludeId?: string): Promise<number> {
    const all = await decryptUsers((await database.users.toArray()) as UserRow[]);
    return all.filter((u) => u.permissions.manageUsers && u.id !== excludeId).length;
  }

  /** Only ever touches structural (unencrypted) fields — recording a
   * failure must work even when no session/DEK is active at all (a wrong
   * password on a fresh app open is exactly such a case). */
  async function recordFailedAttempt(row: UserRow): Promise<void> {
    const failedLoginAttempts = row.failedLoginAttempts + 1;
    const lockoutDuration = computeLockoutDurationMs(failedLoginAttempts);
    const next: UserRow = {
      ...row,
      failedLoginAttempts,
      updatedAt: Date.now(),
      ...(lockoutDuration > 0 ? { lockedUntil: Date.now() + lockoutDuration } : {}),
    };
    await database.users.put(next);
  }

  /** Clears the failure counter/lockout on a successful attempt. Returns
   * the (possibly updated) row so callers don't need a second read. */
  async function resetAttempts(row: UserRow): Promise<UserRow> {
    if (row.failedLoginAttempts === 0 && row.lockedUntil === undefined) return row;
    const { lockedUntil: _removed, ...rest } = row;
    const next: UserRow = { ...rest, failedLoginAttempts: 0, updatedAt: Date.now() };
    await database.users.put(next);
    return next;
  }

  function assertNotLocked(row: UserRow): void {
    const remaining = remainingLockoutMs(row.lockedUntil, Date.now());
    if (remaining > 0) throw new AccountLockedError(remaining);
  }

  return {
    /** The very first user ever created is always forced to full admin
     * permissions, regardless of what role/permissions were requested —
     * otherwise a mistake on the first run could lock the app's own
     * administration away with nobody able to fix it. This first user also
     * generates the one shared Data Encryption Key that will protect every
     * account/transaction/etc. from now on; every subsequent user gets
     * their own wrapped copy of that same key (see src/lib/encryption.ts).
     *
     * Also generates this user's one-time recovery code, wrapping a second
     * independent copy of the same DEK under it. The plaintext code is
     * returned so the caller can show it to the person exactly once — it
     * is never stored anywhere, only a hash (for quick verification, like
     * a password) and the wrapped DEK (to actually recover access). */
    async create(input: NewUser): Promise<{ user: User; recoveryCode: string }> {
      const username = assertValidUsername(input.username);
      const displayName = assertValidDisplayName(input.displayName);
      assertValidPassword(input.password);
      await assertUsernameIsUnique(username);

      const isFirstUser = (await database.users.count()) === 0;
      const role = isFirstUser ? "admin" : input.role;
      const permissions = isFirstUser
        ? ROLE_DEFAULT_PERMISSIONS.admin
        : (input.permissions ?? ROLE_DEFAULT_PERMISSIONS[input.role]);

      const { hash, salt } = await hashNewPassword(input.password);

      const dekSalt = generateSalt();
      let dekBytes;
      if (isFirstUser) {
        dekBytes = generateDekBytes();
        // Must happen before toStorageRow() below: encrypting this very
        // first user's own sensitive fields (displayName) requires an
        // active session already, and this user's creation is what
        // establishes that session in the first place.
        setActiveDek(dekBytes);
      } else {
        // Not the first user: an already-authenticated admin (holding the
        // shared DEK in their own session) is creating this account. Their
        // active DEK is exactly the one this new user needs a copy of.
        dekBytes = requireActiveDek();
      }
      const wrappedDek = await wrapDek(dekBytes, input.password, dekSalt);

      const recoveryCode = generateRecoveryCode();
      const normalizedRecoveryCode = normalizeRecoveryCode(recoveryCode);
      const { hash: recoveryCodeHash, salt: recoveryCodeSalt } =
        await hashNewPassword(normalizedRecoveryCode);
      const recoveryDekSalt = generateSalt();
      const wrappedDekByRecoveryCode = await wrapDek(
        dekBytes,
        normalizedRecoveryCode,
        recoveryDekSalt,
      );

      const now = Date.now();
      const user: User = {
        id: generateId(),
        username,
        displayName,
        passwordHash: hash,
        passwordSalt: salt,
        wrappedDek,
        dekSalt,
        recoveryCodeHash,
        recoveryCodeSalt,
        wrappedDekByRecoveryCode,
        recoveryDekSalt,
        failedLoginAttempts: 0,
        role,
        permissions,
        createdAt: now,
        updatedAt: now,
      };
      await database.users.add(await toStorageRow(user, SENSITIVE_USER_FIELDS));
      return { user, recoveryCode };
    },

    async list(): Promise<User[]> {
      const rows = (await database.users.toArray()) as UserRow[];
      const users = await decryptUsers(rows);
      return users.sort((a, b) => a.username.localeCompare(b.username));
    },

    async getById(id: string): Promise<User | undefined> {
      const row = (await database.users.get(id)) as UserRow | undefined;
      return row ? decryptUser(row) : undefined;
    },

    async getByUsername(username: string): Promise<User | undefined> {
      const row = await getRowByUsername(username);
      return row ? decryptUser(row) : undefined;
    },

    async update(id: string, patch: UserUpdate): Promise<User> {
      const row = (await database.users.get(id)) as UserRow | undefined;
      if (!row) throw new NotFoundError("Utilisateur", id);
      const existing = await decryptUser(row);

      const next: User = { ...existing, updatedAt: Date.now() };
      if (patch.displayName !== undefined) {
        next.displayName = assertValidDisplayName(patch.displayName);
      }
      if (patch.role !== undefined) {
        next.role = patch.role;
        // Changing role resets permissions to that role's defaults unless
        // an explicit permissions object is provided in the same call.
        next.permissions = patch.permissions ?? ROLE_DEFAULT_PERMISSIONS[patch.role];
      } else if (patch.permissions !== undefined) {
        next.permissions = patch.permissions;
      }

      if (existing.permissions.manageUsers && !next.permissions.manageUsers) {
        const remainingAdmins = await countAdmins(id);
        if (remainingAdmins === 0) {
          throw new ValidationError(
            "Impossible de retirer ce privilège : au moins un utilisateur doit pouvoir gérer les utilisateurs.",
          );
        }
      }

      await database.users.put(await toStorageRow(next, SENSITIVE_USER_FIELDS));
      return next;
    },

    /** Requires the current password to be supplied and correct — a
     * password change is never accepted on trust alone, even from code
     * that has already authenticated the user for the current session.
     * Re-wraps this user's copy of the (unchanged) shared DEK under the
     * new password, so no data becomes unreadable by changing it. The
     * recovery code is untouched: it wraps the same DEK independently and
     * remains valid regardless of password changes. */
    async changePassword(id: string, currentPassword: string, newPassword: string): Promise<void> {
      const row = (await database.users.get(id)) as UserRow | undefined;
      if (!row) throw new NotFoundError("Utilisateur", id);

      const isCorrect = await verifyPassword(currentPassword, {
        hash: row.passwordHash,
        salt: row.passwordSalt,
      });
      if (!isCorrect) throw new AuthenticationError("Mot de passe actuel incorrect.");
      assertValidPassword(newPassword);

      const dekBytes = await unwrapDek(row.wrappedDek, currentPassword, row.dekSalt);
      const { hash, salt } = await hashNewPassword(newPassword);
      const newDekSalt = generateSalt();
      const newWrappedDek = await wrapDek(dekBytes, newPassword, newDekSalt);

      await database.users.put({
        ...row,
        passwordHash: hash,
        passwordSalt: salt,
        wrappedDek: newWrappedDek,
        dekSalt: newDekSalt,
        updatedAt: Date.now(),
      });
    },

    /** Resets another user's password without knowing their current one.
     * Deliberately a separate method from `changePassword` (which always
     * requires the current password) — callers are responsible for only
     * exposing this to users with the `manageUsers` permission. Re-wraps
     * the shared DEK from the *caller's own active session* (not from the
     * target's old password, which the caller does not know) under the
     * target's new password. */
    async adminResetPassword(id: string, newPassword: string): Promise<void> {
      const row = (await database.users.get(id)) as UserRow | undefined;
      if (!row) throw new NotFoundError("Utilisateur", id);

      assertValidPassword(newPassword);
      const dekBytes = requireActiveDek();
      const { hash, salt } = await hashNewPassword(newPassword);
      const newDekSalt = generateSalt();
      const newWrappedDek = await wrapDek(dekBytes, newPassword, newDekSalt);

      await database.users.put({
        ...row,
        passwordHash: hash,
        passwordSalt: salt,
        wrappedDek: newWrappedDek,
        dekSalt: newDekSalt,
        updatedAt: Date.now(),
      });
    },

    /** Deletes a user. Refuses if this user is the last one with
     * `manageUsers` permission — the app must never end up with nobody
     * able to administer it. */
    async remove(id: string): Promise<void> {
      const row = (await database.users.get(id)) as UserRow | undefined;
      if (!row) throw new NotFoundError("Utilisateur", id);
      const existing = await decryptUser(row);

      if (existing.permissions.manageUsers) {
        const remainingAdmins = await countAdmins(id);
        if (remainingAdmins === 0) {
          throw new ValidationError(
            "Impossible de supprimer ce compte : c'est le dernier utilisateur pouvant gérer les utilisateurs.",
          );
        }
      }
      await database.users.delete(id);
    },

    /** Looks up a user by username, verifies the password, and unwraps
     * their copy of the shared DEK. Throws AuthenticationError (without
     * indicating which part was wrong) on any failure, including an
     * unknown username. Throws AccountLockedError instead if too many
     * recent failures have locked this account out — checked before any
     * password verification is even attempted. Returns both the user and
     * the raw DEK bytes so the caller (AuthContext) can activate the
     * encrypted session.
     *
     * Order matters here: password verification and DEK unwrapping only
     * ever touch this row's *structural* (unencrypted) fields —
     * passwordHash, passwordSalt, wrappedDek, dekSalt. Decrypting the full
     * user record (to read displayName) requires an active session, which
     * does not exist yet on a genuinely fresh login — so that decryption
     * must happen *after* the DEK is unwrapped and activated, never before. */
    async authenticate(
      username: string,
      password: string,
    ): Promise<{ user: User; dek: Uint8Array<ArrayBuffer> }> {
      const row = await getRowByUsername(username);
      if (!row) throw new AuthenticationError();

      assertNotLocked(row);

      const isCorrect = await verifyPassword(password, {
        hash: row.passwordHash,
        salt: row.passwordSalt,
      });
      if (!isCorrect) {
        await recordFailedAttempt(row);
        throw new AuthenticationError();
      }

      let dek: Uint8Array<ArrayBuffer>;
      try {
        dek = await unwrapDek(row.wrappedDek, password, row.dekSalt);
      } catch {
        // password hash matched but the DEK failed to unwrap — should not
        // normally happen, but surfacing it as the same generic auth error
        // is safer than a confusing crypto-specific message to the user.
        await recordFailedAttempt(row);
        throw new AuthenticationError();
      }

      const freshRow = await resetAttempts(row);
      setActiveDek(dek);
      const user = await decryptUser(freshRow);
      return { user, dek };
    },

    /** Recovers access using the one-time recovery code shown at account
     * creation, in place of a forgotten password. Sets a new password and
     * — since using a recovery code is exactly the situation a security
     * hygiene rule exists for — rotates the recovery code itself, so the
     * one just used cannot be reused. Returns the new code so the caller
     * can show it once, exactly like at account creation. Shares the same
     * lockout counter as `authenticate`: recovery attempts against an
     * account count against it too. */
    async recoverWithCode(
      username: string,
      recoveryCode: string,
      newPassword: string,
    ): Promise<{ user: User; dek: Uint8Array<ArrayBuffer>; recoveryCode: string }> {
      const row = await getRowByUsername(username);
      if (!row) throw new AuthenticationError();

      assertNotLocked(row);
      assertValidPassword(newPassword);

      const normalizedCode = normalizeRecoveryCode(recoveryCode);
      const isCorrect = await verifyPassword(normalizedCode, {
        hash: row.recoveryCodeHash,
        salt: row.recoveryCodeSalt,
      });
      if (!isCorrect) {
        await recordFailedAttempt(row);
        throw new AuthenticationError("Code de récupération incorrect.");
      }

      let dekBytes: Uint8Array<ArrayBuffer>;
      try {
        dekBytes = await unwrapDek(
          row.wrappedDekByRecoveryCode,
          normalizedCode,
          row.recoveryDekSalt,
        );
      } catch {
        await recordFailedAttempt(row);
        throw new AuthenticationError("Code de récupération incorrect.");
      }

      const { hash, salt } = await hashNewPassword(newPassword);
      const newDekSalt = generateSalt();
      const newWrappedDek = await wrapDek(dekBytes, newPassword, newDekSalt);

      const newRecoveryCode = generateRecoveryCode();
      const normalizedNewRecoveryCode = normalizeRecoveryCode(newRecoveryCode);
      const { hash: newRecoveryHash, salt: newRecoverySalt } =
        await hashNewPassword(normalizedNewRecoveryCode);
      const newRecoveryDekSalt = generateSalt();
      const newWrappedDekByRecoveryCode = await wrapDek(
        dekBytes,
        normalizedNewRecoveryCode,
        newRecoveryDekSalt,
      );

      const { lockedUntil: _removed, ...restOfRow } = row;
      const nextRow: UserRow = {
        ...restOfRow,
        passwordHash: hash,
        passwordSalt: salt,
        wrappedDek: newWrappedDek,
        dekSalt: newDekSalt,
        recoveryCodeHash: newRecoveryHash,
        recoveryCodeSalt: newRecoverySalt,
        wrappedDekByRecoveryCode: newWrappedDekByRecoveryCode,
        recoveryDekSalt: newRecoveryDekSalt,
        failedLoginAttempts: 0,
        updatedAt: Date.now(),
      };
      await database.users.put(nextRow);

      setActiveDek(dekBytes);
      const user = await decryptUser(nextRow);
      return { user, dek: dekBytes, recoveryCode: newRecoveryCode };
    },

    /** Generates a fresh recovery code for a user, requiring their current
     * password (this is self-service — unlike adminResetPassword, nobody
     * else can do this on a user's behalf, since it needs the password to
     * unwrap the DEK in the first place). Returns the new plaintext code to
     * show once. The old code stops working immediately. */
    async regenerateRecoveryCode(id: string, currentPassword: string): Promise<string> {
      const row = (await database.users.get(id)) as UserRow | undefined;
      if (!row) throw new NotFoundError("Utilisateur", id);

      const isCorrect = await verifyPassword(currentPassword, {
        hash: row.passwordHash,
        salt: row.passwordSalt,
      });
      if (!isCorrect) throw new AuthenticationError("Mot de passe actuel incorrect.");

      const dekBytes = await unwrapDek(row.wrappedDek, currentPassword, row.dekSalt);

      const newRecoveryCode = generateRecoveryCode();
      const normalizedNewRecoveryCode = normalizeRecoveryCode(newRecoveryCode);
      const { hash, salt } = await hashNewPassword(normalizedNewRecoveryCode);
      const newRecoveryDekSalt = generateSalt();
      const wrappedDekByRecoveryCode = await wrapDek(
        dekBytes,
        normalizedNewRecoveryCode,
        newRecoveryDekSalt,
      );

      await database.users.put({
        ...row,
        recoveryCodeHash: hash,
        recoveryCodeSalt: salt,
        wrappedDekByRecoveryCode,
        recoveryDekSalt: newRecoveryDekSalt,
        updatedAt: Date.now(),
      });

      return newRecoveryCode;
    },
  };
}

export type UsersRepository = ReturnType<typeof createUsersRepository>;
