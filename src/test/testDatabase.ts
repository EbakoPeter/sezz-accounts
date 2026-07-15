import { SezzAccountsDatabase } from "@/db/schema";

let counter = 0;

/** A fresh, isolated database per call — tests never share state, and never
 * touch the real "SezzAccountsDB" name. */
export function createTestDatabase(): SezzAccountsDatabase {
  counter += 1;
  return new SezzAccountsDatabase(`test-db-${counter}-${Date.now()}`);
}
