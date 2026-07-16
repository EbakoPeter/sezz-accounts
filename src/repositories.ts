import { createAccountsRepository } from "@/db/accountsRepository";
import { createTransactionsRepository } from "@/db/transactionsRepository";
import { createBudgetCategoriesRepository } from "@/db/budgetCategoriesRepository";
import { createBudgetSubcategoriesRepository } from "@/db/budgetSubcategoriesRepository";
import { createDebtsRepository } from "@/db/debtsRepository";
import { createDebtPaymentsRepository } from "@/db/debtPaymentsRepository";
import { createUsersRepository } from "@/db/usersRepository";

/** The app's single set of repositories, bound to the real IndexedDB-backed
 * database. Tests never import this file — they build their own repository
 * instances over an isolated test database instead (see src/test/testDatabase.ts). */
export const accountsRepository = createAccountsRepository();
export const transactionsRepository = createTransactionsRepository();
export const budgetCategoriesRepository = createBudgetCategoriesRepository();
export const budgetSubcategoriesRepository = createBudgetSubcategoriesRepository();
export const debtsRepository = createDebtsRepository();
export const debtPaymentsRepository = createDebtPaymentsRepository();
export const usersRepository = createUsersRepository();
