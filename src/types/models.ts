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
  /** Foreign key to a BudgetSubcategory. Optional because income rows have
   * none. For an expense, this is never chosen directly — it's derived
   * from the linked Engagement (see engagementId below) and kept here so
   * every existing reader (budgetSummary.ts, monthlyReport.ts, etc.) that
   * already groups by subcategoryId keeps working unchanged. Named
   * `subcategoryId` (not `categoryId`) because the monthly allocation and
   * the actual/gap comparison both live at the subcategory level — see
   * BudgetSubcategory below. A BudgetCategory is purely a grouping label
   * with no amount of its own; its totals are always the sum of its
   * subcategories. */
  subcategoryId?: string;
  /** Foreign key to the Engagement this expense settles. Required for
   * every expense (an expense can only be recorded against money already
   * engaged — see transactionsRepository.ts's assertSettlesEngagement)
   * and never present on income, which has no engagement to settle.
   * Recording an expense here is what moves its engagement from
   * "engagé" to "réalisé" — see EngagementStatus in this file. */
  engagementId?: string;
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
  Partial<Pick<Transaction, "note">> & {
    /** Required for an expense (see Transaction.engagementId's own
     * comment); never provided for income. */
    engagementId?: string;
  };
export type TransactionUpdate = Partial<
  Pick<Transaction, "accountId" | "kind" | "date" | "label" | "amount" | "note">
> & {
  /** undefined = leave unchanged; null = explicitly clear (e.g. the
   * transaction's kind changed to "income", which has no subcategory);
   * a string = set to that subcategory. Only ever set as a side effect of
   * engagementId changing, never chosen independently for an expense. */
  subcategoryId?: string | null;
  /** Same undefined/null/string convention as subcategoryId. */
  engagementId?: string | null;
};

/**
 * A movement of money between two of the household's own accounts —
 * deliberately its own entity rather than a linked pair of Transactions.
 * A transfer is neither income nor an expense (nothing was earned or
 * spent, money just moved pots), so keeping it separate means the
 * monthly report and recommendations, which read from Transaction, never
 * need to know transfers exist or filter them out — they simply aren't
 * Transactions. accountFlows.ts is the one place that debits the source
 * and credits the destination.
 */
export interface Transfer {
  id: string;
  fromAccountId: string;
  toAccountId: string;
  /** Always a positive integer. */
  amount: number;
  date: IsoDate;
  label?: string;
  note?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type NewTransfer = Pick<Transfer, "fromAccountId" | "toAccountId" | "amount" | "date"> &
  Partial<Pick<Transfer, "label" | "note">>;
export type TransferUpdate = Partial<
  Pick<Transfer, "fromAccountId" | "toAccountId" | "amount" | "date" | "label" | "note">
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
  Pick<Debt, "kind" | "counterparty" | "accountId" | "amount" | "date" | "description">
> & {
  /** undefined = leave unchanged; null = explicitly clear; a date string =
   * set to that due date. Same convention as Transaction's subcategoryId. */
  dueDate?: IsoDate | null;
};

export type NewDebtPayment = Pick<DebtPayment, "debtId" | "accountId" | "amount" | "date">;
export type DebtPaymentUpdate = Partial<Pick<DebtPayment, "accountId" | "amount" | "date">>;

export type EngagementStatus = "engaged" | "realized" | "cancelled";

/**
 * Money set aside against a budget subcategory for a known future expense,
 * before any transaction records it as actually spent. A third state
 * alongside "prévisionnel" (the subcategory's monthlyAllocation) and
 * "réel" (actual, computed from transactions): this is "engagé" — promised,
 * not yet paid. Deliberately not linked to a specific Transaction id: the
 * connection between an engagement and the transaction that eventually
 * fulfills it is tracked only by the person changing its status by hand
 * (to "realized" once actually paid, or "cancelled" if it falls through),
 * not by any automatic matching.
 */
export interface Engagement {
  id: string;
  subcategoryId: string;
  amount: number;
  label: string;
  date: IsoDate;
  status: EngagementStatus;
  note?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type NewEngagement = Pick<Engagement, "subcategoryId" | "amount" | "label" | "date"> &
  Partial<Pick<Engagement, "note">>;
export type EngagementUpdate = Partial<
  Pick<Engagement, "subcategoryId" | "amount" | "label" | "date" | "status" | "note">
>;

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

/** A stored, editable permission set for a role — the "profil" an
 * administrator configures once (permit/deny per privilege) that then
 * applies as the default for every new user of that role. Distinct from
 * an individual User's own `permissions`: creating a user copies the
 * role's current template at that moment, but editing the template
 * afterward does not retroactively change users already created — the
 * same relationship a role already had with ROLE_DEFAULT_PERMISSIONS
 * before this became editable and stored rather than a hardcoded
 * constant. */
export interface RoleTemplate {
  id: UserRole;
  permissions: Permissions;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
export type RoleTemplateUpdate = Pick<RoleTemplate, "permissions">;

export interface User {
  id: string;
  username: string;
  displayName: string;
  passwordHash: string;
  passwordSalt: string;
  /** This user's own copy of the shared Data Encryption Key, wrapped
   * (encrypted) under a key derived from their password + dekSalt. Every
   * user has their own wrapped copy of the *same* underlying DEK — see
   * src/lib/encryption.ts for why data is protected this way rather than
   * with a key derived directly from one user's password. */
  wrappedDek: { iv: string; data: string };
  dekSalt: string;
  /** A second, independent wrapped copy of the *same* shared DEK, this one
   * unlockable with the recovery code shown once at account creation
   * instead of the password — the way back in if the password is
   * forgotten. Verified/derived exactly like a password (hash+salt,
   * PBKDF2), never stored or comparable in plain text. */
  recoveryCodeHash: string;
  recoveryCodeSalt: string;
  wrappedDekByRecoveryCode: { iv: string; data: string };
  recoveryDekSalt: string;
  /** Consecutive failed login attempts since the last success; resets to 0
   * on a correct password. Never incremented while already locked out
   * (see UsersRepository.authenticate) so hammering a locked account
   * cannot compound its own lockout indefinitely. */
  failedLoginAttempts: number;
  /** Set once `failedLoginAttempts` crosses the threshold; authentication
   * is refused until this moment passes, regardless of whether the
   * password given is actually correct. */
  lockedUntil?: Timestamp;
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
