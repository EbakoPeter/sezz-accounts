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
   * instead of being duplicated between a migration and this repository.
   *
   * The get-then-add is wrapped in its own read-write transaction
   * deliberately: list() below calls this for all three roles
   * concurrently via Promise.all, and useLiveQuery re-invokes list()
   * again as soon as it sees any of those writes land — meaning a
   * second, overlapping call can start seeding the same role before the
   * first one's add() has committed. Without a transaction, both see
   * "doesn't exist yet" and both call add(), and the second one throws
   * a ConstraintError with no error boundary to catch it, taking the
   * whole page down. A transaction serializes concurrent calls against
   * the same store, so the second one's own get() correctly sees what
   * the first already committed. This raced rarely on a fast desktop
   * (the window was narrow) and reliably on slower hardware (every
   * IndexedDB round trip is slower, widening it) — which is exactly the
   * "crashes on phone" report this fixes.
   *
   * toStorageRow/fromStorageRow are deliberately called *outside* the
   * transaction, before and after it rather than inside: they call the
   * Web Crypto API, a native, non-Dexie promise, and awaiting one inside
   * a Dexie transaction breaks the microtask chain Dexie uses to know
   * the transaction is still in use — it commits early and every
   * request issued after throws PrematureCommitError. The transaction
   * body below is a plain, uninterrupted sequence of IndexedDB requests
   * only, which is what Dexie transactions actually require. */
  async function ensureSeeded(role: UserRole): Promise<RoleTemplate> {
    // Fast path first: the overwhelming majority of reads find the role
    // already seeded, and a plain (non-transactional) get() for that case
    // avoids opening a read-write transaction on every single read —
    // Dexie's liveQuery treats an "rw" transaction as a possible table
    // mutation for reactivity purposes regardless of what it actually did,
    // so doing this unconditionally caused every read to look like a
    // write and retrigger reactive queries needlessly. Only escalate to
    // the transactional path below when seeding might actually be needed.
    const existingRow = await database.roleTemplates.get(role);
    if (existingRow) return fromStorageRow<RoleTemplate>(existingRow);

    const now = Date.now();
    const template: RoleTemplate = {
      id: role,
      permissions: ROLE_DEFAULT_PERMISSIONS[role],
      createdAt: now,
      updatedAt: now,
    };
    const candidateRow = await toStorageRow(template, SENSITIVE_ROLE_TEMPLATE_FIELDS);

    const row = await database.transaction("rw", database.roleTemplates, async () => {
      const existing = await database.roleTemplates.get(role);
      if (existing) return existing;
      await database.roleTemplates.add(candidateRow);
      return candidateRow;
    });

    return fromStorageRow<RoleTemplate>(row);
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
