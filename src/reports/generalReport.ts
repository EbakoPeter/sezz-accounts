import type { jsPDF } from "jspdf";
import type { SezzAccountsDatabase } from "@/db/schema";
import { createAccountsRepository } from "@/db/accountsRepository";
import { getAccountFlows, netOf } from "@/db/accountFlows";
import { getMonthlyReport } from "@/db/monthlyReport";
import { getBudgetSummary } from "@/db/budgetSummary";
import { formatFcfa } from "@/lib/money";
import {
  createReportDocument,
  addReportTable,
  addSectionHeading,
  downloadReport,
} from "./pdfDocument";

/**
 * The overview report: account balances, this month's income/expense, and
 * the budget summary for the same month — the same three things
 * AccountsPanel, MonthlyReportPanel, and BudgetPanel each show on their
 * own screen, brought into a single downloadable document rather than
 * three separate exports someone would have to assemble by hand.
 */
export async function generateGeneralReportPdf(
  database: SezzAccountsDatabase,
  year: number,
  month: number,
): Promise<jsPDF> {
  const accountsRepo = createAccountsRepository(database);
  const [accounts, flows, monthlyRows, budgetCategories] = await Promise.all([
    accountsRepo.list(),
    getAccountFlows(database),
    getMonthlyReport(year, database),
    getBudgetSummary(year, month, database),
  ]);
  const monthRow = monthlyRows.find((r) => r.month === month);

  const monthLabel = new Date(year, month - 1, 1).toLocaleDateString("fr-FR", {
    month: "long",
    year: "numeric",
  });
  const doc = createReportDocument("Rapport général", monthLabel);

  let y = 48;
  y = addSectionHeading(doc, "Comptes", y);
  const accountRows = accounts.map((a) => {
    const balance = a.initialBalance + netOf(flows.get(a.id));
    return [a.name, formatFcfa(a.initialBalance), formatFcfa(balance)];
  });
  const totalBalance = accounts.reduce(
    (sum, a) => sum + a.initialBalance + netOf(flows.get(a.id)),
    0,
  );
  accountRows.push(["Total", "", formatFcfa(totalBalance)]);
  y = addReportTable(doc, y, [["Compte", "Solde initial", "Solde actuel"]], accountRows) + 12;

  y = addSectionHeading(doc, `Revenus et dépenses — ${monthLabel}`, y);
  y =
    addReportTable(
      doc,
      y,
      [["Revenus", "Dépenses", "Solde net"]],
      [
        [
          formatFcfa(monthRow?.income ?? 0),
          formatFcfa(monthRow?.expense ?? 0),
          formatFcfa(monthRow?.net ?? 0),
        ],
      ],
    ) + 12;

  y = addSectionHeading(doc, `Budget prévisionnel — ${monthLabel}`, y);
  const budgetRows = budgetCategories.flatMap((category) =>
    category.subcategories.map((sub) => [
      `${category.name} — ${sub.name}`,
      formatFcfa(sub.monthlyAllocation),
      formatFcfa(sub.actual),
      formatFcfa(sub.engaged),
      formatFcfa(sub.remaining),
    ]),
  );
  if (budgetRows.length > 0) {
    addReportTable(
      doc,
      y,
      [["Ligne budgétaire", "Alloué", "Réel", "Engagé", "Restant"]],
      budgetRows,
    );
  }

  return doc;
}

export async function downloadGeneralReport(
  database: SezzAccountsDatabase,
  year: number,
  month: number,
): Promise<void> {
  const doc = await generateGeneralReportPdf(database, year, month);
  downloadReport(doc, `sezz-rapport-general-${year}-${String(month).padStart(2, "0")}.pdf`);
}
