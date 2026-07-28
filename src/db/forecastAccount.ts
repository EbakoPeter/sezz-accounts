import type { SezzAccountsDatabase } from "./schema";
import { db as defaultDb } from "./schema";
import type { Account, Transaction } from "@/types/models";
import { toStorageRow, fromStorageRows } from "./encryptedRecord";
import { generateId } from "@/lib/id";
import { createTransactionsRepository } from "./transactionsRepository";

const SENSITIVE_ACCOUNT_FIELDS = ["name", "initialBalance"] as const;

export const FORECAST_ACCOUNT_NAME = "Compte Prévisionnel";

/**
 * Ensures the auto-managed "Compte Prévisionnel" account exists, creating
 * it (opening balance 0) the first time anything needs to credit it —
 * see creditForecastAccount below — rather than requiring a person to
 * think to set it up themselves first, the same "appears automatically
 * as soon as it's actually needed" approach ensureDebtBudgetLine already
 * takes for the "Dettes" budget line.
 *
 * Idempotent and safe to call repeatedly: reuses the existing account by
 * name rather than creating a duplicate on every subsequent credit.
 * Returns its id either way.
 */
export async function ensureForecastAccount(
  database: SezzAccountsDatabase = defaultDb,
): Promise<string> {
  const rows = await database.accounts.toArray();
  const accounts = await fromStorageRows<Account>(rows);
  const existing = accounts.find((a) => a.name === FORECAST_ACCOUNT_NAME);
  if (existing) return existing.id;

  const now = Date.now();
  const account: Account = {
    id: generateId(),
    name: FORECAST_ACCOUNT_NAME,
    initialBalance: 0,
    createdAt: now,
    updatedAt: now,
  };
  await database.accounts.add(await toStorageRow(account, SENSITIVE_ACCOUNT_FIELDS));
  return account.id;
}

export interface ForecastCreditInput {
  source: string;
  amount: number;
  date: string;
}

/**
 * "Crédit Prév (CP)" — the whole feature in one call: ensures the
 * forecast account exists, then records the entry as a regular income
 * transaction on it (`source` becomes the transaction's own label field;
 * this app has no separate concept of a transaction's "source" distinct
 * from what it's already using label for elsewhere). Reuses
 * transactionsRepository.create() for this rather than writing to the
 * table directly, so the same validation (a real date, a positive
 * amount, a non-empty label) applies here exactly as it does to any
 * other transaction — this is deliberately not a separate, looser path
 * into the same table.
 */
export async function creditForecastAccount(
  input: ForecastCreditInput,
  database: SezzAccountsDatabase = defaultDb,
): Promise<Transaction> {
  const accountId = await ensureForecastAccount(database);
  const transactions = createTransactionsRepository(database);
  return transactions.create({
    accountId,
    kind: "income",
    date: input.date,
    label: input.source,
    amount: input.amount,
  });
}
