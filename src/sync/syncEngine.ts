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

/**
 * ## Why this protocol compares a server-assigned sequence, not timestamps
 *
 * An earlier version of this module used last-write-wins by `updatedAt`:
 * an incoming record won a conflict if its updatedAt was newer than what
 * was stored. That had a serious flaw that caused a real incident, not a
 * hypothetical one: a deletion is always stamped with "right now", so it
 * always won against a genuinely newer edit from a device that simply
 * never learned about it. A device with a stale or empty local database
 * could silently erase newer data elsewhere purely because "just now"
 * outranks "last week" in a timestamp comparison — clock drift between
 * devices made this worse still.
 *
 * This version works the way `git push` does. The server assigns every
 * accepted create, update, or delete the *next* value of a single,
 * strictly increasing counter (`seq` — see the server's schema.ts and
 * sync/routes.ts). Every record this device knows about carries its own
 * `seq`, used as `baseSeq` the next time this device pushes a change to
 * it — proof the change is based on the latest known state, not a stale
 * one. If someone else changed the record first, the server *rejects*
 * that specific record and returns its current state, which this device
 * applies locally before the sync attempt is considered complete —
 * exactly like a rejected `git push` forcing a `pull`, rather than a
 * merge silently choosing a side by timestamp.
 *
 * `seq` lives on every syncable row (see WithSyncMeta in db/schema.ts) as
 * a field the sync engine manages exclusively — a repository's own
 * create()/update() never sets or reads it. A brand-new local record
 * simply has no `seq` yet, which already means exactly what it needs to:
 * "as far as this device knows, no version of this exists on the server".
 */

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
  seq?: number;
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
  seq: number;
}

function rowToWireRecord<T extends StorageRowShape>(
  tableName: SyncableTableName,
  row: T,
  overrides: Partial<Pick<WireRecord, "encData" | "deletedAt" | "updatedAt" | "createdAt">> = {},
): WireRecord {
  const { id, createdAt, updatedAt, seq, _enc, ...structural } = row;
  return {
    tableName,
    id,
    structural,
    encData: _enc,
    createdAt,
    updatedAt,
    // This is baseSeq on the wire, not the row's own future seq — the
    // server assigns a new one if it accepts this record at all. See
    // this module's own comment above for the full reasoning.
    seq: seq ?? 0,
    ...overrides,
  };
}

/** The inverse of rowToWireRecord. Reconstructs exactly what a repository
 * would have written — structural fields spread back out, `encData`
 * renamed back to `_enc`, plus the server's own `seq` for this record —
 * for `.put()` into the matching Dexie table. The cast to AnySyncedRow is
 * the one place this module can't stay fully generic: which concrete row
 * shape is correct depends on `tableName`, known only at runtime, and
 * Dexie's own `.put()` typing needs a single shape per call. */
function wireRecordToRow(record: WireRecord): AnySyncedRow {
  const base = {
    ...record.structural,
    id: record.id,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    seq: record.seq,
  };
  return (record.encData ? { ...base, _enc: record.encData } : base) as AnySyncedRow;
}

function getTable(database: SezzAccountsDatabase, tableName: SyncableTableName) {
  return database[tableName];
}

async function readCursor(
  database: SezzAccountsDatabase,
  key: "lastPushedAt" | "lastPulledSeq",
): Promise<number> {
  const entry = await database.syncConfig.get(key);
  return entry ? Number(entry.value) : 0;
}

