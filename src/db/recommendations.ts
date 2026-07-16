import type { SezzAccountsDatabase } from "./schema";
import { getMonthlyReport } from "./monthlyReport";
import { getBudgetSummary } from "./budgetSummary";
import { getAllDebtSummaries } from "./debtSummary";
import { getAccountFlows, netOf } from "./accountFlows";
import { formatFcfa } from "@/lib/money";

export type InsightSeverity = "success" | "info" | "warning";

export interface Insight {
  /** Stable across re-renders for the given month/state — used as a React
   * list key, never persisted. */
  id: string;
  severity: InsightSeverity;
  title: string;
  message: string;
}

const SAVINGS_RATE_GOOD = 20; // percent
const SPENDING_INCREASE_ALERT = 15; // percent
const BUDGET_OVERRUN_THRESHOLD = 100; // percent of allocation

/**
 * Every rule here reads data that already exists elsewhere (Transactions,
 * Debts, budget allocations) and nothing is computed that couldn't be
 * recomputed identically tomorrow from the same underlying records — no
 * new storage, no new entity, purely a lens on what's already there.
 */
export async function getRecommendations(
  year: number,
  month: number,
  database: SezzAccountsDatabase,
): Promise<Insight[]> {
  const insights: Insight[] = [];

  const monthlyReport = await getMonthlyReport(year, database);
  const currentRow = monthlyReport.find((r) => r.month === month);
  const previousMonth = month === 1 ? 12 : month - 1;
  const previousYear = month === 1 ? year - 1 : year;
  const previousReport =
    previousYear === year
      ? monthlyReport.find((r) => r.month === previousMonth)
      : (await getMonthlyReport(previousYear, database)).find((r) => r.month === previousMonth);

  if (currentRow) {
    if (currentRow.income > 0) {
      const savingsRate = (currentRow.net / currentRow.income) * 100;
      if (savingsRate < 0) {
        insights.push({
          id: "savings-rate",
          severity: "warning",
          title: "Dépenses supérieures aux revenus",
          message: `Ce mois-ci, les dépenses dépassent les revenus de ${Math.abs(Math.round(savingsRate))}% des revenus.`,
        });
      } else if (savingsRate < SAVINGS_RATE_GOOD) {
        insights.push({
          id: "savings-rate",
          severity: "info",
          title: "Taux d'épargne du mois",
          message: `Taux d'épargne actuel : ${Math.round(savingsRate)}%. Un objectif courant est de viser au moins ${SAVINGS_RATE_GOOD}%.`,
        });
      } else {
        insights.push({
          id: "savings-rate",
          severity: "success",
          title: "Bon taux d'épargne",
          message: `Taux d'épargne de ${Math.round(savingsRate)}% ce mois-ci — au-dessus du repère habituel de ${SAVINGS_RATE_GOOD}%.`,
        });
      }
    }

    if (previousReport && previousReport.expense > 0) {
      const change = ((currentRow.expense - previousReport.expense) / previousReport.expense) * 100;
      if (change > SPENDING_INCREASE_ALERT) {
        insights.push({
          id: "spending-trend",
          severity: "warning",
          title: "Hausse des dépenses",
          message: `Les dépenses ont augmenté de ${Math.round(change)}% par rapport au mois précédent.`,
        });
      }
    }
  }

  const budgetSummary = await getBudgetSummary(year, month, database);
  for (const category of budgetSummary) {
    for (const sub of category.subcategories) {
      if (sub.percentUsed !== null && sub.percentUsed > BUDGET_OVERRUN_THRESHOLD) {
        insights.push({
          id: `budget-overrun-${sub.subcategoryId}`,
          severity: "warning",
          title: `Dépassement de budget : ${sub.name}`,
          message: `${Math.round(sub.percentUsed)}% du budget alloué à « ${sub.name} » a été consommé ce mois-ci.`,
        });
      }
    }
  }

  const accounts = await database.accounts.toArray();
  const flows = await getAccountFlows(database);
  for (const account of accounts) {
    const balance = account.initialBalance + netOf(flows.get(account.id));
    if (balance < 0) {
      insights.push({
        id: `negative-balance-${account.id}`,
        severity: "warning",
        title: `Solde négatif : ${account.name}`,
        message: `Le compte « ${account.name} » affiche un solde négatif.`,
      });
    }
  }

  const debtSummaries = await getAllDebtSummaries(database);
  for (const { debt, status, remaining } of debtSummaries) {
    if (status === "overdue") {
      insights.push({
        id: `overdue-debt-${debt.id}`,
        severity: "warning",
        title: `Échéance dépassée : ${debt.reference}`,
        message: `La dette ${debt.reference} (${debt.counterparty}) est en retard, solde restant ${formatFcfa(remaining)}.`,
      });
    }
  }

  if (insights.length === 0) {
    insights.push({
      id: "all-clear",
      severity: "success",
      title: "Aucune alerte",
      message: "Aucun point d'attention détecté pour ce mois-ci.",
    });
  }

  return insights;
}
