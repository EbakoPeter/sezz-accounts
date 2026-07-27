import type {
  SezzAccountsDatabase,
  SyncableTableName,
  AccountRow,
  TransactionRow,
  TransferRow,
  BudgetCategoryRow,
  BudgetSubcategoryRow,
  EngagementRow,
  DebtRow,
  DebtPaymentRow,
  UserRow,
  RoleTemplateRow,
} from "@/db/schema";
import { db as defaultDb } from "@/db/schema";
import type { UserRole } from "@/types/models";
import type { SyncSession } from "./syncClient";

const SYNCABLE_TABLES: readonly SyncableTableName[] = [
  "accounts",
  "transactions",
  "transfers",
  "budgetCategories",
  "budgetSubcategories",
  "engagements",
  "debts",
  "debtPayments",
  "users",
  "roleTemplates",
];

/** Matches the server's own limit (see the server's src/sync/routes.ts) —
 * pushes are chunked to this size rather than sent as one unbounded batch. */
const PUSH_BATCH_SIZE = 500;

type AnySyncedRow =
  | AccountRow
  | TransactionRow
  | TransferRow
  | BudgetCategoryRow
  | BudgetSubcategoryRow
  | EngagementRow
  | DebtRow
  | DebtPaymentRow
  | UserRow
  | RoleTemplateRow;

/** Every row type shares at least this shape — enough to convert to/from
 * the wire format generically, without needing per-table code. Each row's
 * *extra* fields (accountId, kind, date, ...) are whatever TypeScript
 * infers for the rest via the destructure below; nothing here needs to
 * name them. */
interface StorageRowShape {
  id: string;
  createdAt: number;
  updatedAt: number;
  _enc: { iv: string; data: string };
}

export interface WireRecord {
  tableName: SyncableTableName;
  id: string;
  structural: Record<string, unknown>;
  encData: { iv: string; data: string } | null;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number | null;
}

function rowToWireRecord<T extends StorageRowShape>(
  tableName: SyncableTableName,
  row: T,
): WireRecord {
  const { id, createdAt, updatedAt, _enc, ...structural } = row;
  return { tableName, id, structural, encData: _enc, createdAt, updatedAt };
}

/** The inverse of rowToWireRecord. Reconstructs exactly what a repository
 * would have written — structural fields spread back out, `encData`
 * renamed back to `_enc` — for `.put()` into the matching Dexie table.
 * The cast to AnySyncedRow is the one place this module can't stay fully
 * generic: which concrete row shape is correct depends on `tableName`,
 * known only at runtime, and Dexie's own `.put()` typing needs a single
 * shape per call. */
