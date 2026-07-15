import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/db/schema";
import { getAccountFlows, netOf } from "@/db/accountFlows";
import type { Account } from "@/types/models";

export interface AccountWithBalance extends Account {
  balance: number;
}

/**
 * Reads accounts plus everything that can affect a balance (transactions,
 * debts, debt payments) once per change, via the same `getAccountFlows`
 * function `AccountsRepository.getBalance` uses — one formula, one place,
 * not reimplemented here.
 */
export function useAccountsWithBalances(): AccountWithBalance[] | undefined {
  return useLiveQuery(async () => {
    const [accounts, flows] = await Promise.all([
      db.accounts.orderBy("name").toArray(),
      getAccountFlows(db),
    ]);
    return accounts.map((account) => ({
      ...account,
      balance: account.initialBalance + netOf(flows.get(account.id)),
    }));
  }, []);
}
