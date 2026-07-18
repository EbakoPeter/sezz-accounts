import type {
  SezzAccountsDatabase,
  SyncableTableName,
  AccountRow,
  TransactionRow,
  BudgetCategoryRow,
  BudgetSubcategoryRow,
  DebtRow,
  DebtPaymentRow,
  UserRow,
} from "@/db/schema";
import { db as defaultDb } from "@/db/schema";
import type { SyncSession } from "./syncClient";

const SYNCABLE_TABLES: readonly SyncableTableName[] = [
  "accounts",
  "transactions",
  "budgetCategories",
  "budgetSubcategories",
  "debts",
  "debtPayments",
  "users",
];

/** Matches the server's own limit (see the server's src/sync/routes.ts) —
 * pushes are chunked to this size rather than sent as one unbounded batch. */
const PUSH_BATCH_SIZE = 500;

type AnySyncedRow =
  | AccountRow
  | TransactionRow
  | BudgetCategoryRow
  | BudgetSubcategoryRow
  | DebtRow
  | DebtPaymentRow
  | UserRow;

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
    const rows = await table.toArray();
    for (const row of rows) {
      if (row.updatedAt > lastPushedAt) {
        records.push(rowToWireRecord(tableName, row));
      }
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
    const existing = await table.get(record.id);
    if (existing && existing.updatedAt > record.updatedAt) {
      // a newer local edit hasn't been pushed yet — do not let this pull
      // overwrite it; the next push will send the local version onward.
      continue;
    }

    if (record.deletedAt) {
      if (existing) {
        await table.delete(record.id);
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

/** Push before pull, deliberately: sending this device's own changes out
 * first means a pull immediately afterward reflects a more complete
 * picture (including what this device just contributed) rather than
 * potentially fetching a stale view and then separately pushing on top of
 * it. Does not fully eliminate every race with another device syncing at
 * the exact same moment — see this module's README for what is and isn't
 * handled yet. */
export async function syncNow(
  session: SyncSession,
  database: SezzAccountsDatabase = defaultDb,
): Promise<SyncResult> {
  const push = await pushChanges(session, database);
  const pull = await pullChanges(session, database);
  return { push, pull };
}
