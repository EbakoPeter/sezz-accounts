import type { SezzAccountsDatabase } from "./schema";
import type { Debt } from "@/types/models";

export type DebtStatus = "settled" | "overdue" | "ongoing";

export interface DebtSummary {
  debt: Debt;
  totalPaid: number;
  remaining: number;
  status: DebtStatus;
  /** Recommended monthly repayment, derived from amount ÷ months until the
   * due date — null when there is no due date to derive it from. Never
   * stored: always recomputed from the debt's own fields. */
  plannedMonthlyPayment: number | null;
}

/** Number of whole calendar months between two ISO dates, minimum 1 — used
 * so a due date in the same month as the debt still yields a sane (not
 * infinite/zero-division) monthly figure. */
export function monthsBetween(from: string, to: string): number {
  const [fromYear, fromMonth] = from.split("-").map(Number);
  const [toYear, toMonth] = to.split("-").map(Number);
  const months = (toYear! - fromYear!) * 12 + (toMonth! - fromMonth!);
  return Math.max(1, months);
}

function computeStatus(remaining: number, dueDate: string | undefined, today: string): DebtStatus {
  if (remaining <= 0) return "settled";
  if (dueDate && dueDate < today) return "overdue";
  return "ongoing";
}

export async function getDebtSummary(
  debtId: string,
  database: SezzAccountsDatabase,
  today: string = new Date().toISOString().slice(0, 10),
): Promise<DebtSummary | undefined> {
  const debt = await database.debts.get(debtId);
  if (!debt) return undefined;

  const payments = await database.debtPayments.where("debtId").equals(debtId).toArray();
  const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
  const remaining = debt.amount - totalPaid;

  return {
    debt,
    totalPaid,
    remaining,
    status: computeStatus(remaining, debt.dueDate, today),
    plannedMonthlyPayment: debt.dueDate
      ? Math.round(debt.amount / monthsBetween(debt.date, debt.dueDate))
      : null,
  };
}

export async function getAllDebtSummaries(
  database: SezzAccountsDatabase,
  today: string = new Date().toISOString().slice(0, 10),
): Promise<DebtSummary[]> {
  const [debts, payments] = await Promise.all([
    database.debts.toArray(),
    database.debtPayments.toArray(),
  ]);

  const paidByDebt = new Map<string, number>();
  for (const payment of payments) {
    paidByDebt.set(payment.debtId, (paidByDebt.get(payment.debtId) ?? 0) + payment.amount);
  }

  return debts
    .map((debt): DebtSummary => {
      const totalPaid = paidByDebt.get(debt.id) ?? 0;
      const remaining = debt.amount - totalPaid;
      return {
        debt,
        totalPaid,
        remaining,
        status: computeStatus(remaining, debt.dueDate, today),
        plannedMonthlyPayment: debt.dueDate
          ? Math.round(debt.amount / monthsBetween(debt.date, debt.dueDate))
          : null,
      };
    })
    .sort((a, b) => (a.debt.date < b.debt.date ? 1 : a.debt.date > b.debt.date ? -1 : 0));
}
