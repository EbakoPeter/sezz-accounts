import type { SezzAccountsDatabase } from "@/db/schema";
import { db as defaultDb } from "@/db/schema";
import { SYNCABLE_TABLES } from "@/sync/syncEngine";

/**
 * A local backup is a snapshot of every syncable table's *raw storage
 * rows* — the same shape already sitting in IndexedDB, sensitive fields
 * still bundled inside each row's own `_enc` blob. This module never
 * decrypts anything to produce or consume one: exporting doesn't need an
 * active session at all, and restoring one onto a device only actually
 * unlocks anything readable once someone logs in with a password that
 * unwraps the same DEK the data was encrypted under — exactly the same
 * requirement synced data already has (see SECURITY.md).
 *
 * Deliberately excludes syncConfig (server address, sync account
 * credentials, push/pull cursors) — those are *this device's* own
 * configuration, not part of the household's data, and restoring a
 * backup taken on a different device should never silently redirect
 * this one to someone else's sync server. The push/pull cursors
 * specifically get reset after a restore (see restoreBackup) since
 * they'd otherwise be compared against data that changed out from under
 * them.
 */

const BACKUP_FORMAT_VERSION = 1;

export interface BackupFile {
  version: number;
  exportedAt: number;
  tables: Partial<Record<(typeof SYNCABLE_TABLES)[number], unknown[]>>;
}

export interface BackupSummary {
  exportedAt: number;
  /** Total row count across every table, purely for display (e.g. "1 240
   * enregistrements") — never used for anything decision-making. */
  totalRecords: number;
}

/** Builds the backup as a plain object — the caller (SyncPanel) decides
 * how to turn that into a downloadable file, since "trigger a browser
 * download" isn't this module's concern. */
export async function buildBackup(database: SezzAccountsDatabase = defaultDb): Promise<BackupFile> {
  const tables: BackupFile["tables"] = {};
  for (const tableName of SYNCABLE_TABLES) {
    tables[tableName] = await database[tableName].toArray();
  }
  return { version: BACKUP_FORMAT_VERSION, exportedAt: Date.now(), tables };
}

export class InvalidBackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidBackupError";
  }
}

/** Validates the overall shape without trusting any of it — this is a
 * file from disk, which could be anything: a backup from an unrelated
 * app, a hand-edited file, or simple corruption. Checks structure only;
 * doesn't (and can't, without a session) verify that any row's `_enc`
 * blob is actually decryptable — a mismatched-key row behaves the same
 * way here as one arriving through sync (see fromStorageRows). */
function assertValidBackup(value: unknown): asserts value is BackupFile {
  if (typeof value !== "object" || value === null) {
    throw new InvalidBackupError("Ce fichier n'est pas une sauvegarde LeN'KAP valide.");
  }
  const candidate = value as Record<string, unknown>;
  if (candidate["version"] !== BACKUP_FORMAT_VERSION) {
    throw new InvalidBackupError(
      "Ce fichier provient d'une version incompatible de LeN'KAP, ou n'est pas une sauvegarde.",
    );
  }
  if (typeof candidate["tables"] !== "object" || candidate["tables"] === null) {
    throw new InvalidBackupError("Ce fichier n'est pas une sauvegarde LeN'KAP valide.");
  }
}

/** Parses and validates a backup file's raw text content, without
 * applying it — used by the UI to show a confirmation (record count,
 * export date) before the person commits to the actually-destructive
 * restoreBackup call below. */
export function parseBackup(fileContent: string): BackupFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fileContent);
  } catch {
    throw new InvalidBackupError("Ce fichier n'est pas une sauvegarde LeN'KAP valide.");
  }
  assertValidBackup(parsed);
  return parsed;
}

export function summarizeBackup(backup: BackupFile): BackupSummary {
  let totalRecords = 0;
  for (const tableName of SYNCABLE_TABLES) {
    totalRecords += backup.tables[tableName]?.length ?? 0;
  }
  return { exportedAt: backup.exportedAt, totalRecords };
}

export interface RestoreResult {
  restored: number;
}

/** Wholesale replaces every syncable table's contents with the backup's
 * own — not a merge. Deliberately destructive and deliberately not
 * disguised as anything gentler: the UI's own confirmation step is what
 * carries the responsibility of making sure this is what the person
 * actually wants, exactly like the delete-confirmation pattern already
 * used throughout the app, just for a much larger blast radius.
 *
 * Clears the local deletion log (its entries reference records against
 * a state that no longer exists the same way) and resets the sync
 * push/pull cursors to zero — leaving them as they were would compare
 * this device's *next* sync attempt against data that changed out from
 * under those cursors, in either direction. Forcing a full reconcile
 * next sync is the safe default; it can only add or correct data (see
 * pullChanges), never erase anything, the same guarantee the rewritten
 * sync protocol already gives every normal pull. */
export async function restoreBackup(
  backup: BackupFile,
  database: SezzAccountsDatabase = defaultDb,
): Promise<RestoreResult> {
  assertValidBackup(backup);

  let restored = 0;
  await database.transaction(
    "rw",
    [...SYNCABLE_TABLES.map((name) => database[name]), database.deletionLog, database.syncConfig],
    async () => {
      for (const tableName of SYNCABLE_TABLES) {
        const table = database[tableName];
        await table.clear();
        const rows = backup.tables[tableName];
        if (Array.isArray(rows) && rows.length > 0) {
          await (table.bulkPut as (items: unknown[]) => Promise<unknown>)(rows);
          restored += rows.length;
        }
      }
      await database.deletionLog.clear();
      await database.syncConfig.delete("lastPushedAt");
      await database.syncConfig.delete("lastPulledSeq");
    },
  );

  return { restored };
}
