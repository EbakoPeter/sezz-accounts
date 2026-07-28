import type { SezzAccountsDatabase } from "./schema";
import { db as defaultDb } from "./schema";
import type { BudgetCategory, BudgetSubcategory, Debt, DebtPayment } from "@/types/models";
import { toStorageRow, fromStorageRow, fromStorageRows } from "./encryptedRecord";
import { generateId } from "@/lib/id";
import { monthsBetween } from "./debtSummary";

const SENSITIVE_CATEGORY_FIELDS = ["name"] as const;
const SENSITIVE_SUBCATEGORY_FIELDS = ["name", "monthlyAllocation"] as const;

const CATEGORY_NAME = "Dettes";
const SUBCATEGORY_NAME = "Dette";

/**
 * Ensures the auto-managed "Dette" budget line exists, creating both it
 * and its "Dettes" category the first time any debt is created if
 * neither already does — called from debtsRepository.create() so the
 * line appears automatically as soon as it's actually needed, rather
 * than requiring a person to think to set it up themselves.
 *
 * Idempotent and safe to call repeatedly: does nothing once a
 * subcategory with autoAllocateFromDebts is already present, and reuses
 * an existing "Dettes" category by name rather than creating a
 * duplicate if the person already happened to make one of their own.
 *
 * This function only ensures the *line* exists — its actual allocation
 * is never stored here or anywhere else; see
 * computeDebtBudgetAllocation below, which getBudgetSummary calls live
 * every time instead of reading a stored value.
 */
export async function ensureDebtBudgetLine(
  database: SezzAccountsDatabase = defaultDb,
): Promise<void> {
  const existingSubcategoryRows = await database.budgetSubcategories.toArray();
  const alreadyExists = existingSubcategoryRows.some((row) => row.autoAllocateFromDebts === true);
  if (alreadyExists) return;

  const categoryRows = await database.budgetCategories.toArray();
  let categoryId: string | undefined;
  for (const row of categoryRows) {
    const category = await fromStorageRow<BudgetCategory>(row);
    if (category.name === CATEGORY_NAME) {
      categoryId = category.id;
      break;
    }
  }

  const now = Date.now();
  if (!categoryId) {
    categoryId = generateId();
    const category: BudgetCategory = {
      id: categoryId,
      name: CATEGORY_NAME,
      createdAt: now,
      updatedAt: now,
    };
    await database.budgetCategories.add(await toStorageRow(category, SENSITIVE_CATEGORY_FIELDS));
  }

  const subcategory: BudgetSubcategory = {
    id: generateId(),
    categoryId,
    name: SUBCATEGORY_NAME,
    // Never actually read — see the field's own comment in models.ts —
    // kept at 0 rather than the real computed sum purely so nothing here
    // duplicates a value that must only ever come from
    // computeDebtBudgetAllocation.
    monthlyAllocation: 0,
    autoAllocateFromDebts: true,
    createdAt: now,
    updatedAt: now,
  };
  await database.budgetSubcategories.add(
    await toStorageRow(subcategory, SENSITIVE_SUBCATEGORY_FIELDS),
  );
}

/** The live sum this budget line's allocation always equals: every
 * unsettled ("dette", not "créance", and not yet fully repaid) debt's
 * own planned monthly payment (amount ÷ months until its due date — see
 * debtSummary.ts, the same figure DebtsPanel already shows per debt).
 * Never stored — recomputed on every call, exactly like every other
 * figure getBudgetSummary produces, so it can never drift from the
 * debts it's summarizing. A debt with no due date contributes nothing
 * here (see debtSummary.ts: nothing to derive a monthly figure from),
 * the same as it already shows nothing in DebtsPanel's own column. */
export async function computeDebtBudgetAllocation(database: SezzAccountsDatabase): Promise<number> {
  const [debtRows, paymentRows] = await Promise.all([
    database.debts.toArray(),
    database.debtPayments.toArray(),
  ]);
  const [debts, payments] = await Promise.all([
    fromStorageRows<Debt>(debtRows),
    fromStorageRows<DebtPayment>(paymentRows),
  ]);

  const paidByDebt = new Map<string, number>();
  for (const payment of payments) {
    paidByDebt.set(payment.debtId, (paidByDebt.get(payment.debtId) ?? 0) + payment.amount);
  }

  let total = 0;
  for (const debt of debts) {
    if (debt.kind !== "debt") continue;
    if (!debt.dueDate) continue;
    const remaining = debt.amount - (paidByDebt.get(debt.id) ?? 0);
    if (remaining <= 0) continue;
    total += Math.round(debt.amount / monthsBetween(debt.date, debt.dueDate));
  }
  return total;
}