async function writeCursor(
  database: SezzAccountsDatabase,
  key: "lastPushedAt" | "lastPulledSeq",
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

/** Applies the server's current, authoritative state for a record this
 * device just tried (and failed) to push — used both for a rejected
 * push and, in principle, would be identical logic to a pull; kept as
 * its own small function so pushChanges doesn't need to duplicate it. */
async function applyServerRecord(database: SezzAccountsDatabase, record: WireRecord) {
  const table = getTable(database, record.tableName);
  if (record.deletedAt) {
    await table.delete(record.id as UserRole);
  } else {
    await table.put(wireRecordToRow(record) as never);
  }
  // A rejected deletion's own local deletionLog entry is now moot — the
  // server's current version (just applied above) is what this device
  // shows going forward, not "deleted". Retrying the same stale entry
  // forever would only fail the same way again.
  await database.deletionLog
    .where("tableName")
    .equals(record.tableName)
    .and((entry) => entry.recordId === record.id)
    .delete();
}

export interface PushResult {
  pushed: number;
  /** Records this device tried to push that the server refused because
   * they'd changed since this device last saw them — each one's current
   * server state has already been applied locally by the time this
   * returns (see applyServerRecord above), not left for the caller to
   * handle. Surfaced mainly so the UI can tell the person "some of what
   * you tried to send wasn't applied" rather than staying silent about it. */
  conflicts: { tableName: SyncableTableName; id: string }[];
}

/** Sends every local change since the last successful push: rows whose
 * `updatedAt` is newer than the push cursor, across every syncable table,
 * plus any not-yet-pushed entries in the deletion log (converted to
 * minimal tombstone records — see deletionLog.ts for why creates/updates
 * and deletes are tracked so differently on the client). Each record
 * carries its own baseSeq (see this module's top comment); the server
 * resolves each independently, and any conflict is reconciled locally
 * (see applyServerRecord) before this returns. */
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
    // changed between syncs, the more this matters. This only decides
    // *what to attempt* sending — the server's seq compare-and-swap is
    // what actually arbitrates each one, not this timestamp filter.
    const rows = await table.where("updatedAt").above(lastPushedAt).toArray();
    for (const row of rows) {
      records.push(rowToWireRecord(tableName, row as StorageRowShape));
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
      seq: entry.baseSeq,
    });
  }

  if (records.length === 0) {
    return { pushed: 0, conflicts: [] };
  }

  const accepted: { tableName: SyncableTableName; id: string; seq: number }[] = [];
  const rejected: { tableName: SyncableTableName; id: string; current: WireRecord | null }[] = [];
  let serverTime = Date.now();

  for (let i = 0; i < records.length; i += PUSH_BATCH_SIZE) {
    const batch = records.slice(i, i + PUSH_BATCH_SIZE);
    const response = await fetch(`${session.serverUrl}/sync/push`, {
      method: "POST",
      headers: authHeaders(session),
      body: JSON.stringify({
        records: batch.map((r) => ({ ...r, baseSeq: r.seq })),
      }),
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
    for (const a of (body["accepted"] as typeof accepted | undefined) ?? []) {
      accepted.push(a);
    }
    for (const r of (body["rejected"] as typeof rejected | undefined) ?? []) {
      rejected.push(r);
    }
  }

  // Successfully accepted records (creates/updates) get their local row's
  // seq updated to what the server assigned — a targeted patch, not a
  // full re-write, so nothing else about the row is touched.
  for (const a of accepted) {
    const table = getTable(database, a.tableName);
    const stillExists = await table.get(a.id as UserRole);
    if (stillExists) {
      await table.update(a.id as UserRole, { seq: a.seq } as never);
    }
  }
  // Accepted deletions are pruned from the local deletion log — same as
  // before, just no longer keyed on a pushedAt timestamp comparison for
  // *whether* to prune, only for bookkeeping which entries these were.
  const acceptedIds = new Set(accepted.map((a) => `${a.tableName}:${a.id}`));
  const prunedLogIds = pendingDeletions
    .filter((entry) => acceptedIds.has(`${entry.tableName}:${entry.recordId}`))
    .map((entry) => entry.logId)
    .filter((id): id is number => id !== undefined);
  if (prunedLogIds.length > 0) {
    await database.deletionLog.bulkDelete(prunedLogIds);
  }

  for (const r of rejected) {
    if (r.current) {
      await applyServerRecord(database, r.current);
    } else {
      // rejected with no current server state at all is only possible
      // for a from-scratch create that collided — nothing to apply, but
      // still worth removing any stale deletion-log entry for the same id
      await database.deletionLog
        .where("tableName")
        .equals(r.tableName)
        .and((entry) => entry.recordId === r.id)
        .delete();
    }
  }

  await writeCursor(database, "lastPushedAt", serverTime);

  return {
    pushed: accepted.length,
    conflicts: rejected.map((r) => ({ tableName: r.tableName, id: r.id })),
  };
}

export interface PullResult {
  pulled: number;
  deleted: number;
}

/** Fetches every remote record with seq greater than this device's own
 * pull cursor and applies it locally — the server has already resolved
 * every conflict by the time anything reaches here (see pushChanges and
 * this module's top comment), so a pulled record is simply applied,
 * with no further per-record comparison needed on this side. */
export async function pullChanges(
  session: SyncSession,
  database: SezzAccountsDatabase = defaultDb,
): Promise<PullResult> {
  const lastPulledSeq = await readCursor(database, "lastPulledSeq");

  const response = await fetch(`${session.serverUrl}/sync/pull?since=${lastPulledSeq}`, {
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
    if (record.deletedAt) {
      const existing = await table.get(record.id as UserRole);
      if (existing) {
        await table.delete(record.id as UserRole);
        deleted += 1;
      }
      continue;
    }
    await table.put(wireRecordToRow(record) as never);
    pulled += 1;
  }

  const serverSeq = typeof body["serverSeq"] === "number" ? body["serverSeq"] : lastPulledSeq;
  await writeCursor(database, "lastPulledSeq", serverSeq);

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
  /** How many of this device's own pushed changes were refused because
   * they'd changed elsewhere first — each one's current server state has
   * already been applied locally by the time this is recorded (see
   * applyServerRecord), so this is informational, not an action the
   * person needs to take, but worth surfacing rather than staying silent. */
  conflicts?: number;
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
 * it. Any conflict pushChanges hits is already reconciled locally by the
 * time it returns (see applyServerRecord) — nothing here needs to retry
 * or merge anything further.
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
      conflicts: push.conflicts.length,
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
