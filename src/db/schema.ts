import Dexie, { type EntityTable } from "dexie";
import type {
  Account,
  Transaction,
  Transfer,
  BudgetCategory,
  BudgetSubcategory,
  Debt,
  DebtPayment,
  Engagement,
  User,
  RoleTemplate,
} from "@/types/models";
import type { WithEncrypted } from "./encryptedRecord";

/** Every row's actual stored shape, once the sync protocol below needs to
 * track a server log position for it — see the module comment in
 * syncEngine.ts for the full reasoning. `seq` is managed exclusively by
 * the sync engine itself (set on pull, or after a push is accepted),
 * never by a repository's create()/update() — a brand new local record
 * has no seq at all until it's first synced, which is exactly what
 * "undefined" already means here without needing a special sentinel. */
export interface WithSyncMeta extends WithEncrypted {
  seq?: number;
}

/**
 * These are the shapes actually written to IndexedDB — structural
 * (queryable) fields in the clear, sensitive fields bundled into one
 * encrypted `_enc` blob (see src/db/encryptedRecord.ts for why, and
 * src/lib/encryption.ts for how). Each repository is responsible for
 * converting to/from its entity's logical type (Account, Transaction, ...)
 * on the way in/out — Dexie itself only ever sees these storage shapes.
 */
export type AccountRow = Pick<Account, "id" | "createdAt" | "updatedAt"> & WithSyncMeta;
export type TransactionRow = Pick<
  Transaction,
  | "id"
  | "accountId"
  | "kind"
  | "date"
  | "subcategoryId"
  | "engagementId"
  | "createdAt"
  | "updatedAt"
> &
  WithSyncMeta;
export type BudgetCategoryRow = Pick<BudgetCategory, "id" | "createdAt" | "updatedAt"> &
  WithSyncMeta;
export type BudgetSubcategoryRow = Pick<
  BudgetSubcategory,
  "id" | "categoryId" | "createdAt" | "updatedAt"
> &
  WithSyncMeta;
export type DebtRow = Pick<
  Debt,
  "id" | "accountId" | "kind" | "reference" | "date" | "createdAt" | "updatedAt"
> &
  WithSyncMeta;
export type DebtPaymentRow = Pick<
  DebtPayment,
  "id" | "debtId" | "accountId" | "date" | "createdAt" | "updatedAt"
> &
  WithSyncMeta;
export type TransferRow = Pick<
  Transfer,
  "id" | "fromAccountId" | "toAccountId" | "date" | "createdAt" | "updatedAt"
> &
  WithSyncMeta;
export type EngagementRow = Pick<
  Engagement,
  "id" | "subcategoryId" | "date" | "status" | "createdAt" | "updatedAt"
> &
  WithSyncMeta;
export type UserRow = Pick<
  User,
  | "id"
  | "username"
  | "passwordHash"
  | "passwordSalt"
  | "wrappedDek"
  | "dekSalt"
  | "recoveryCodeHash"
  | "recoveryCodeSalt"
  | "wrappedDekByRecoveryCode"
  | "recoveryDekSalt"
  | "failedLoginAttempts"
  | "lockedUntil"
  | "role"
  | "permissions"
  | "createdAt"
  | "updatedAt"
> &
  WithSyncMeta;

/** `permissions` is deliberately kept structural (unencrypted), matching
 * the same field on UserRow above — a permit/deny configuration isn't
 * sensitive data. Still includes WithEncrypted (holding an empty
 * placeholder payload, never anything meaningful) purely so this table
 * fits the sync engine's uniform "every row has _enc" row shape without
 * needing a special case there for the one table with nothing to
 * encrypt. */
export type RoleTemplateRow = RoleTemplate & WithSyncMeta;

/** Every table sync can push/pull, by its Dexie table name — deliberately a
 * plain string union rather than importing each repository, since this
 * schema module must not depend on the repository layer. */
