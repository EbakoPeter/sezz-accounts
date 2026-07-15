import Dexie, { type EntityTable } from "dexie";
import type { Account, Transaction } from "@/types/models";

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

  constructor(name = "SezzAccountsDB") {
    super(name);
    this.version(1).stores({
      accounts: "id, name",
      transactions: "id, accountId, kind, date, categoryId, [accountId+date]",
    });
  }
}

export const db = new SezzAccountsDatabase();
