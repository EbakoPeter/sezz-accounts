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
  /** Foreign key to a BudgetSubcategory. Optional because income rows and
   * not-yet-categorized expenses may not have one. Named `subcategoryId`
   * (not `categoryId`) because the monthly allocation and the actual/gap
   * comparison both live at the subcategory level — see BudgetSubcategory
   * below. A BudgetCategory is purely a grouping label with no amount of
   * its own; its totals are always the sum of its subcategories. */
  subcategoryId?: string;
  note?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface BudgetCategory {
  id: string;
  name: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface BudgetSubcategory {
  id: string;
  categoryId: string;
  name: string;
  /** Planned spend per month, in whole FCFA. Zero means "not provisioned". */
  monthlyAllocation: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** "debt" = money the user owes to someone; "receivable" = money someone
 * owes the user. Kept as an English discriminator internally; the UI is
 * free to label these "Dette" / "Créance" without that leaking into the
 * data model. */
export type DebtKind = "debt" | "receivable";

export interface Debt {
  id: string;
  /** Short, human-facing, auto-incrementing label ("D01", "D02", ...).
   * Display-only — every actual relationship (payments) is by `id`, never
   * by this reference, so it is safe to show, copy, or print without it
   * ever being used as a join key. */
  reference: string;
  kind: DebtKind;
  counterparty: string;
  accountId: string;
  /** Original amount, whole FCFA, always positive regardless of kind. */
  amount: number;
  date: IsoDate;
  dueDate?: IsoDate;
  description?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface DebtPayment {
  id: string;
  debtId: string;
  accountId: string;
  amount: number;
  date: IsoDate;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** Fields a caller may set when creating an Account; identifiers and
 * timestamps are always assigned by the repository, never by the caller. */
export type NewAccount = Pick<Account, "name" | "initialBalance">;
export type AccountUpdate = Partial<Pick<Account, "name" | "initialBalance">>;

export type NewTransaction = Pick<Transaction, "accountId" | "kind" | "date" | "label" | "amount"> &
  Partial<Pick<Transaction, "subcategoryId" | "note">>;
export type TransactionUpdate = Partial<
  Pick<Transaction, "date" | "label" | "amount" | "subcategoryId" | "note">
>;

export type NewBudgetCategory = Pick<BudgetCategory, "name">;
export type BudgetCategoryUpdate = Partial<Pick<BudgetCategory, "name">>;

export type NewBudgetSubcategory = Pick<
  BudgetSubcategory,
  "categoryId" | "name" | "monthlyAllocation"
>;
export type BudgetSubcategoryUpdate = Partial<
  Pick<BudgetSubcategory, "name" | "monthlyAllocation">
>;

/** `reference` is deliberately excluded: it is always auto-assigned by the
 * repository, never chosen by the caller (see DebtsRepository.create). */
export type NewDebt = Pick<Debt, "kind" | "counterparty" | "accountId" | "amount" | "date"> &
  Partial<Pick<Debt, "dueDate" | "description">>;
export type DebtUpdate = Partial<
  Pick<Debt, "counterparty" | "accountId" | "amount" | "date" | "dueDate" | "description">
>;

export type NewDebtPayment = Pick<DebtPayment, "debtId" | "accountId" | "amount" | "date">;
export type DebtPaymentUpdate = Partial<Pick<DebtPayment, "accountId" | "amount" | "date">>;

/**
 * One flag per protected action. Deliberately explicit and per-user rather
 * than purely role-derived: `role` provides a sensible starting point
 * (applied when a user is created or has its role changed), but each flag
 * can be individually overridden afterwards — this is what makes privileges
 * "configurable" rather than a fixed, closed set of three tiers.
 */
export interface Permissions {
  manageAccounts: boolean;
  manageTransactions: boolean;
  manageBudget: boolean;
  manageDebts: boolean;
  viewReports: boolean;
  /** Create/edit/delete other users, change their role or permissions.
   * At least one user with this flag set to true must always exist —
   * enforced by UsersRepository, not by the UI. */
  manageUsers: boolean;
}

export type UserRole = "admin" | "standard" | "viewer";

export interface User {
  id: string;
  username: string;
  displayName: string;
  passwordHash: string;
  passwordSalt: string;
  role: UserRole;
  permissions: Permissions;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type NewUser = Pick<User, "username" | "displayName" | "role"> & {
  password: string;
  /** Defaults to the role's standard permission set when omitted. */
  permissions?: Permissions;
};
export type UserUpdate = Partial<Pick<User, "displayName" | "role" | "permissions">>;
