import type { SezzAccountsDatabase } from "./schema";

export interface AccountFlow {
  inflow: number;
  outflow: number;
}

/**
 * Computes, for every account, the total inflow/outflow contributed by
 * Transactions and by Debts/DebtPayments. This is the one place that knows
 * "what moves an account's balance" — both `AccountsRepository.getBalance`
 * and `useAccountsWithBalances` call into this rather than each keeping
 * their own copy of the formula, which is exactly the kind of duplication
 * that causes a fix to be applied in one place and forgotten in the other.
 *
 * Rules:
 *  - a Transaction of kind "income" is an inflow, "expense" an outflow;
 *  - incurring a Debt of kind "debt" (you borrowed money) is an inflow —
 *    the money actually arrived in the account;
 *  - incurring a Debt of kind "receivable" (you lent money out) is an
 *    outflow — the money actually left the account;
 *  - a DebtPayment mirrors the opposite direction of its Debt's kind:
 *    paying back a "debt" is an outflow, receiving payment on a
 *    "receivable" is an inflow.
 */
export async function getAccountFlows(
  database: SezzAccountsDatabase,
): Promise<Map<string, AccountFlow>> {
  const [transactions, debts, payments] = await Promise.all([
    database.transactions.toArray(),
    database.debts.toArray(),
    database.debtPayments.toArray(),
  ]);

  const flows = new Map<string, AccountFlow>();
  function add(accountId: string, inflow: number, outflow: number): void {
    const existing = flows.get(accountId) ?? { inflow: 0, outflow: 0 };
    flows.set(accountId, { inflow: existing.inflow + inflow, outflow: existing.outflow + outflow });
  }

  for (const tx of transactions) {
    if (tx.kind === "income") add(tx.accountId, tx.amount, 0);
    else add(tx.accountId, 0, tx.amount);
  }

  const debtKindById = new Map(debts.map((d) => [d.id, d.kind]));
  for (const debt of debts) {
    if (debt.kind === "debt") add(debt.accountId, debt.amount, 0);
    else add(debt.accountId, 0, debt.amount);
  }
  for (const payment of payments) {
    const kind = debtKindById.get(payment.debtId);
    if (kind === "debt") add(payment.accountId, 0, payment.amount);
    else if (kind === "receivable") add(payment.accountId, payment.amount, 0);
    // a payment whose debt no longer exists (should not normally happen —
    // deleting a debt cascades to its payments, see DebtsRepository.remove)
    // is silently excluded rather than thrown, since balance computation
    // must never fail to render the rest of the app over one bad row.
  }

  return flows;
}

export function netOf(flow: AccountFlow | undefined): number {
  if (!flow) return 0;
  return flow.inflow - flow.outflow;
}