export type SyncableTableName =
  | "accounts"
  | "transactions"
  | "transfers"
  | "budgetCategories"
  | "budgetSubcategories"
  | "engagements"
  | "debts"
  | "debtPayments"
  | "users"
  | "roleTemplates";

/**
 * Records "this id, in this table, was deleted locally" — written
 * alongside a repository's normal (still hard) delete, purely so the sync
 * engine has something to discover and push as a tombstone later. This is
 * deliberately not a switch to soft-deletes everywhere: that would mean
 * touching every repository's list/get query (and every computation
 * module that reads tables directly) to filter deleted rows out, for a
 * property only the sync engine actually needs. A small satellite log,
 * pruned once pushed, gets the same result with far less blast radius.
 */
export interface DeletionLogEntry {
  logId?: number;
  tableName: SyncableTableName;
  recordId: string;
  deletedAt: number;
  /** This device's last-known server log position for the record at the
   * moment it was deleted locally — becomes the tombstone's baseSeq when
   * pushed (see syncEngine.ts's module comment). 0 for a record that was
   * created and deleted locally before ever being synced at all, which
   * the server correctly treats the same as "never existed" rather than
   * rejecting as a stale deletion. */
  baseSeq: number;
  /** Set once this entry has been included in a successful push — entries
   * with this set are pruned on a later sync rather than kept forever. */
  pushedAt?: number;
}

/** Simple key/value store for sync configuration and cursors — which
 * server, which sync account, the session token, and how far push/pull
 * have each progressed. Deliberately its own tiny table rather than
 * localStorage: it keeps every piece of this app's state in one place
 * (Dexie), inspectable with the same tooling as everything else. */
export interface SyncConfigEntry {
  key:
    "serverUrl" | "token" | "syncAccountId" | "lastPushedAt" | "lastPulledSeq" | "lastSyncStatus";
  value: string;
}

/**
 * IndexedDB schema, versioned via Dexie. Each `.version(n).stores(...)` call
 * is an append-only migration step — never edit an already-shipped version's
 * index string; add a new `.version()` instead, exactly like a SQL migration.
 *
 * Index strings list which fields are queryable (`db.table.where(...)`), not
 * which fields exist on the record — Dexie/IndexedDB stores full objects
 * regardless.
 */
export class SezzAccountsDatabase extends Dexie {
  accounts!: EntityTable<AccountRow, "id">;
  transactions!: EntityTable<TransactionRow, "id">;
  budgetCategories!: EntityTable<BudgetCategoryRow, "id">;
  budgetSubcategories!: EntityTable<BudgetSubcategoryRow, "id">;
  debts!: EntityTable<DebtRow, "id">;
  debtPayments!: EntityTable<DebtPaymentRow, "id">;
  transfers!: EntityTable<TransferRow, "id">;
  engagements!: EntityTable<EngagementRow, "id">;
  users!: EntityTable<UserRow, "id">;
  roleTemplates!: EntityTable<RoleTemplateRow, "id">;
  deletionLog!: EntityTable<DeletionLogEntry, "logId">;
  syncConfig!: EntityTable<SyncConfigEntry, "key">;

