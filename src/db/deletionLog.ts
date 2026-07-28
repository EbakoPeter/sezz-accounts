import type { SezzAccountsDatabase, SyncableTableName } from "./schema";

/** Records that a row was deleted locally, for the sync engine to discover
 * and push as a tombstone. Called by each repository's `remove()` — see
 * DeletionLogEntry in schema.ts for why this is a separate log rather than
 * a soft-delete flag on every table.
 *
 * `baseSeq` is the row's own last-known seq field at the moment of
 * deletion (0 if the row was never synced at all) — the caller reads it
 * from the very row it just fetched to delete, not from an extra query,
 * since every repository's remove() already has that row in hand for its
 * own validation/error-message purposes. */
export async function logDeletion(
  database: SezzAccountsDatabase,
  tableName: SyncableTableName,
  recordId: string,
  baseSeq: number,
): Promise<void> {
  await database.deletionLog.add({
    tableName,
    recordId,
    deletedAt: Date.now(),
    baseSeq,
  });
}
