import type { SezzAccountsDatabase } from "./schema";
import { getMonthlyReport } from "./monthlyReport";
import { getBudgetSummary } from "./budgetSummary";
import { getAllDebtSummaries } from "./debtSummary";
import { getAccountFlows, netOf } from "./accountFlows";
import { fromStorageRows } from "./encryptedRecord";
import { formatFcfa } from "@/lib/money";
import type { Account } from "@/types/models";

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
// A classic personal-finance guideline (not a rigid rule): total debt
// service above this share of income is when a household's own margin
// for absorbing a bad month starts getting genuinely tight.
const DEBT_TO_INCOME_WARNING = 35; // percent
// Common financial-planning guidance is 3 to 6 months of expenses set
// aside; 3 is used here as the lower bound worth flagging below.
const EMERGENCY_FUND_TARGET_MONTHS = 3;

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
  today: Date = new Date(),
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

  // Projection de fin de mois — un modèle prédictif simple (rythme
  // quotidien moyen extrapolé sur les jours restants), pas juste un
  // constat rétrospectif : prévient un dépassement avant qu'il ne se
  // produise plutôt que de le signaler après coup. Volontairement
  // silencieux les tout premiers jours du mois (une moyenne sur 1 ou 2
  // jours n'a aucune valeur prédictive) et une fois le mois quasiment
  // terminé (la projection et le réel se confondent alors).
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() + 1 === month;
  if (isCurrentMonth) {
    const dayOfMonth = today.getDate();
    const daysInMonth = new Date(year, month, 0).getDate();
    const totalAllocated = budgetSummary.reduce((sum, cat) => sum + cat.totalAllocation, 0);
    const totalSpentSoFar = budgetSummary.reduce((sum, cat) => sum + cat.totalActual, 0);
    if (
      dayOfMonth >= 3 &&
      dayOfMonth <= daysInMonth - 2 &&
      totalAllocated > 0 &&
      totalSpentSoFar > 0
    ) {
      const dailyAverage = totalSpentSoFar / dayOfMonth;
      const projectedTotal = dailyAverage * daysInMonth;
      if (projectedTotal > totalAllocated) {
        insights.push({
          id: "month-end-projection",
          severity: "warning",
          title: "Projection de fin de mois",
          message: `Au rythme actuel (${formatFcfa(Math.round(dailyAverage))}/jour), les dépenses atteindraient environ ${formatFcfa(Math.round(projectedTotal))} d'ici la fin du mois — au-dessus du budget alloué de ${formatFcfa(totalAllocated)}.`,
        });
      } else {
        insights.push({
          id: "month-end-projection",
          severity: "success",
          title: "Projection de fin de mois",
          message: `Au rythme actuel, les dépenses resteraient autour de ${formatFcfa(Math.round(projectedTotal))} d'ici la fin du mois, dans la limite du budget alloué (${formatFcfa(totalAllocated)}).`,
        });
      }
    }
  }

  const accountRows = await database.accounts.toArray();
  const accounts = await fromStorageRows<Account>(accountRows);
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

  // Fonds d'urgence / autonomie financière — un repère classique de
  // conseil financier (généralement 3 à 6 mois de dépenses courantes de
  // côté), calculé ici à partir du solde total réel et du rythme de
  // dépenses de ce mois-ci plutôt que d'une moyenne théorique.
  if (currentRow && currentRow.expense > 0) {
    const totalBalance = accounts.reduce(
      (sum, acc) => sum + acc.initialBalance + netOf(flows.get(acc.id)),
      0,
    );
    if (totalBalance > 0) {
      const runwayMonths = totalBalance / currentRow.expense;
      insights.push({
        id: "emergency-fund",
        severity: runwayMonths < EMERGENCY_FUND_TARGET_MONTHS ? "info" : "success",
        title: "Fonds d'urgence",
        message: `Le solde total actuel couvrirait environ ${runwayMonths.toFixed(1)} mois de dépenses au rythme de ce mois-ci — un repère courant est de viser ${EMERGENCY_FUND_TARGET_MONTHS} à 6 mois.`,
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

  // Ratio d'endettement (mensualités de dettes ÷ revenus du mois) — un
  // repère classique de conseil financier : au-delà d'un certain seuil,
  // la marge pour absorber un imprévu (perte de revenu, dépense urgente)
  // devient structurellement plus étroite, indépendamment du fait que
  // chaque dette prise isolément soit à jour ou non.
  if (currentRow && currentRow.income > 0) {
    const totalMonthlyDebtService = debtSummaries.reduce(
      (sum, d) => sum + (d.plannedMonthlyPayment ?? 0),
      0,
    );
    if (totalMonthlyDebtService > 0) {
      const debtToIncomeRatio = (totalMonthlyDebtService / currentRow.income) * 100;
      insights.push({
        id: "debt-to-income",
        severity: debtToIncomeRatio > DEBT_TO_INCOME_WARNING ? "warning" : "info",
        title:
          debtToIncomeRatio > DEBT_TO_INCOME_WARNING
            ? "Ratio d'endettement élevé"
            : "Ratio d'endettement",
        message: `Les mensualités de dettes représentent environ ${Math.round(debtToIncomeRatio)}% des revenus du mois${debtToIncomeRatio > DEBT_TO_INCOME_WARNING ? ` — au-dessus du repère courant de ${DEBT_TO_INCOME_WARNING}%, qui laisse peu de marge en cas d'imprévu` : ""}.`,
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
