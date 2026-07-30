import type { SezzAccountsDatabase } from "./schema";
import { fromStorageRows, fromStorageRowOrUndefined } from "./encryptedRecord";
import { dedupeInFlight } from "@/lib/inFlightCache";
import type { Debt, DebtPayment } from "@/types/models";

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
  const row = await database.debts.get(debtId);
  if (!row) return undefined;
  const debt = await fromStorageRowOrUndefined<Debt>(row);
  if (!debt) return undefined;

  const paymentRows = await database.debtPayments.where("debtId").equals(debtId).toArray();
  const payments = await fromStorageRows<DebtPayment>(paymentRows);
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

/** Called identically from DebtsPanel (via useDebtSummaries) and
 * RecommendationsPanel — genuinely concurrent calls within the same tick
 * share one computation via dedupeInFlight rather than each independently
 * re-fetching and re-decrypting the same two tables. `today` is part of
 * the key, not just the database: it defaults to the real current date,
 * which does change (if rarely, mid-session), and two calls that could
 * legitimately disagree must never share a result. See inFlightCache.ts
 * for why this never risks a stale result otherwise. */
export async function getAllDebtSummaries(
  database: SezzAccountsDatabase,
  today: string = new Date().toISOString().slice(0, 10),
): Promise<DebtSummary[]> {
  return dedupeInFlight(`debtSummaries:${database.name}:${today}`, () =>
    computeAllDebtSummaries(database, today),
  );
}

async function computeAllDebtSummaries(
  database: SezzAccountsDatabase,
  today: string,
): Promise<DebtSummary[]> {
  const [debtRows, paymentRows] = await Promise.all([
    database.debts.toArray(),
    database.debtPayments.toArray(),
  ]);
  const [debts, payments] = await Promise.all([
    fromStorageRows<Debt>(debtRows),
    fromStorageRows<DebtPayment>(paymentRows),
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
