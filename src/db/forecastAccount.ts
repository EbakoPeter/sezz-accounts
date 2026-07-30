import type { SezzAccountsDatabase } from "./schema";
import { db as defaultDb } from "./schema";
import type { Account, Transaction } from "@/types/models";
import { toStorageRow, fromStorageRows } from "./encryptedRecord";
import { createTransactionsRepository } from "./transactionsRepository";

const SENSITIVE_ACCOUNT_FIELDS = ["name", "initialBalance"] as const;

export const FORECAST_ACCOUNT_NAME = "Compte Prévisionnel";

/** A fixed, well-known id rather than a freshly generated one — see
 * ensureForecastAccount's own comment for why this matters. */
const FORECAST_ACCOUNT_ID = "forecast-account-singleton";

/**
 * Ensures the auto-managed "Compte Prévisionnel" account exists, creating
 * it (opening balance 0) the first time anything needs to credit it —
 * see creditForecastAccount below — rather than requiring a person to
 * think to set it up themselves first, the same "appears automatically
 * as soon as it's actually needed" approach ensureDebtBudgetLine takes
 * for the "Dettes" budget line.
 *
 * Uses a fixed id (FORECAST_ACCOUNT_ID) rather than name-based lookup as
 * the primary check specifically so two overlapping calls can't both
 * decide "doesn't exist yet" and both create one — the exact race
 * roleTemplatesRepository.ts was found to have (see its own detailed
 * comment: reproduced reliably on a real phone, rarely on a fast
 * desktop). That fix used a transaction, since role templates are
 * looked up by a plain, unencrypted primary key (the role id itself);
 * this account is normally identified by its own *name*, which is an
 * encrypted field — determining "does an account with this name exist"
 * requires decrypting every account first, and a Dexie transaction
 * can't await the Web Crypto calls that requires without committing
 * early. A fixed id sidesteps the problem entirely: existence becomes a
 * plain, unencrypted primary-key check, and Dexie's own uniqueness
 * constraint on that key means at most one of two concurrent add() calls
 * can ever succeed — the loser's own add() throws, is caught below, and
 * simply reuses what the winner just created.
 *
 * Falls back to a one-time, name-based scan for an account created by
 * an earlier version of this function (before it used a fixed id) —
 * safe to decrypt-and-scan here since this fallback path is a read, not
 * itself the create-or-not decision the fixed-id check above already
 * makes race-free.
 */
export async function ensureForecastAccount(
  database: SezzAccountsDatabase = defaultDb,
): Promise<string> {
  const existingRow = await database.accounts.get(FORECAST_ACCOUNT_ID);
  if (existingRow) return FORECAST_ACCOUNT_ID;

  const rows = await database.accounts.toArray();
  const accounts = await fromStorageRows<Account>(rows);
  const legacyMatch = accounts.find((a) => a.name === FORECAST_ACCOUNT_NAME);
  if (legacyMatch) return legacyMatch.id;

  const now = Date.now();
  const account: Account = {
    id: FORECAST_ACCOUNT_ID,
    name: FORECAST_ACCOUNT_NAME,
    initialBalance: 0,
    createdAt: now,
    updatedAt: now,
  };
  const row = await toStorageRow(account, SENSITIVE_ACCOUNT_FIELDS);
  try {
    await database.accounts.add(row);
  } catch (err) {
    const stillMissing = await database.accounts.get(FORECAST_ACCOUNT_ID);
    if (!stillMissing) throw err;
  }
  return FORECAST_ACCOUNT_ID;
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
