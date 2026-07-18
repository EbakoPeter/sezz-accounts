import type { SezzAccountsDatabase, SyncableTableName } from "./schema";

/** Records that a row was deleted locally, for the sync engine to discover
 * and push as a tombstone. Called by each repository's `remove()` — see
 * DeletionLogEntry in schema.ts for why this is a separate log rather than
 * a soft-delete flag on every table. */
export async function logDeletion(
  database: SezzAccountsDatabase,
  tableName: SyncableTableName,
  recordId: string,
): Promise<void> {
  await database.deletionLog.add({
    tableName,
    recordId,
    deletedAt: Date.now(),
  });
}