  constructor(name = "SezzAccountsDB") {
    super(name);
    this.version(1).stores({
      accounts: "id, name",
      transactions: "id, accountId, kind, date, categoryId, [accountId+date]",
    });
    // v2: budget categories/subcategories, and Transaction.categoryId was
    // renamed to subcategoryId (see src/types/models.ts) — re-declared here
    // under its new name. Existing rows keep working: Dexie only enforces
    // that indexed fields exist for *new* writes going forward, so this is
    // safe to add without a data migration for a field that had no rows yet.
    this.version(2).stores({
      accounts: "id, name",
      transactions: "id, accountId, kind, date, subcategoryId, [accountId+date]",
      budgetCategories: "id, name",
      budgetSubcategories: "id, categoryId, name",
    });
    // v3: debts and debt payments. Note debtPayments references debts by
    // `debtId` (a real foreign key) rather than by the human-facing
    // `reference` string on Debt — that string is display-only.
    this.version(3).stores({
      accounts: "id, name",
      transactions: "id, accountId, kind, date, subcategoryId, [accountId+date]",
      budgetCategories: "id, name",
      budgetSubcategories: "id, categoryId, name",
      debts: "id, accountId, kind, reference, date",
      debtPayments: "id, debtId, accountId, date",
    });
    // v4: local user profiles with configurable per-action permissions.
    this.version(4).stores({
      accounts: "id, name",
      transactions: "id, accountId, kind, date, subcategoryId, [accountId+date]",
      budgetCategories: "id, name",
      budgetSubcategories: "id, categoryId, name",
      debts: "id, accountId, kind, reference, date",
      debtPayments: "id, debtId, accountId, date",
      users: "id, username",
    });
    // v5: encryption at rest. Every sensitive field (names, amounts, labels,
    // descriptions, ...) is now bundled into one encrypted `_enc` blob per
    // record (see src/db/encryptedRecord.ts) rather than stored as a plain
    // top-level property — so `name` can no longer be a Dexie index (you
    // cannot index ciphertext meaningfully); sorting by name now happens in
    // memory, after decryption, in the repository layer instead. Structural
    // fields that were never sensitive in the first place (ids, dates,
    // `kind`, foreign keys) are unaffected and keep working exactly as before.
    this.version(5).stores({
      accounts: "id",
      transactions: "id, accountId, kind, date, subcategoryId, [accountId+date]",
      budgetCategories: "id",
      budgetSubcategories: "id, categoryId",
      debts: "id, accountId, kind, reference, date",
      debtPayments: "id, debtId, accountId, date",
      users: "id, username",
    });
    // v6: multi-device sync. deletionLog lets the sync engine discover
    // local deletions to push as tombstones without every repository's
    // reads needing to filter a soft-delete flag (see DeletionLogEntry's
    // own comment for why that tradeoff was made). syncConfig holds the
    // sync account session and push/pull cursors.
    this.version(6).stores({
      accounts: "id",
      transactions: "id, accountId, kind, date, subcategoryId, [accountId+date]",
      budgetCategories: "id",
      budgetSubcategories: "id, categoryId",
      debts: "id, accountId, kind, reference, date",
      debtPayments: "id, debtId, accountId, date",
      users: "id, username",
      deletionLog: "++logId, tableName, deletedAt, pushedAt",
      syncConfig: "key",
    });
    // v7: transfers between the household's own accounts. Deliberately its
    // own table rather than reusing transactions with a "transfer" kind —
    // see the Transfer type's own comment in src/types/models.ts for why.
    this.version(7).stores({
      accounts: "id",
      transactions: "id, accountId, kind, date, subcategoryId, [accountId+date]",
      transfers: "id, fromAccountId, toAccountId, date",
      budgetCategories: "id",
      budgetSubcategories: "id, categoryId",
      debts: "id, accountId, kind, reference, date",
      debtPayments: "id, debtId, accountId, date",
      users: "id, username",
      deletionLog: "++logId, tableName, deletedAt, pushedAt",
      syncConfig: "key",
    });
    // v8: budget engagements — money committed against a subcategory for a
    // known future expense, before any transaction records it as actually
    // spent. See the Engagement type's own comment in src/types/models.ts.
    this.version(8).stores({
      accounts: "id",
      transactions: "id, accountId, kind, date, subcategoryId, [accountId+date]",
      transfers: "id, fromAccountId, toAccountId, date",
      budgetCategories: "id",
      budgetSubcategories: "id, categoryId",
      engagements: "id, subcategoryId, date, status",
      debts: "id, accountId, kind, reference, date",
      debtPayments: "id, debtId, accountId, date",
      users: "id, username",
      deletionLog: "++logId, tableName, deletedAt, pushedAt",
      syncConfig: "key",
    });
    // v9: indexes `updatedAt` on every syncable table, and `date` alone on
    // transactions (a plain, non-compound index — the existing
    // [accountId+date] compound index can't serve a query that filters by
    // date without also filtering by account). Both exist purely for
    // query performance, not new capability:
    //  - the sync engine's push scan (syncEngine.ts) used to fetch every
    //    row of every table and filter by updatedAt in memory; with this
    //    index it can ask IndexedDB directly for "rows newer than the last
    //    push", touching only what actually changed;
    //  - budgetSummary.ts and monthlyReport.ts used to fetch every
    //    transaction ever recorded and filter to the requested month/year
    //    in memory; with this index they can ask for just that date range.
    this.version(9).stores({
      accounts: "id, updatedAt",
      transactions: "id, accountId, kind, date, subcategoryId, [accountId+date], updatedAt",
      transfers: "id, fromAccountId, toAccountId, date, updatedAt",
      budgetCategories: "id, updatedAt",
      budgetSubcategories: "id, categoryId, updatedAt",
      engagements: "id, subcategoryId, date, status, updatedAt",
      debts: "id, accountId, kind, reference, date, updatedAt",
      debtPayments: "id, debtId, accountId, date, updatedAt",
      users: "id, username, updatedAt",
      deletionLog: "++logId, tableName, deletedAt, pushedAt",
      syncConfig: "key",
    });
    // v10: indexes `engagementId` on transactions. Every expense now
    // settles a specific Engagement (see Transaction.engagementId's own
    // comment in src/types/models.ts) — this index lets
    // transactionsRepository look up "is there already a transaction
    // settling this engagement" (needed when an edit moves an expense off
    // one engagement, or when an engagement itself is deleted) without a
    // full table scan.
    this.version(10).stores({
      accounts: "id, updatedAt",
      transactions:
        "id, accountId, kind, date, subcategoryId, engagementId, [accountId+date], updatedAt",
      transfers: "id, fromAccountId, toAccountId, date, updatedAt",
      budgetCategories: "id, updatedAt",
      budgetSubcategories: "id, categoryId, updatedAt",
      engagements: "id, subcategoryId, date, status, updatedAt",
      debts: "id, accountId, kind, reference, date, updatedAt",
      debtPayments: "id, debtId, accountId, date, updatedAt",
      users: "id, username, updatedAt",
      deletionLog: "++logId, tableName, deletedAt, pushedAt",
      syncConfig: "key",
    });
    // v11: roleTemplates — the "Profil" screen's stored, editable
    // permit/deny grid per role (admin/standard/viewer), replacing what
    // used to be only a hardcoded constant (ROLE_DEFAULT_PERMISSIONS)
    // with something an administrator can actually change and have
    // persist. Only three rows ever exist, one per UserRole, lazily
    // seeded from that same constant the first time they're read (see
    // roleTemplatesRepository.ts) rather than created through a
    // migration here, so the seed logic lives in one place.
    this.version(11).stores({
      accounts: "id, updatedAt",
      transactions:
        "id, accountId, kind, date, subcategoryId, engagementId, [accountId+date], updatedAt",
      transfers: "id, fromAccountId, toAccountId, date, updatedAt",
      budgetCategories: "id, updatedAt",
      budgetSubcategories: "id, categoryId, updatedAt",
      engagements: "id, subcategoryId, date, status, updatedAt",
      debts: "id, accountId, kind, reference, date, updatedAt",
      debtPayments: "id, debtId, accountId, date, updatedAt",
      users: "id, username, updatedAt",
      roleTemplates: "id, updatedAt",
      deletionLog: "++logId, tableName, deletedAt, pushedAt",
      syncConfig: "key",
    });
  }
}

export const db = new SezzAccountsDatabase();
