import { describe, it, expect, beforeEach } from "vitest";
import { createTestDatabase } from "@/test/testDatabase";
import type { SezzAccountsDatabase } from "@/db/schema";
import { createUsersRepository, type UsersRepository } from "./usersRepository";
import { ROLE_DEFAULT_PERMISSIONS } from "@/lib/permissions";
import { ValidationError, NotFoundError, AuthenticationError } from "@/lib/errors";

describe("UsersRepository", () => {
  let database: SezzAccountsDatabase;
  let users: UsersRepository;

  beforeEach(() => {
    database = createTestDatabase();
    users = createUsersRepository(database);
  });

  describe("create", () => {
    it("creates a user and hashes the password (never stores it in plain text)", async () => {
      const user = await users.create({
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
      const user = await users.create({
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
      const second = await users.create({
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
      const standard = await users.create({
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
      const custom = await users.create({
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
      const user = await users.authenticate("peter", "correct-password");
      expect(user.username).toBe("peter");
    });

    it("is username-case-insensitive", async () => {
      const user = await users.authenticate("PETER", "correct-password");
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
  });

  describe("update", () => {
    it("updates the display name", async () => {
      const user = await users.create({
        username: "peter",
        displayName: "Ancien",
        password: "secret123",
        role: "admin",
      });
      const updated = await users.update(user.id, { displayName: "Nouveau" });
      expect(updated.displayName).toBe("Nouveau");
    });

    it("resets permissions to the new role's defaults when only the role is changed", async () => {
      const admin = await users.create({
        username: "admin1",
        displayName: "Admin",
        password: "secret123",
        role: "admin",
      });
      const other = await users.create({
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
      const other = await users.create({
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
      const onlyAdmin = await users.create({
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
      const second = await users.create({
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
      const user = await users.create({
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
      const user = await users.create({
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
      const user = await users.create({
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
      const user = await users.create({
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
      const user = await users.create({
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
      const viewer = await users.create({
        username: "viewer1",
        displayName: "Viewer",
        password: "secret123",
        role: "viewer",
      });
      await users.remove(viewer.id);
      expect(await users.getById(viewer.id)).toBeUndefined();
    });

    it("refuses to delete the last remaining admin", async () => {
      const onlyAdmin = await users.create({
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
      const second = await users.create({
        username: "admin2",
        displayName: "Admin2",
        password: "secret123",
        role: "admin",
      });
      await expect(users.remove(second.id)).resolves.toBeUndefined();
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
});
