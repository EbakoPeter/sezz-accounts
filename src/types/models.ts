/**
 * Domain model.
 *
 * Normalization rules followed throughout this module:
 *  - Every entity has exactly one surrogate primary key (`id`).
 *  - Relationships are expressed as foreign keys (`accountId`, `categoryId`, ...),
 *    never by duplicating a human-readable name on the child record. Renaming an
 *    Account or a BudgetSubcategory therefore requires touching zero other rows.
 *  - Derived values (account balances, budget totals, ...) are never stored.
 *    They are computed on read by the repository layer so there is exactly one
 *    source of truth for each fact.
 *  - Monetary amounts are always integers (whole FCFA). Floats are never used
 *    for money, anywhere, to avoid rounding-error bugs.
 */

/** Epoch milliseconds, as returned by `Date.now()`. */
export type Timestamp = number;

/** ISO calendar date, "YYYY-MM-DD". Deliberately not a `Date` object: it is
 * what forms produce, what Dexie indexes cleanly, and it avoids timezone
 * bugs entirely since no time-of-day or offset is ever attached. */
export type IsoDate = string;

export interface Account {
  id: string;
  name: string;
  /** Opening balance, in whole FCFA. Everything after this is derived from transactions. */
  initialBalance: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type TransactionKind = "income" | "expense";

export interface Transaction {
  id: string;
  accountId: string;
  kind: TransactionKind;
  date: IsoDate;
  label: string;
  /** Always a positive integer; direction is carried by `kind`, never by sign. */
  amount: number;
  /** Foreign key to a future BudgetSubcategory. Optional because income rows
   * and not-yet-categorized expenses may not have one. */
  categoryId?: string;
  note?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** Fields a caller may set when creating an Account; identifiers and
 * timestamps are always assigned by the repository, never by the caller. */
export type NewAccount = Pick<Account, "name" | "initialBalance">;
export type AccountUpdate = Partial<Pick<Account, "name" | "initialBalance">>;

export type NewTransaction = Pick<Transaction, "accountId" | "kind" | "date" | "label" | "amount"> &
  Partial<Pick<Transaction, "categoryId" | "note">>;
export type TransactionUpdate = Partial<
  Pick<Transaction, "date" | "label" | "amount" | "categoryId" | "note">
>;
