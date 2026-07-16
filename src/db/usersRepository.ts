import type { SezzAccountsDatabase, UserRow } from "./schema";
import { db as defaultDb } from "./schema";
import type { User, NewUser, UserUpdate } from "@/types/models";
import { generateId } from "@/lib/id";
import { hashNewPassword, verifyPassword } from "@/lib/passwordHash";
import { ROLE_DEFAULT_PERMISSIONS } from "@/lib/permissions";
import { ValidationError, NotFoundError, AuthenticationError } from "@/lib/errors";
import { generateSalt, generateDekBytes, wrapDek, unwrapDek } from "@/lib/encryption";
import { setActiveDek, requireActiveDek } from "@/lib/encryptionSession";
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

  return {
    /** The very first user ever created is always forced to full admin
     * permissions, regardless of what role/permissions were requested —
     * otherwise a mistake on the first run could lock the app's own
     * administration away with nobody able to fix it. This first user also
     * generates the one shared Data Encryption Key that will protect every
     * account/transaction/etc. from now on; every subsequent user gets
     * their own wrapped copy of that same key (see src/lib/encryption.ts). */
    async create(input: NewUser): Promise<User> {
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

      const now = Date.now();
      const user: User = {
        id: generateId(),
        username,
        displayName,
        passwordHash: hash,
        passwordSalt: salt,
        wrappedDek,
        dekSalt,
        role,
        permissions,
        createdAt: now,
        updatedAt: now,
      };
      await database.users.add(await toStorageRow(user, SENSITIVE_USER_FIELDS));
      return user;
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
     * new password, so no data becomes unreadable by changing it. */
    async changePassword(id: string, currentPassword: string, newPassword: string): Promise<void> {
      const row = (await database.users.get(id)) as UserRow | undefined;
      if (!row) throw new NotFoundError("Utilisateur", id);
      const existing = await decryptUser(row);

      const isCorrect = await verifyPassword(currentPassword, {
        hash: existing.passwordHash,
        salt: existing.passwordSalt,
      });
      if (!isCorrect) throw new AuthenticationError("Mot de passe actuel incorrect.");
      assertValidPassword(newPassword);

      const dekBytes = await unwrapDek(existing.wrappedDek, currentPassword, existing.dekSalt);
      const { hash, salt } = await hashNewPassword(newPassword);
      const newDekSalt = generateSalt();
      const newWrappedDek = await wrapDek(dekBytes, newPassword, newDekSalt);

      await database.users.put(
        await toStorageRow(
          {
            ...existing,
            passwordHash: hash,
            passwordSalt: salt,
            wrappedDek: newWrappedDek,
            dekSalt: newDekSalt,
            updatedAt: Date.now(),
          },
          SENSITIVE_USER_FIELDS,
        ),
      );
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
      const existing = await decryptUser(row);

      assertValidPassword(newPassword);
      const dekBytes = requireActiveDek();
      const { hash, salt } = await hashNewPassword(newPassword);
      const newDekSalt = generateSalt();
      const newWrappedDek = await wrapDek(dekBytes, newPassword, newDekSalt);

      await database.users.put(
        await toStorageRow(
          {
            ...existing,
            passwordHash: hash,
            passwordSalt: salt,
            wrappedDek: newWrappedDek,
            dekSalt: newDekSalt,
            updatedAt: Date.now(),
          },
          SENSITIVE_USER_FIELDS,
        ),
      );
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
     * unknown username. Returns both the user and the raw DEK bytes so the
     * caller (AuthContext) can activate the encrypted session. */
    async authenticate(
      username: string,
      password: string,
    ): Promise<{ user: User; dek: Uint8Array<ArrayBuffer> }> {
      const row = await getRowByUsername(username);
      if (!row) throw new AuthenticationError();
      const user = await decryptUser(row);

      const isCorrect = await verifyPassword(password, {
        hash: user.passwordHash,
        salt: user.passwordSalt,
      });
      if (!isCorrect) throw new AuthenticationError();

      let dek: Uint8Array<ArrayBuffer>;
      try {
        dek = await unwrapDek(user.wrappedDek, password, user.dekSalt);
      } catch {
        // password hash matched but the DEK failed to unwrap — should not
        // normally happen, but surfacing it as the same generic auth error
        // is safer than a confusing crypto-specific message to the user.
        throw new AuthenticationError();
      }
      return { user, dek };
    },
  };
}

export type UsersRepository = ReturnType<typeof createUsersRepository>;
