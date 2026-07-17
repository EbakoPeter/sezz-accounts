import Dexie, { type EntityTable } from "dexie";
import type {
  Account,
  Transaction,
  BudgetCategory,
  BudgetSubcategory,
  Debt,
  DebtPayment,
  User,
} from "@/types/models";
import type { WithEncrypted } from "./encryptedRecord";

/**
 * These are the shapes actually written to IndexedDB — structural
 * (queryable) fields in the clear, sensitive fields bundled into one
 * encrypted `_enc` blob (see src/db/encryptedRecord.ts for why, and
 * src/lib/encryption.ts for how). Each repository is responsible for
 * converting to/from its entity's logical type (Account, Transaction, ...)
 * on the way in/out — Dexie itself only ever sees these storage shapes.
 */
export type AccountRow = Pick<Account, "id" | "createdAt" | "updatedAt"> & WithEncrypted;
export type TransactionRow = Pick<
  Transaction,
  "id" | "accountId" | "kind" | "date" | "subcategoryId" | "createdAt" | "updatedAt"
> &
  WithEncrypted;
export type BudgetCategoryRow = Pick<BudgetCategory, "id" | "createdAt" | "updatedAt"> &
  WithEncrypted;
export type BudgetSubcategoryRow = Pick<
  BudgetSubcategory,
  "id" | "categoryId" | "createdAt" | "updatedAt"
> &
  WithEncrypted;
export type DebtRow = Pick<
  Debt,
  "id" | "accountId" | "kind" | "reference" | "date" | "createdAt" | "updatedAt"
> &
  WithEncrypted;
export type DebtPaymentRow = Pick<
  DebtPayment,
  "id" | "debtId" | "accountId" | "date" | "createdAt" | "updatedAt"
> &
  WithEncrypted;
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
  WithEncrypted;

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
  users!: EntityTable<UserRow, "id">;

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
  }
}

export const db = new SezzAccountsDatabase();
