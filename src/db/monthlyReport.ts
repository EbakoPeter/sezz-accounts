import type { SezzAccountsDatabase } from "./schema";
import { fromStorageRows } from "./encryptedRecord";
import type { Transaction } from "@/types/models";

export interface MonthlyReportRow {
  year: number;
  /** 1-12 */
  month: number;
  income: number;
  expense: number;
  net: number;
  /** Running sum of `net` from January through this month, within the
   * same year. Resets at the start of each year — a cumulative figure
   * spanning years would conflate two different reporting periods. */
  cumulativeNet: number;
}

function yearMonthOf(isoDate: string): { year: number; month: number } {
  const [y, m] = isoDate.split("-").map(Number);
  return { year: y ?? 0, month: m ?? 0 };
}

/**
 * Twelve rows (January through December, always in that chronological
 * order), summing Transactions only — not Debts or DebtPayments.
 *
 * This is a deliberate accounting choice, not an oversight: borrowing money
 * is a balance-sheet event (it must be repaid), not income; repaying
 * principal is likewise not a regular expense the way groceries are. Mixing
 * them into "income" and "expense" here would inflate both figures and
 * make the monthly report misleading about actual earning/spending.
 * Account balances (accountFlows.ts) still include debts, correctly — this
 * report is a different, narrower view.
 */
export async function getMonthlyReport(
  year: number,
  database: SezzAccountsDatabase,
): Promise<MonthlyReportRow[]> {
  const transactionRows = await database.transactions.toArray();
  const transactions = await fromStorageRows<Transaction>(transactionRows);

  const incomeByMonth = new Map<number, number>();
  const expenseByMonth = new Map<number, number>();
  for (const tx of transactions) {
    const { year: txYear, month: txMonth } = yearMonthOf(tx.date);
    if (txYear !== year || txMonth < 1 || txMonth > 12) continue;
    const bucket = tx.kind === "income" ? incomeByMonth : expenseByMonth;
    bucket.set(txMonth, (bucket.get(txMonth) ?? 0) + tx.amount);
  }

  const rows: MonthlyReportRow[] = [];
  let cumulative = 0;
  for (let month = 1; month <= 12; month++) {
    const income = incomeByMonth.get(month) ?? 0;
    const expense = expenseByMonth.get(month) ?? 0;
    const net = income - expense;
    cumulative += net;
    rows.push({ year, month, income, expense, net, cumulativeNet: cumulative });
  }
  return rows;
}
