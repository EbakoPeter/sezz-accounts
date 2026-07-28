import type { SezzAccountsDatabase } from "./schema";
import { db as defaultDb } from "./schema";
import { fromStorageRows } from "./encryptedRecord";
import type { BudgetCategory, BudgetSubcategory, Transaction, Engagement } from "@/types/models";
import { computeDebtBudgetAllocation } from "./debtBudgetLine";

export interface SubcategorySummary {
  subcategoryId: string;
  categoryId: string;
  name: string;
  monthlyAllocation: number;
  actual: number;
  /** Sum of this month's engagements still in "engaged" status — money
   * promised for a known future expense, not yet spent. Engagements
   * marked "realized" or "cancelled" don't count here: a realized one
   * should already show up in `actual` via its own transaction, and a
   * cancelled one was never really committed. */
  engaged: number;
  /** monthlyAllocation - actual - engaged: what's neither already spent
   * nor already promised — the honest answer to "how much can I still
   * commit or spend this month" for this line. */
  remaining: number;
  /** actual / monthlyAllocation — unchanged in meaning from before
   * engagements existed: genuine spending only, not promises. Kept this
   * way deliberately so existing consumers (recommendations.ts' overrun
   * warning) keep meaning exactly what they already meant. Null when
   * monthlyAllocation is 0 — "not provisioned", not "0% used". */
  percentUsed: number | null;
  /** True for the one, system-managed subcategory whose monthlyAllocation
   * above is always the live sum of unsettled debts' planned payments —
   * see debtBudgetLine.ts. The UI uses this to show that figure as
   * informational rather than as something to type a new value into. */
  autoAllocatedFromDebts: boolean;
}

export interface CategorySummary {
  categoryId: string;
  name: string;
  totalAllocation: number;
  totalActual: number;
  totalEngaged: number;
  totalRemaining: number;
  subcategories: SubcategorySummary[];
}

/** "YYYY-MM-01" through the actual last day of that month — ISO date
 * strings sort lexicographically the same as chronologically, so this
 * range works directly with Dexie's .between() on the `date` index. */
function monthDateRange(year: number, month: number): [string, string] {
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const end = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return [start, end];
}

/**
 * Computes, for a given calendar month, how much each budget subcategory
 * allowed vs. how much was actually spent vs. how much is currently
 * engaged (committed but not yet spent) — the "prévisionnel vs engagé vs
 * réel" view. Pure read: nothing here is stored, so it can never drift
 * from the underlying transactions and engagements.
 */
export async function getBudgetSummary(
  year: number,
  month: number,
  database: SezzAccountsDatabase = defaultDb,
): Promise<CategorySummary[]> {
  const [start, end] = monthDateRange(year, month);
  const [categoryRows, subcategoryRows, transactionRows, engagementRows] = await Promise.all([
    database.budgetCategories.toArray(),
    database.budgetSubcategories.toArray(),
    // Scoped to this month via the `date` index (schema v9) rather than
    // fetching every expense ever recorded and filtering by month in
    // memory afterward — the difference grows with how much history has
    // accumulated, not with how much is actually relevant to this call.
    // Still filters `kind === "expense"` in memory: there's no compound
    // [kind+date] index, but that filter now runs over one month's worth
    // of transactions instead of the entire table.
    database.transactions.where("date").between(start, end, true, true).toArray(),
    database.engagements.where("date").between(start, end, true, true).toArray(),
  ]);
  const [categoriesUnsorted, subcategories, transactionsInRange, engagementsInRange] =
    await Promise.all([
      fromStorageRows<BudgetCategory>(categoryRows),
      fromStorageRows<BudgetSubcategory>(subcategoryRows),
      fromStorageRows<Transaction>(transactionRows),
      fromStorageRows<Engagement>(engagementRows),
    ]);
  const transactions = transactionsInRange.filter((tx) => tx.kind === "expense");
  const engagements = engagementsInRange;
  // `name` is encrypted, so it can no longer be a Dexie index — sorted in
  // memory after decryption instead.
  const categories = categoriesUnsorted.sort((a, b) => a.name.localeCompare(b.name));

  const actualBySubcategory = new Map<string, number>();
  for (const tx of transactions) {
    if (!tx.subcategoryId) continue;
    actualBySubcategory.set(
      tx.subcategoryId,
      (actualBySubcategory.get(tx.subcategoryId) ?? 0) + tx.amount,
    );
  }

  const engagedBySubcategory = new Map<string, number>();
  for (const engagement of engagements) {
    if (engagement.status !== "engaged") continue;
    engagedBySubcategory.set(
      engagement.subcategoryId,
      (engagedBySubcategory.get(engagement.subcategoryId) ?? 0) + engagement.amount,
    );
  }

  const subcategoriesByCategory = new Map<string, typeof subcategories>();
  for (const sub of subcategories) {
    const bucket = subcategoriesByCategory.get(sub.categoryId);
    if (bucket) bucket.push(sub);
    else subcategoriesByCategory.set(sub.categoryId, [sub]);
  }

  // Computed once up front, not per-subcategory below: at most one
  // subcategory ever has autoAllocateFromDebts set (see
  // ensureDebtBudgetLine), so there's never a reason to recompute this
  // more than once per call regardless of how many categories exist.
  const debtAllocation = await computeDebtBudgetAllocation(database);

  return categories.map((category) => {
    const subs = (subcategoriesByCategory.get(category.id) ?? [])
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((sub): SubcategorySummary => {
        const actual = actualBySubcategory.get(sub.id) ?? 0;
        const engaged = engagedBySubcategory.get(sub.id) ?? 0;
        // The one subcategory ensureDebtBudgetLine creates never has its
        // own stored monthlyAllocation read at all — its effective
        // allocation is always this live figure instead, exactly like
        // every other value here that's computed rather than stored.
        const monthlyAllocation = sub.autoAllocateFromDebts
          ? debtAllocation
          : sub.monthlyAllocation;
        return {
          subcategoryId: sub.id,
          categoryId: sub.categoryId,
          name: sub.name,
          monthlyAllocation,
          actual,
          engaged,
          remaining: monthlyAllocation - actual - engaged,
          percentUsed: monthlyAllocation > 0 ? (actual / monthlyAllocation) * 100 : null,
          autoAllocatedFromDebts: sub.autoAllocateFromDebts === true,
        };
      });

    return {
      categoryId: category.id,
      name: category.name,
      totalAllocation: subs.reduce((sum, s) => sum + s.monthlyAllocation, 0),
      totalActual: subs.reduce((sum, s) => sum + s.actual, 0),
      totalEngaged: subs.reduce((sum, s) => sum + s.engaged, 0),
      totalRemaining: subs.reduce((sum, s) => sum + s.remaining, 0),
      subcategories: subs,
    };
  });
}
