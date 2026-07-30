import type { SezzAccountsDatabase } from "./schema";
import { db as defaultDb } from "./schema";
import type { BudgetCategory, BudgetSubcategory, Debt, DebtPayment } from "@/types/models";
import { toStorageRow, fromStorageRows, fromStorageRowOrUndefined } from "./encryptedRecord";
import { monthsBetween } from "./debtSummary";

const SENSITIVE_CATEGORY_FIELDS = ["name"] as const;
const SENSITIVE_SUBCATEGORY_FIELDS = ["name", "monthlyAllocation"] as const;

const CATEGORY_NAME = "Dettes";
const SUBCATEGORY_NAME = "Dette";

/** Fixed, well-known ids rather than freshly generated ones — see
 * ensureDebtBudgetLine's own comment for why, and forecastAccount.ts's
 * matching comment for the underlying race this avoids in more detail. */
const AUTO_CATEGORY_ID = "debts-budget-category-singleton";
const AUTO_SUBCATEGORY_ID = "debts-budget-subcategory-singleton";

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
 * Uses fixed ids for the category/subcategory this function itself
 * creates, for the same reason forecastAccount.ts's ensureForecastAccount
 * does — see its own comment for the full reasoning. In short: this can
 * be triggered once per debt, including many in quick succession during
 * an initial sync pull, and two overlapping calls both seeing "no
 * auto-allocated line yet" would otherwise both create one. A category
 * or subcategory's *name* is encrypted, so "does one with this name
 * exist" can't safely be checked inside a single atomic transaction the
 * way roleTemplatesRepository.ts's fix does (that field is a plain,
 * unencrypted primary key); a fixed id sidesteps needing to, since
 * Dexie's own uniqueness constraint on that key means at most one of two
 * concurrent add() calls can ever succeed.
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

  const now = Date.now();
  let categoryId: string;

  const existingAutoCategory = await database.budgetCategories.get(AUTO_CATEGORY_ID);
  if (existingAutoCategory) {
    categoryId = AUTO_CATEGORY_ID;
  } else {
    const categoryRows = await database.budgetCategories.toArray();
    let legacyMatch: string | undefined;
    for (const row of categoryRows) {
      // A category this device can't decrypt (a mismatched sync key —
      // see DecryptionError) is simply irrelevant noise for this specific
      // by-name search, not a reason to fail the whole lookup: one
      // unrelated bad category anywhere in a household's data would
      // otherwise block creating *any* new debt at all.
      const category = await fromStorageRowOrUndefined<BudgetCategory>(row);
      if (category?.name === CATEGORY_NAME) {
        legacyMatch = category.id;
        break;
      }
    }
    if (legacyMatch) {
      categoryId = legacyMatch;
    } else {
      const category: BudgetCategory = {
        id: AUTO_CATEGORY_ID,
        name: CATEGORY_NAME,
        createdAt: now,
        updatedAt: now,
      };
      const row = await toStorageRow(category, SENSITIVE_CATEGORY_FIELDS);
      try {
        await database.budgetCategories.add(row);
      } catch (err) {
        const stillMissing = await database.budgetCategories.get(AUTO_CATEGORY_ID);
        if (!stillMissing) throw err;
      }
      categoryId = AUTO_CATEGORY_ID;
    }
  }

  const subcategory: BudgetSubcategory = {
    id: AUTO_SUBCATEGORY_ID,
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
  const subcategoryRow = await toStorageRow(subcategory, SENSITIVE_SUBCATEGORY_FIELDS);
  try {
    await database.budgetSubcategories.add(subcategoryRow);
  } catch (err) {
    const stillMissing = await database.budgetSubcategories.get(AUTO_SUBCATEGORY_ID);
    if (!stillMissing) throw err;
  }
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