function wireRecordToRow(record: WireRecord): AnySyncedRow {
  const base = {
    ...record.structural,
    id: record.id,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
  return (record.encData ? { ...base, _enc: record.encData } : base) as AnySyncedRow;
}

function getTable(database: SezzAccountsDatabase, tableName: SyncableTableName) {
  return database[tableName];
}

async function readCursor(
  database: SezzAccountsDatabase,
  key: "lastPushedAt" | "lastPulledAt",
): Promise<number> {
  const entry = await database.syncConfig.get(key);
  return entry ? Number(entry.value) : 0;
}

async function writeCursor(
  database: SezzAccountsDatabase,
  key: "lastPushedAt" | "lastPulledAt",
  value: number,
): Promise<void> {
  await database.syncConfig.put({ key, value: String(value) });
}

function authHeaders(session: SyncSession): HeadersInit {
  return { "Content-Type": "application/json", Authorization: `Bearer ${session.token}` };
}

async function parseJsonResponse(response: Response): Promise<Record<string, unknown>> {
  return (await response.json().catch(() => ({}))) as Record<string, unknown>;
}

export interface PushResult {
  pushed: number;
}

/** Sends every local change since the last successful push: rows whose
 * `updatedAt` is newer than the push cursor, across every syncable table,
 * plus any not-yet-pushed entries in the deletion log (converted to
 * minimal tombstone records — see deletionLog.ts for why creates/updates
 * and deletes are tracked so differently on the client). Advances the
 * push cursor to the server's own clock (`serverTime`), not this device's,
 * so client/server clock drift can't cause records to be silently skipped
 * or endlessly re-sent on the next push. */
export async function pushChanges(
  session: SyncSession,
  database: SezzAccountsDatabase = defaultDb,
): Promise<PushResult> {
  const lastPushedAt = await readCursor(database, "lastPushedAt");

  const records: WireRecord[] = [];
  for (const tableName of SYNCABLE_TABLES) {
    const table = getTable(database, tableName);
    // .where("updatedAt").above(...) uses the index added in schema v9 —
    // IndexedDB returns only the rows that actually changed since the
    // last push, rather than every row in the table filtered in memory
    // afterward. The larger the table grows relative to how much actually
    // changed between syncs, the more this matters.
    const rows = await table.where("updatedAt").above(lastPushedAt).toArray();
    for (const row of rows) {
      records.push(rowToWireRecord(tableName, row));
    }
  }

  const pendingDeletions = await database.deletionLog
    .filter((entry) => entry.pushedAt === undefined)
    .toArray();
  for (const entry of pendingDeletions) {
    records.push({
      tableName: entry.tableName,
      id: entry.recordId,
      structural: {},
      encData: null,
      createdAt: entry.deletedAt,
      updatedAt: entry.deletedAt,
      deletedAt: entry.deletedAt,
    });
  }

  if (records.length === 0) {
    return { pushed: 0 };
  }

  let serverTime = Date.now();
  for (let i = 0; i < records.length; i += PUSH_BATCH_SIZE) {
    const batch = records.slice(i, i + PUSH_BATCH_SIZE);
    const response = await fetch(`${session.serverUrl}/sync/push`, {
      method: "POST",
      headers: authHeaders(session),
      body: JSON.stringify({ records: batch }),
    });
    const body = await parseJsonResponse(response);
    if (!response.ok) {
      throw new Error(
        typeof body["error"] === "string" ? body["error"] : "Échec de l'envoi vers le serveur.",
      );
    }
    if (typeof body["serverTime"] === "number") {
      serverTime = body["serverTime"];
    }
  }

  await writeCursor(database, "lastPushedAt", serverTime);
  const pushedLogIds = pendingDeletions
    .map((entry) => entry.logId)
    .filter((id) => id !== undefined);
  if (pushedLogIds.length > 0) {
    await database.deletionLog.bulkDelete(pushedLogIds);
  }

  return { pushed: records.length };
}

export interface PullResult {
  pulled: number;
  deleted: number;
}

/** Fetches every remote change since the last successful pull and merges
 * it into local storage. A record with `deletedAt` set removes the local
 * row (if present) rather than being stored as a tombstone locally — the
 * deletion log is how *this* device tells others about a deletion; once a
 * deletion reaches this device from elsewhere, there's nothing further to
 * propagate, so there is no reason to keep a local tombstone around.
 *
 * Applies last-write-wins on this side too: an incoming record only
 * overwrites what's stored locally if it's at least as new, so a pull
 * triggered while this device has a newer, not-yet-pushed local edit
 * can't clobber it. */
export async function pullChanges(
  session: SyncSession,
  database: SezzAccountsDatabase = defaultDb,
): Promise<PullResult> {
  const lastPulledAt = await readCursor(database, "lastPulledAt");

  const response = await fetch(`${session.serverUrl}/sync/pull?since=${lastPulledAt}`, {
    headers: authHeaders(session),
  });
  const body = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(
      typeof body["error"] === "string"
        ? body["error"]
        : "Échec de la réception depuis le serveur.",
    );
  }

  const records = (body["records"] as WireRecord[] | undefined) ?? [];
  let pulled = 0;
  let deleted = 0;

  for (const record of records) {
    const table = getTable(database, record.tableName);
    // record.id is always the correct id type for whichever table this
    // actually is (guaranteed by the wire protocol, not by this cast) --
    // narrowed to the union's narrowest key type (roleTemplates' UserRole)
    // purely so this one generic loop, working across every syncable
    // table's differently-typed primary key, type-checks at all; every
    // other table's key is just a plain string, which a UserRole also is.
    const existing = await table.get(record.id as UserRole);
    if (existing && existing.updatedAt > record.updatedAt) {
      // a newer local edit hasn't been pushed yet — do not let this pull
      // overwrite it; the next push will send the local version onward.
      continue;
    }

    if (record.deletedAt) {
      if (existing) {
        await table.delete(record.id as UserRole);
        deleted += 1;
      }
      continue;
    }

    await table.put(wireRecordToRow(record) as never);
    pulled += 1;
  }

  const serverTime = typeof body["serverTime"] === "number" ? body["serverTime"] : Date.now();
  await writeCursor(database, "lastPulledAt", serverTime);

  return { pulled, deleted };
}

export interface SyncResult {
  push: PushResult;
  pull: PullResult;
}

export interface SyncStatus {
  attemptedAt: number;
  success: boolean;
  pushed?: number;
  pulled?: number;
  deleted?: number;
  error?: string;
}

async function recordStatus(database: SezzAccountsDatabase, status: SyncStatus): Promise<void> {
  await database.syncConfig.put({ key: "lastSyncStatus", value: JSON.stringify(status) });
}

/** The outcome of the most recent sync attempt, whichever component
 * triggered it (the manual button, or automatic background sync) —
 * SyncPanel reads this reactively via useLiveQuery, so either path updates
 * the same displayed status. */
export async function getLastSyncStatus(
  database: SezzAccountsDatabase = defaultDb,
): Promise<SyncStatus | undefined> {
  const entry = await database.syncConfig.get("lastSyncStatus");
  if (!entry) return undefined;
  try {
    return JSON.parse(entry.value) as SyncStatus;
  } catch {
    return undefined;
  }
}

/** Push before pull, deliberately: sending this device's own changes out
 * first means a pull immediately afterward reflects a more complete
 * picture (including what this device just contributed) rather than
 * potentially fetching a stale view and then separately pushing on top of
 * it. Does not fully eliminate every race with another device syncing at
 * the exact same moment — see this module's README for what is and isn't
 * handled yet.
 *
 * Always records the outcome (success or failure) to a shared status
 * entry before returning or throwing, so every caller — the manual
 * "Synchroniser maintenant" button and the automatic background trigger
 * alike — updates the same place, rather than each needing to remember to
 * do so itself. Still re-throws on failure, so a caller that wants its own
 * specific handling can have it. */
export async function syncNow(
  session: SyncSession,
  database: SezzAccountsDatabase = defaultDb,
): Promise<SyncResult> {
  try {
    const push = await pushChanges(session, database);
    const pull = await pullChanges(session, database);
    await recordStatus(database, {
      attemptedAt: Date.now(),
      success: true,
      pushed: push.pushed,
      pulled: pull.pulled,
      deleted: pull.deleted,
    });
    return { push, pull };
  } catch (err) {
    await recordStatus(database, {
      attemptedAt: Date.now(),
      success: false,
      error: err instanceof Error ? err.message : "Erreur inattendue lors de la synchronisation.",
    });
    throw err;
  }
}
