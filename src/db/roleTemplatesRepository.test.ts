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

    it("never throws and never duplicates a role when two seeding reads overlap on a fresh database", async () => {
      // Reproduces the real crash this was found from: useLiveQuery calls
      // list() again as soon as it sees the seeding writes from the first
      // call land, so a second, overlapping call can start seeding the
      // same role before the first one's own add() has committed. On a
      // fast machine the window barely opens; on slower hardware
      // (reported specifically as a phone crash) it opens wide enough to
      // hit reliably. Simulated here as two truly concurrent calls
      // against the same never-seeded database, which is exactly what
      // useLiveQuery's own re-invocation looks like from this repository's
      // point of view.
      const [firstRun, secondRun] = await Promise.all([roleTemplates.list(), roleTemplates.list()]);

      expect(firstRun.map((t) => t.id)).toEqual(["admin", "standard", "viewer"]);
      expect(secondRun.map((t) => t.id)).toEqual(["admin", "standard", "viewer"]);
      const stored = await database.roleTemplates.toArray();
      expect(stored).toHaveLength(3);
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
