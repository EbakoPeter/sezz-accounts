import type { SezzAccountsDatabase } from "./schema";
import { db as defaultDb } from "./schema";
import type { User, NewUser, UserUpdate } from "@/types/models";
import { generateId } from "@/lib/id";
import { hashNewPassword, verifyPassword } from "@/lib/passwordHash";
import { ROLE_DEFAULT_PERMISSIONS } from "@/lib/permissions";
import { ValidationError, NotFoundError, AuthenticationError } from "@/lib/errors";

const MIN_PASSWORD_LENGTH = 4;

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
  async function assertUsernameIsUnique(username: string, excludeId?: string): Promise<void> {
    const existing = await database.users.where("username").equalsIgnoreCase(username).first();
    if (existing && existing.id !== excludeId) {
      throw new ValidationError(`Le nom d'utilisateur « ${username} » est déjà utilisé.`);
    }
  }

  async function countAdmins(excludeId?: string): Promise<number> {
    const all = await database.users.toArray();
    return all.filter((u) => u.permissions.manageUsers && u.id !== excludeId).length;
  }

  return {
    /** The very first user ever created is always forced to full admin
     * permissions, regardless of what role/permissions were requested —
     * otherwise a mistake on the first run could lock the app's own
     * administration away with nobody able to fix it. */
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
      const now = Date.now();
      const user: User = {
        id: generateId(),
        username,
        displayName,
        passwordHash: hash,
        passwordSalt: salt,
        role,
        permissions,
        createdAt: now,
        updatedAt: now,
      };
      await database.users.add(user);
      return user;
    },

    async list(): Promise<User[]> {
      return database.users.orderBy("username").toArray();
    },

    async getById(id: string): Promise<User | undefined> {
      return database.users.get(id);
    },

    async getByUsername(username: string): Promise<User | undefined> {
      return database.users.where("username").equalsIgnoreCase(username).first();
    },

    async update(id: string, patch: UserUpdate): Promise<User> {
      const existing = await database.users.get(id);
      if (!existing) throw new NotFoundError("Utilisateur", id);

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

      await database.users.put(next);
      return next;
    },

    /** Requires the current password to be supplied and correct — a
     * password change is never accepted on trust alone, even from code
     * that has already authenticated the user for the current session. */
    async changePassword(id: string, currentPassword: string, newPassword: string): Promise<void> {
      const existing = await database.users.get(id);
      if (!existing) throw new NotFoundError("Utilisateur", id);

      const isCorrect = await verifyPassword(currentPassword, {
        hash: existing.passwordHash,
        salt: existing.passwordSalt,
      });
      if (!isCorrect) throw new AuthenticationError("Mot de passe actuel incorrect.");

      assertValidPassword(newPassword);
      const { hash, salt } = await hashNewPassword(newPassword);
      await database.users.put({
        ...existing,
        passwordHash: hash,
        passwordSalt: salt,
        updatedAt: Date.now(),
      });
    },

    /** Resets another user's password without knowing their current one.
     * Deliberately a separate method from `changePassword` (which always
     * requires the current password) — callers are responsible for only
     * exposing this to users with the `manageUsers` permission. */
    async adminResetPassword(id: string, newPassword: string): Promise<void> {
      const existing = await database.users.get(id);
      if (!existing) throw new NotFoundError("Utilisateur", id);

      assertValidPassword(newPassword);
      const { hash, salt } = await hashNewPassword(newPassword);
      await database.users.put({
        ...existing,
        passwordHash: hash,
        passwordSalt: salt,
        updatedAt: Date.now(),
      });
    },

    /** Deletes a user. Refuses if this user is the last one with
     * `manageUsers` permission — the app must never end up with nobody
     * able to administer it. */
    async remove(id: string): Promise<void> {
      const existing = await database.users.get(id);
      if (!existing) throw new NotFoundError("Utilisateur", id);

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

    /** Looks up a user by username and verifies the password. Throws
     * AuthenticationError (without indicating which part was wrong) on any
     * failure, including an unknown username. */
    async authenticate(username: string, password: string): Promise<User> {
      const user = await database.users.where("username").equalsIgnoreCase(username).first();
      if (!user) throw new AuthenticationError();
      const isCorrect = await verifyPassword(password, {
        hash: user.passwordHash,
        salt: user.passwordSalt,
      });
      if (!isCorrect) throw new AuthenticationError();
      return user;
    },
  };
}

export type UsersRepository = ReturnType<typeof createUsersRepository>;
