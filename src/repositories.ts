import { createAccountsRepository } from "@/db/accountsRepository";
import { createTransactionsRepository } from "@/db/transactionsRepository";

/** The app's single set of repositories, bound to the real IndexedDB-backed
 * database. Tests never import this file — they build their own repository
 * instances over an isolated test database instead (see src/test/testDatabase.ts). */
export const accountsRepository = createAccountsRepository();
export const transactionsRepository = createTransactionsRepository();
