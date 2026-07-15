import Dexie, { type EntityTable } from "dexie";
import type { Account, Transaction, BudgetCategory, BudgetSubcategory } from "@/types/models";

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
  accounts!: EntityTable<Account, "id">;
  transactions!: EntityTable<Transaction, "id">;
  budgetCategories!: EntityTable<BudgetCategory, "id">;
  budgetSubcategories!: EntityTable<BudgetSubcategory, "id">;

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
  }
}

export const db = new SezzAccountsDatabase();
