import { describe, it, expect, beforeEach } from "vitest";
import { createTestDatabase } from "@/test/testDatabase";
import { useTestEncryptionSession } from "@/test/testDek";
import { clearActiveDek } from "@/lib/encryptionSession";
import type { SezzAccountsDatabase } from "@/db/schema";
import { createUsersRepository, type UsersRepository } from "./usersRepository";
import { ROLE_DEFAULT_PERMISSIONS } from "@/lib/permissions";
import {
  ValidationError,
  NotFoundError,
  AuthenticationError,
  AccountLockedError,
} from "@/lib/errors";
import { MAX_ATTEMPTS_BEFORE_LOCKOUT } from "@/lib/loginRateLimit";

describe("UsersRepository", () => {
  useTestEncryptionSession();
  let database: SezzAccountsDatabase;
  let users: UsersRepository;

  beforeEach(() => {
    database = createTestDatabase();
    users = createUsersRepository(database);
  });

  describe("create", () => {
    it("creates a user and hashes the password (never stores it in plain text)", async () => {
      const { user } = await users.create({
        username: "peter",
        displayName: "Peter",
        password: "secret123",
        role: "standard",
      });
      expect(user.id).toBeTruthy();
      expect(user.passwordHash).not.toBe("secret123");
      expect((user as unknown as { password?: string }).password).toBeUndefined();
    });

    it("forces the very first user to be an admin regardless of the requested role", async () => {
      const { user } = await users.create({
        username: "peter",
        displayName: "Peter",
        password: "secret123",
        role: "viewer",
      });
      expect(user.role).toBe("admin");
      expect(user.permissions.manageUsers).toBe(true);
    });

    it("does not force admin on the second user", async () => {
      await users.create({
        username: "admin1",
        displayName: "Admin",
        password: "secret123",
        role: "admin",
      });
      const { user: second } = await users.create({
        username: "peter",
        displayName: "Peter",
        password: "secret123",
        role: "viewer",
      });
      expect(second.role).toBe("viewer");
      expect(second.permissions.manageUsers).toBe(false);
    });

    it("applies the role's default permissions when none are explicitly given", async () => {
      await users.create({
        username: "admin1",
        displayName: "Admin",
        password: "secret123",
        role: "admin",
      });
      const { user: standard } = await users.create({
        username: "std",
        displayName: "Standard",
        password: "secret123",
        role: "standard",
      });
      expect(standard.permissions).toEqual(ROLE_DEFAULT_PERMISSIONS.standard);
    });

    it("honors explicit per-flag permission overrides", async () => {
      await users.create({
        username: "admin1",
        displayName: "Admin",
        password: "secret123",
        role: "admin",
      });
      const { user: custom } = await users.create({
        username: "custom",
        displayName: "Custom",
        password: "secret123",
        role: "standard",
        permissions: { ...ROLE_DEFAULT_PERMISSIONS.standard, manageDebts: false },
      });
      expect(custom.permissions.manageDebts).toBe(false);
      expect(custom.permissions.manageTransactions).toBe(true);
    });

    it("rejects a duplicate username (case-insensitive)", async () => {
      await users.create({
        username: "peter",
        displayName: "Peter",
        password: "secret123",
        role: "admin",
      });
      await expect(
        users.create({
          username: "Peter",
          displayName: "Autre",
          password: "secret123",
          role: "viewer",
        }),
      ).rejects.toThrow(/déjà utilisé/);
    });

    it("rejects a password shorter than the minimum length", async () => {
      await expect(
        users.create({ username: "x", displayName: "X", password: "abc", role: "admin" }),
      ).rejects.toThrow(ValidationError);
    });

    it("rejects an empty username or display name", async () => {
      await expect(
        users.create({ username: "  ", displayName: "X", password: "secret123", role: "admin" }),
      ).rejects.toThrow(ValidationError);
      await expect(
        users.create({ username: "x", displayName: "  ", password: "secret123", role: "admin" }),
      ).rejects.toThrow(ValidationError);
    });
  });

  describe("authenticate", () => {
    beforeEach(async () => {
      await users.create({
        username: "peter",
        displayName: "Peter",
        password: "correct-password",
        role: "admin",
      });
    });

    it("returns the user on correct credentials", async () => {
      const { user } = await users.authenticate("peter", "correct-password");
      expect(user.username).toBe("peter");
    });

    it("is username-case-insensitive", async () => {
      const { user } = await users.authenticate("PETER", "correct-password");
      expect(user.username).toBe("peter");
    });

    it("throws AuthenticationError for a wrong password", async () => {
      await expect(users.authenticate("peter", "wrong-password")).rejects.toThrow(
        AuthenticationError,
      );
    });

    it("throws AuthenticationError for an unknown username (same error as wrong password)", async () => {
      await expect(users.authenticate("ghost", "anything")).rejects.toThrow(AuthenticationError);
    });

    it("succeeds on a genuinely fresh session with no DEK active yet (regression: this exact scenario is what a real app restart looks like)", async () => {
      // useTestEncryptionSession's beforeEach, and users.create() above,
      // both leave a DEK active — simulate the real-world case where
      // nobody has logged in yet this session at all.
      clearActiveDek();
      const { user, dek } = await users.authenticate("peter", "correct-password");
      expect(user.username).toBe("peter");
      expect(dek).toBeInstanceOf(Uint8Array);
    });
  });

  describe("update", () => {
    it("updates the display name", async () => {
      const { user } = await users.create({
        username: "peter",
        displayName: "Ancien",
        password: "secret123",
        role: "admin",
      });
      const updated = await users.update(user.id, { displayName: "Nouveau" });
      expect(updated.displayName).toBe("Nouveau");
    });

    it("resets permissions to the new role's defaults when only the role is changed", async () => {
      const { user: admin } = await users.create({
        username: "admin1",
        displayName: "Admin",
        password: "secret123",
        role: "admin",
      });
      const { user: other } = await users.create({
        username: "other",
        displayName: "Other",
        password: "secret123",
        role: "admin",
      });
      const updated = await users.update(other.id, { role: "viewer" });
      expect(updated.permissions).toEqual(ROLE_DEFAULT_PERMISSIONS.viewer);
      void admin;
    });

    it("applies an explicit permissions override together with a role change", async () => {
      await users.create({
        username: "admin1",
        displayName: "Admin",
        password: "secret123",
        role: "admin",
      });
      const { user: other } = await users.create({
        username: "other",
        displayName: "Other",
        password: "secret123",
        role: "viewer",
      });
      const updated = await users.update(other.id, {
        role: "standard",
        permissions: { ...ROLE_DEFAULT_PERMISSIONS.standard, manageBudget: false },
      });
      expect(updated.permissions.manageBudget).toBe(false);
      expect(updated.permissions.manageTransactions).toBe(true);
    });

    it("refuses to strip manageUsers from the last remaining admin", async () => {
      const { user: onlyAdmin } = await users.create({
        username: "solo",
        displayName: "Solo",
        password: "secret123",
        role: "admin",
      });
      await expect(users.update(onlyAdmin.id, { role: "viewer" })).rejects.toThrow(ValidationError);
    });

    it("allows stripping manageUsers when another admin still exists", async () => {
      await users.create({
        username: "admin1",
        displayName: "Admin1",
        password: "secret123",
        role: "admin",
      });
      const { user: second } = await users.create({
        username: "admin2",
        displayName: "Admin2",
        password: "secret123",
        role: "admin",
      });
      await expect(users.update(second.id, { role: "viewer" })).resolves.toBeTruthy();
    });

    it("throws NotFoundError for an unknown id", async () => {
      await expect(users.update("nope", { displayName: "X" })).rejects.toThrow(NotFoundError);
    });
  });

  describe("changePassword", () => {
    it("changes the password when the current password is correct", async () => {
      const { user } = await users.create({
        username: "peter",
        displayName: "Peter",
        password: "old-password",
        role: "admin",
      });
      await users.changePassword(user.id, "old-password", "new-password");
      await expect(users.authenticate("peter", "new-password")).resolves.toBeTruthy();
      await expect(users.authenticate("peter", "old-password")).rejects.toThrow(
        AuthenticationError,
      );
    });

    it("refuses when the current password is wrong", async () => {
      const { user } = await users.create({
        username: "peter",
        displayName: "Peter",
        password: "old-password",
        role: "admin",
      });
      await expect(users.changePassword(user.id, "wrong", "new-password")).rejects.toThrow(
        AuthenticationError,
      );
    });

    it("validates the new password's length", async () => {
      const { user } = await users.create({
        username: "peter",
        displayName: "Peter",
        password: "old-password",
        role: "admin",
      });
      await expect(users.changePassword(user.id, "old-password", "ab")).rejects.toThrow(
        ValidationError,
      );
    });
  });

  describe("adminResetPassword", () => {
    it("resets the password without requiring the old one", async () => {
      const { user } = await users.create({
        username: "peter",
        displayName: "Peter",
        password: "forgotten-password",
        role: "viewer",
      });
      await users.adminResetPassword(user.id, "brand-new-password");
      await expect(users.authenticate("peter", "brand-new-password")).resolves.toBeTruthy();
      await expect(users.authenticate("peter", "forgotten-password")).rejects.toThrow(
        AuthenticationError,
      );
    });

    it("validates the new password's length", async () => {
      const { user } = await users.create({
        username: "peter",
        displayName: "Peter",
        password: "old-password",
        role: "viewer",
      });
      await expect(users.adminResetPassword(user.id, "ab")).rejects.toThrow(ValidationError);
    });

    it("throws NotFoundError for an unknown id", async () => {
      await expect(users.adminResetPassword("nope", "new-password")).rejects.toThrow(NotFoundError);
    });
  });

  describe("remove", () => {
    it("deletes a user who is not the last admin", async () => {
      await users.create({
        username: "admin1",
        displayName: "Admin1",
        password: "secret123",
        role: "admin",
      });
      const { user: viewer } = await users.create({
        username: "viewer1",
        displayName: "Viewer",
        password: "secret123",
        role: "viewer",
      });
      await users.remove(viewer.id);
      expect(await users.getById(viewer.id)).toBeUndefined();
    });

    it("refuses to delete the last remaining admin", async () => {
      const { user: onlyAdmin } = await users.create({
        username: "solo",
        displayName: "Solo",
        password: "secret123",
        role: "admin",
      });
      await expect(users.remove(onlyAdmin.id)).rejects.toThrow(ValidationError);
    });

    it("allows deleting an admin when another admin still exists", async () => {
      await users.create({
        username: "admin1",
        displayName: "Admin1",
        password: "secret123",
        role: "admin",
      });
      const { user: second } = await users.create({
        username: "admin2",
        displayName: "Admin2",
        password: "secret123",
        role: "admin",
      });
      await expect(users.remove(second.id)).resolves.toBeUndefined();
    });

    it("logs the deletion for sync", async () => {
      await users.create({
        username: "admin1",
        displayName: "Admin1",
        password: "secret123",
        role: "admin",
      });
      const { user: viewer } = await users.create({
        username: "viewer1",
        displayName: "Viewer",
        password: "secret123",
        role: "viewer",
      });
      await users.remove(viewer.id);

      const entries = await database.deletionLog.toArray();
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ tableName: "users", recordId: viewer.id });
    });
  });

  describe("count", () => {
    it("returns 0 for an empty table", async () => {
      expect(await users.count()).toBe(0);
    });

    it("counts users without needing an active encryption session", async () => {
      await users.create({
        username: "peter",
        displayName: "Peter",
        password: "secret123",
        role: "admin",
      });
      clearActiveDek();
      // this is the exact situation right after logout, or on any fresh
      // page load once at least one user already exists — count() must
      // still work, since it's what decides whether to show "create the
      // first admin" or "log in" in the first place.
      await expect(users.count()).resolves.toBe(1);
    });

    it("updates as users are added and removed", async () => {
      await users.create({
        username: "a",
        displayName: "A",
        password: "secret123",
        role: "admin",
      });
      const { user: b } = await users.create({
        username: "b",
        displayName: "B",
        password: "secret123",
        role: "viewer",
      });
      expect(await users.count()).toBe(2);
      await users.remove(b.id);
      expect(await users.count()).toBe(1);
    });
  });

  describe("list / getByUsername", () => {
    it("lists users sorted by username", async () => {
      await users.create({
        username: "zed",
        displayName: "Z",
        password: "secret123",
        role: "admin",
      });
      await users.create({
        username: "alice",
        displayName: "A",
        password: "secret123",
        role: "viewer",
      });
      const list = await users.list();
      expect(list.map((u) => u.username)).toEqual(["alice", "zed"]);
    });

    it("finds a user by username case-insensitively", async () => {
      await users.create({
        username: "Peter",
        displayName: "Peter",
        password: "secret123",
        role: "admin",
      });
      expect(await users.getByUsername("peter")).toBeDefined();
    });
  });

  describe("login rate limiting", () => {
    beforeEach(async () => {
      await users.create({
        username: "peter",
        displayName: "Peter",
        password: "correct-password",
        role: "admin",
      });
    });

    it("allows several wrong-password attempts before locking out", async () => {
      for (let i = 0; i < MAX_ATTEMPTS_BEFORE_LOCKOUT; i++) {
        await expect(users.authenticate("peter", "wrong")).rejects.toThrow(AuthenticationError);
      }
      // still an AuthenticationError, not yet a lockout, for attempts
      // strictly below the threshold
    });

    it("locks the account out once the threshold is crossed, even with the correct password", async () => {
      for (let i = 0; i < MAX_ATTEMPTS_BEFORE_LOCKOUT; i++) {
        await expect(users.authenticate("peter", "wrong")).rejects.toThrow(AuthenticationError);
      }
      await expect(users.authenticate("peter", "correct-password")).rejects.toThrow(
        AccountLockedError,
      );
    });

    it("does not extend the lockout further while already locked (hammering doesn't compound it)", async () => {
      for (let i = 0; i < MAX_ATTEMPTS_BEFORE_LOCKOUT; i++) {
        await expect(users.authenticate("peter", "wrong")).rejects.toThrow(AuthenticationError);
      }
      let firstError: AccountLockedError | undefined;
      try {
        await users.authenticate("peter", "wrong");
      } catch (e) {
        firstError = e as AccountLockedError;
      }
      let secondError: AccountLockedError | undefined;
      try {
        await users.authenticate("peter", "wrong");
      } catch (e) {
        secondError = e as AccountLockedError;
      }
      expect(firstError).toBeInstanceOf(AccountLockedError);
      expect(secondError).toBeInstanceOf(AccountLockedError);
      // the second check happens immediately after the first, so its
      // remaining time must not have grown
      expect(secondError!.retryAfterMs).toBeLessThanOrEqual(firstError!.retryAfterMs);
    });

    it("resets the failure count after a successful login", async () => {
      await expect(users.authenticate("peter", "wrong")).rejects.toThrow(AuthenticationError);
      await expect(users.authenticate("peter", "wrong")).rejects.toThrow(AuthenticationError);
      await expect(users.authenticate("peter", "correct-password")).resolves.toBeTruthy();

      // back to a clean slate: should take the full threshold again, not
      // immediately lock out from the two earlier failures
      await expect(users.authenticate("peter", "wrong")).rejects.toThrow(AuthenticationError);
      await expect(users.authenticate("peter", "correct-password")).resolves.toBeTruthy();
    });

    it("does not rate-limit an unknown username at all (nothing to protect)", async () => {
      for (let i = 0; i < MAX_ATTEMPTS_BEFORE_LOCKOUT + 3; i++) {
        await expect(users.authenticate("ghost", "anything")).rejects.toThrow(AuthenticationError);
      }
      // never an AccountLockedError for a username that was never real
    });
  });

  describe("recoverWithCode", () => {
    it("recovers access with the correct recovery code and sets a new password", async () => {
      const { user, recoveryCode } = await users.create({
        username: "peter",
        displayName: "Peter",
        password: "old-password",
        role: "admin",
      });
      void user;

      const result = await users.recoverWithCode("peter", recoveryCode, "new-password");
      expect(result.user.username).toBe("peter");
      expect(result.dek).toBeInstanceOf(Uint8Array);

      await expect(users.authenticate("peter", "new-password")).resolves.toBeTruthy();
      await expect(users.authenticate("peter", "old-password")).rejects.toThrow(
        AuthenticationError,
      );
    });

    it("is username-case-insensitive and code-format-insensitive (dashes/case)", async () => {
      const { recoveryCode } = await users.create({
        username: "Peter",
        displayName: "Peter",
        password: "old-password",
        role: "admin",
      });
      const messyCode = recoveryCode.toLowerCase().replace(/-/g, " ");
      await expect(users.recoverWithCode("PETER", messyCode, "new-password")).resolves.toBeTruthy();
    });

    it("rejects an incorrect recovery code", async () => {
      await users.create({
        username: "peter",
        displayName: "Peter",
        password: "old-password",
        role: "admin",
      });
      await expect(
        users.recoverWithCode("peter", "WRONG-CODE-0000-0000", "new-password"),
      ).rejects.toThrow(AuthenticationError);
    });

    it("rejects an unknown username", async () => {
      await expect(
        users.recoverWithCode("ghost", "ANYTHING-0000-0000-0000", "new-password"),
      ).rejects.toThrow(AuthenticationError);
    });

    it("validates the new password's length", async () => {
      const { recoveryCode } = await users.create({
        username: "peter",
        displayName: "Peter",
        password: "old-password",
        role: "admin",
      });
      await expect(users.recoverWithCode("peter", recoveryCode, "ab")).rejects.toThrow(
        ValidationError,
      );
    });

    it("rotates the recovery code: the old one stops working after a successful recovery", async () => {
      const { recoveryCode } = await users.create({
        username: "peter",
        displayName: "Peter",
        password: "old-password",
        role: "admin",
      });
      const { recoveryCode: newCode } = await users.recoverWithCode(
        "peter",
        recoveryCode,
        "new-password",
      );
      expect(newCode).not.toBe(recoveryCode);
      await expect(
        users.recoverWithCode("peter", recoveryCode, "another-password"),
      ).rejects.toThrow(AuthenticationError);
      await expect(
        users.recoverWithCode("peter", newCode, "another-password"),
      ).resolves.toBeTruthy();
    });

    it("shares the same lockout counter as regular authentication", async () => {
      await users.create({
        username: "peter",
        displayName: "Peter",
        password: "correct-password",
        role: "admin",
      });
      for (let i = 0; i < MAX_ATTEMPTS_BEFORE_LOCKOUT; i++) {
        await expect(
          users.recoverWithCode("peter", "WRONG-0000-0000-0000", "new-password"),
        ).rejects.toThrow(AuthenticationError);
      }
      await expect(users.authenticate("peter", "correct-password")).rejects.toThrow(
        AccountLockedError,
      );
    });

    it("changing the password via changePassword does not invalidate the recovery code", async () => {
      const { user, recoveryCode } = await users.create({
        username: "peter",
        displayName: "Peter",
        password: "old-password",
        role: "admin",
      });
      await users.changePassword(user.id, "old-password", "changed-password");
      await expect(
        users.recoverWithCode("peter", recoveryCode, "recovered-password"),
      ).resolves.toBeTruthy();
    });
  });

  describe("regenerateRecoveryCode", () => {
    it("issues a new code that works, invalidating the old one", async () => {
      const { user, recoveryCode } = await users.create({
        username: "peter",
        displayName: "Peter",
        password: "correct-password",
        role: "admin",
      });
      const newCode = await users.regenerateRecoveryCode(user.id, "correct-password");
      expect(newCode).not.toBe(recoveryCode);

      await expect(users.recoverWithCode("peter", recoveryCode, "new-password")).rejects.toThrow(
        AuthenticationError,
      );
      await expect(users.recoverWithCode("peter", newCode, "new-password")).resolves.toBeTruthy();
    });

    it("requires the correct current password", async () => {
      const { user } = await users.create({
        username: "peter",
        displayName: "Peter",
        password: "correct-password",
        role: "admin",
      });
      await expect(users.regenerateRecoveryCode(user.id, "wrong-password")).rejects.toThrow(
        AuthenticationError,
      );
    });

    it("throws NotFoundError for an unknown id", async () => {
      await expect(users.regenerateRecoveryCode("nope", "anything")).rejects.toThrow(NotFoundError);
    });
  });
});
