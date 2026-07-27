import type { SezzAccountsDatabase } from "./schema";
import { db as defaultDb } from "./schema";
import type { RoleTemplate, RoleTemplateUpdate, UserRole } from "@/types/models";
import { ROLE_DEFAULT_PERMISSIONS } from "@/lib/permissions";
import { toStorageRow, fromStorageRow } from "./encryptedRecord";

const ALL_ROLES: readonly UserRole[] = ["admin", "standard", "viewer"];

// No sensitive fields on this table (see RoleTemplateRow's own comment in
// schema.ts — permissions are structural, matching UserRow) -- this empty
// list still produces a valid _enc payload (encrypting nothing), purely to
// satisfy the sync engine's uniform "every row has _enc" row shape.
const SENSITIVE_ROLE_TEMPLATE_FIELDS = [] as const;

export function createRoleTemplatesRepository(database: SezzAccountsDatabase = defaultDb) {
  /** Reads a role's stored template, lazily seeding it from
   * ROLE_DEFAULT_PERMISSIONS on first read if it doesn't exist yet — a
   * migration that runs the first time it's needed rather than as a
   * schema version bump, so the seed logic lives in exactly one place
   * instead of being duplicated between a migration and this repository. */
  async function ensureSeeded(role: UserRole): Promise<RoleTemplate> {
    const row = await database.roleTemplates.get(role);
    if (row) return fromStorageRow<RoleTemplate>(row);

    const now = Date.now();
    const template: RoleTemplate = {
      id: role,
      permissions: ROLE_DEFAULT_PERMISSIONS[role],
      createdAt: now,
      updatedAt: now,
    };
    await database.roleTemplates.add(await toStorageRow(template, SENSITIVE_ROLE_TEMPLATE_FIELDS));
    return template;
  }

  return {
    /** All three role templates (admin/standard/viewer), in that fixed
     * order — the "Profil" screen's permit/deny grid, one column per
     * role. Seeds any role not yet stored before returning. */
    async list(): Promise<RoleTemplate[]> {
      return Promise.all(ALL_ROLES.map((role) => ensureSeeded(role)));
    },

    async getById(id: UserRole): Promise<RoleTemplate> {
      return ensureSeeded(id);
    },

    /** Edits one role's stored permission set. Deliberately does not
     * touch any existing user's own permissions — creating a user copies
     * the role's template at that moment (see usersRepository.ts); this
     * only changes what *future* users of this role start with, the same
     * relationship a role already had with the old hardcoded constant. */
    async update(id: UserRole, patch: RoleTemplateUpdate): Promise<RoleTemplate> {
      const existing = await ensureSeeded(id);
      const next: RoleTemplate = {
        ...existing,
        permissions: patch.permissions,
        updatedAt: Date.now(),
      };
      await database.roleTemplates.put(await toStorageRow(next, SENSITIVE_ROLE_TEMPLATE_FIELDS));
      return next;
    },
  };
}

export type RoleTemplatesRepository = ReturnType<typeof createRoleTemplatesRepository>;
