import { describe, it, expect, beforeEach } from "vitest";
import { useTestEncryptionSession } from "@/test/testDek";
import { createTestDatabase } from "@/test/testDatabase";
import type { SezzAccountsDatabase } from "@/db/schema";
import {
  createRoleTemplatesRepository,
  type RoleTemplatesRepository,
} from "./roleTemplatesRepository";
import { ROLE_DEFAULT_PERMISSIONS } from "@/lib/permissions";

// This table has no sensitive fields (see its own comment in schema.ts),
// but toStorageRow still requires an active encryption session
// unconditionally, even to encrypt nothing — consistent with the app
// itself, where reaching the "Profil" screen at all requires being
// logged in already.

describe("RoleTemplatesRepository", () => {
  useTestEncryptionSession();
  let database: SezzAccountsDatabase;
  let roleTemplates: RoleTemplatesRepository;

  beforeEach(() => {
    database = createTestDatabase();
    roleTemplates = createRoleTemplatesRepository(database);
  });

  describe("list", () => {
    it("returns all three roles, seeded from the defaults, on first read", async () => {
      const templates = await roleTemplates.list();
      expect(templates.map((t) => t.id)).toEqual(["admin", "standard", "viewer"]);
      for (const template of templates) {
        expect(template.permissions).toEqual(ROLE_DEFAULT_PERMISSIONS[template.id]);
      }
    });

    it("persists the seeded rows rather than reseeding on every read", async () => {
      const first = await roleTemplates.list();
      await roleTemplates.update("admin", {
        permissions: { ...first[0]!.permissions, manageBudget: false },
      });

      const second = await roleTemplates.list();
      expect(second.find((t) => t.id === "admin")?.permissions.manageBudget).toBe(false);
    });
  });

  describe("getById", () => {
    it("seeds and returns a single role's template", async () => {
      const template = await roleTemplates.getById("viewer");
      expect(template.id).toBe("viewer");
      expect(template.permissions).toEqual(ROLE_DEFAULT_PERMISSIONS.viewer);
    });
  });

  describe("update", () => {
    it("changes only the targeted role's permissions", async () => {
      await roleTemplates.update("standard", {
        permissions: { ...ROLE_DEFAULT_PERMISSIONS.standard, manageUsers: true },
      });

      const standard = await roleTemplates.getById("standard");
      const admin = await roleTemplates.getById("admin");
      expect(standard.permissions.manageUsers).toBe(true);
      expect(admin.permissions).toEqual(ROLE_DEFAULT_PERMISSIONS.admin);
    });

    it("bumps updatedAt", async () => {
      const before = await roleTemplates.getById("admin");
      await new Promise((resolve) => setTimeout(resolve, 5));
      const after = await roleTemplates.update("admin", { permissions: before.permissions });
      expect(after.updatedAt).toBeGreaterThan(before.updatedAt);
    });

    it("works on a role that hasn't been read (and therefore seeded) yet", async () => {
      const updated = await roleTemplates.update("viewer", {
        permissions: { ...ROLE_DEFAULT_PERMISSIONS.viewer, manageAccounts: true },
      });
      expect(updated.permissions.manageAccounts).toBe(true);
    });
  });
});
