import type { SezzAccountsDatabase } from "@/db/schema";
import { fromStorageRows } from "@/db/encryptedRecord";
import type { Account, Transaction, Transfer, Debt, DebtPayment } from "@/types/models";

export interface CashFlowPoint {
  /** Last day of the month this point represents, "YYYY-MM-DD". */
  date: string;
  /** Per-account balance as of this date, keyed by account id. */
  byAccount: Map<string, number>;
  /** Sum of every account's balance as of this date — the single figure
   * most people actually want from a treasury report ("how much did we
   * have, overall, at the end of each month"). */
  total: number;
}

function lastDayOfMonth(year: number, month: number): string {
  // day 0 of the *next* month is the last day of *this* one
  const d = new Date(year, month, 0);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** True once `timestampMs` falls on or after the day *after* `isoDate` —
 * i.e. "this timestamp is strictly later than the last millisecond of
 * isoDate's day". Named so the +1-day arithmetic behind it is explained
 * once rather than re-derived at each call site. */
function isAfterEndOfDay(timestampMs: number, isoDate: string): boolean {
  const startOfNextDayMs = new Date(isoDate).getTime() + 24 * 60 * 60 * 1000;
  return timestampMs >= startOfNextDayMs;
}

function monthsBetween(
  fromYear: number,
  fromMonth: number,
  toYear: number,
  toMonth: number,
): Array<{ year: number; month: number }> {
  const months: Array<{ year: number; month: number }> = [];
  let y = fromYear;
  let m = fromMonth;
  while (y < toYear || (y === toYear && m <= toMonth)) {
    months.push({ year: y, month: m });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return months;
}

interface FlowEvent {
  date: string;
  accountId: string;
  delta: number;
}

/** Flattens transactions, transfers (two legs each), debts, and debt
 * payments into a single list of dated balance changes, sorted
 * chronologically — the same "what moves a balance" rules as
 * accountFlows.ts (see its own comment for the reasoning behind each
 * one), just as a timeline instead of an unconditional total. */
function buildFlowEvents(
  transactions: Transaction[],
  transfers: Transfer[],
  debts: Debt[],
  payments: DebtPayment[],
): FlowEvent[] {
  const debtKindById = new Map(debts.map((d) => [d.id, d.kind]));
  const events: FlowEvent[] = [];

  for (const tx of transactions) {
    events.push({
      date: tx.date,
      accountId: tx.accountId,
      delta: tx.kind === "income" ? tx.amount : -tx.amount,
    });
  }
  for (const transfer of transfers) {
    events.push({
      date: transfer.date,
      accountId: transfer.fromAccountId,
      delta: -transfer.amount,
    });
    events.push({ date: transfer.date, accountId: transfer.toAccountId, delta: transfer.amount });
  }
  for (const debt of debts) {
    events.push({
      date: debt.date,
      accountId: debt.accountId,
      delta: debt.kind === "debt" ? debt.amount : -debt.amount,
    });
  }
  for (const payment of payments) {
    const kind = debtKindById.get(payment.debtId);
    if (kind === "debt")
      events.push({ date: payment.date, accountId: payment.accountId, delta: -payment.amount });
    else if (kind === "receivable")
      events.push({ date: payment.date, accountId: payment.accountId, delta: payment.amount });
  }

  events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return events;
}

/**
 * Computes each account's balance as of the end of every month in
 * [from, to] — the evolution a treasury report needs, not just the current
 * totals accountFlows.ts already provides.
 *
 * Incremental by construction: every flow event is applied to a running
 * balance exactly once, in chronological order, and each month's point is
 * a snapshot of that running balance at its cutoff — not a fresh re-scan
 * of the full history per month. With M months requested and N events,
 * this is O(N log N) once (the sort) plus O(N + M) to walk through them,
 * instead of the O(N × M) an independent per-month scan would cost.
 *
 * `from`/`to` are "YYYY-MM" (a month, not a specific day) — a treasury
 * report is inherently about month-end snapshots, so there's no meaningful
 * "day" to ask for within a month.
 */
export async function getCashFlowOverTime(
  database: SezzAccountsDatabase,
  from: string,
  to: string,
): Promise<CashFlowPoint[]> {
  const [fromYear, fromMonth] = from.split("-").map(Number);
  const [toYear, toMonth] = to.split("-").map(Number);
  if (!fromYear || !fromMonth || !toYear || !toMonth) {
    throw new Error("from/to must be in YYYY-MM format.");
  }

  const [accountRows, transactionRows, transferRows, debtRows, paymentRows] = await Promise.all([
    database.accounts.toArray(),
    database.transactions.toArray(),
    database.transfers.toArray(),
    database.debts.toArray(),
    database.debtPayments.toArray(),
  ]);
  const [accounts, transactions, transfers, debts, payments] = await Promise.all([
    fromStorageRows<Account>(accountRows),
    fromStorageRows<Transaction>(transactionRows),
    fromStorageRows<Transfer>(transferRows),
    fromStorageRows<Debt>(debtRows),
    fromStorageRows<DebtPayment>(paymentRows),
  ]);

  const events = buildFlowEvents(transactions, transfers, debts, payments);
  const months = monthsBetween(fromYear, fromMonth, toYear, toMonth);

  // Every account's running balance starts at its initial balance,
  // regardless of when it was created — "did this account exist yet" is
  // checked only when snapshotting a point below, not here. An event
  // referencing an unknown account id (should not normally happen) simply
  // accumulates into a map entry that's never read back, since only known
  // accounts are ever iterated when building a point's output.
  const runningBalance = new Map<string, number>();
  for (const account of accounts) {
    runningBalance.set(account.id, account.initialBalance);
  }

  let eventIndex = 0;
  const points: CashFlowPoint[] = [];
  for (const { year, month } of months) {
    const cutoff = lastDayOfMonth(year, month);

    // Advance monotonically — months are processed in chronological
    // order, so an event applied for an earlier month's cutoff is never
    // revisited for a later one.
    while (eventIndex < events.length && events[eventIndex]!.date <= cutoff) {
      const event = events[eventIndex]!;
      runningBalance.set(event.accountId, (runningBalance.get(event.accountId) ?? 0) + event.delta);
      eventIndex++;
    }

    const byAccount = new Map<string, number>();
    for (const account of accounts) {
      // an account created after this cutoff didn't exist yet — its
      // "balance" at this point in the past is meaningless, not zero
      if (isAfterEndOfDay(account.createdAt, cutoff)) continue;
      byAccount.set(account.id, runningBalance.get(account.id) ?? 0);
    }

    const total = Array.from(byAccount.values()).reduce((sum, balance) => sum + balance, 0);
    points.push({ date: cutoff, byAccount, total });
  }

  return points;
}
