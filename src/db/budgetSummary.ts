import type { SezzAccountsDatabase } from "./schema";
import { db as defaultDb } from "./schema";
import { fromStorageRows } from "./encryptedRecord";
import type { BudgetCategory, BudgetSubcategory, Transaction } from "@/types/models";

export interface SubcategorySummary {
  subcategoryId: string;
  categoryId: string;
  name: string;
  monthlyAllocation: number;
  actual: number;
  remaining: number;
  /** null when monthlyAllocation is 0 — "not provisioned", not "0% used". */
  percentUsed: number | null;
}

export interface CategorySummary {
  categoryId: string;
  name: string;
  totalAllocation: number;
  totalActual: number;
  totalRemaining: number;
  subcategories: SubcategorySummary[];
}

function monthMatches(isoDate: string, year: number, month: number): boolean {
  const [y, m] = isoDate.split("-");
  return Number(y) === year && Number(m) === month;
}

/**
 * Computes, for a given calendar month, how much each budget subcategory
 * allowed vs. how much was actually spent — the core "prévisionnel vs réel"
 * view. Pure read: nothing here is stored, so it can never drift from the
 * underlying transactions.
 */
export async function getBudgetSummary(
  year: number,
  month: number,
  database: SezzAccountsDatabase = defaultDb,
): Promise<CategorySummary[]> {
  const [categoryRows, subcategoryRows, transactionRows] = await Promise.all([
    database.budgetCategories.toArray(),
    database.budgetSubcategories.toArray(),
    database.transactions.where("kind").equals("expense").toArray(),
  ]);
  const [categoriesUnsorted, subcategories, transactions] = await Promise.all([
    fromStorageRows<BudgetCategory>(categoryRows),
    fromStorageRows<BudgetSubcategory>(subcategoryRows),
    fromStorageRows<Transaction>(transactionRows),
  ]);
  // `name` is encrypted, so it can no longer be a Dexie index — sorted in
  // memory after decryption instead.
  const categories = categoriesUnsorted.sort((a, b) => a.name.localeCompare(b.name));

  const actualBySubcategory = new Map<string, number>();
  for (const tx of transactions) {
    if (!tx.subcategoryId) continue;
    if (!monthMatches(tx.date, year, month)) continue;
    actualBySubcategory.set(
      tx.subcategoryId,
      (actualBySubcategory.get(tx.subcategoryId) ?? 0) + tx.amount,
    );
  }

  const subcategoriesByCategory = new Map<string, typeof subcategories>();
  for (const sub of subcategories) {
    const bucket = subcategoriesByCategory.get(sub.categoryId);
    if (bucket) bucket.push(sub);
    else subcategoriesByCategory.set(sub.categoryId, [sub]);
  }

  return categories.map((category) => {
    const subs = (subcategoriesByCategory.get(category.id) ?? [])
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((sub): SubcategorySummary => {
        const actual = actualBySubcategory.get(sub.id) ?? 0;
        return {
          subcategoryId: sub.id,
          categoryId: sub.categoryId,
          name: sub.name,
          monthlyAllocation: sub.monthlyAllocation,
          actual,
          remaining: sub.monthlyAllocation - actual,
          percentUsed: sub.monthlyAllocation > 0 ? (actual / sub.monthlyAllocation) * 100 : null,
        };
      });

    return {
      categoryId: category.id,
      name: category.name,
      totalAllocation: subs.reduce((sum, s) => sum + s.monthlyAllocation, 0),
      totalActual: subs.reduce((sum, s) => sum + s.actual, 0),
      totalRemaining: subs.reduce((sum, s) => sum + s.remaining, 0),
      subcategories: subs,
    };
  });
}
