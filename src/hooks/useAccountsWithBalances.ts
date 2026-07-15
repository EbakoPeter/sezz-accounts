import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/db/schema";
import type { Account, Transaction } from "@/types/models";

export interface AccountWithBalance extends Account {
  balance: number;
}

function computeBalance(account: Account, transactions: Transaction[]): number {
  const net = transactions.reduce(
    (sum, tx) => sum + (tx.kind === "income" ? tx.amount : -tx.amount),
    0,
  );
  return account.initialBalance + net;
}

/**
 * Reads both tables once per change and derives balances in memory, rather
 * than issuing one query per account — cheap for a personal dataset and
 * keeps this the single place that knows how a balance is computed on the
 * read side (mirrors AccountsRepository.getBalance's formula exactly; see
 * that function's tests for the authoritative behaviour).
 */
export function useAccountsWithBalances(): AccountWithBalance[] | undefined {
  return useLiveQuery(async () => {
    const [accounts, transactions] = await Promise.all([
      db.accounts.orderBy("name").toArray(),
      db.transactions.toArray(),
    ]);
    const byAccount = new Map<string, Transaction[]>();
    for (const tx of transactions) {
      const bucket = byAccount.get(tx.accountId);
      if (bucket) bucket.push(tx);
      else byAccount.set(tx.accountId, [tx]);
    }
    return accounts.map((account) => ({
      ...account,
      balance: computeBalance(account, byAccount.get(account.id) ?? []),
    }));
  }, []);
}
