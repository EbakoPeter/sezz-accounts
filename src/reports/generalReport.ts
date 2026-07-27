import type { jsPDF } from "jspdf";
import type { SezzAccountsDatabase } from "@/db/schema";
import { createAccountsRepository } from "@/db/accountsRepository";
import { getAccountFlows, netOf } from "@/db/accountFlows";
import { getMonthlyReport } from "@/db/monthlyReport";
import { getBudgetSummary } from "@/db/budgetSummary";
import { createEngagementsRepository } from "@/db/engagementsRepository";
import { getAllDebtSummaries } from "@/db/debtSummary";
import { formatFcfa } from "@/lib/money";
import {
  createReportDocument,
  addReportTable,
  addSectionHeading,
  downloadReport,
} from "./pdfDocument";

const DEBT_STATUS_LABELS: Record<string, string> = {
  settled: "Soldé",
  overdue: "En retard",
  ongoing: "En cours",
};

const ENGAGEMENT_STATUS_LABELS: Record<string, string> = {
  engaged: "Engagé",
  realized: "Réalisé",
  cancelled: "Annulé",
};

/**
 * The overview report: account balances, this month's income/expense, the
 * budget summary, this month's engagements, and every debt/receivable —
 * every table the app has, brought into a single downloadable document
 * rather than something someone has to assemble screen by screen.
 */
export async function generateGeneralReportPdf(
  database: SezzAccountsDatabase,
  year: number,
  month: number,
): Promise<jsPDF> {
  const accountsRepo = createAccountsRepository(database);
  const engagementsRepo = createEngagementsRepository(database);
  const [accounts, flows, monthlyRows, budgetCategories, engagements, debtSummaries] =
    await Promise.all([
      accountsRepo.list(),
      getAccountFlows(database),
      getMonthlyReport(year, database),
      getBudgetSummary(year, month, database),
      engagementsRepo.list({ year, month }),
      getAllDebtSummaries(database),
    ]);
  const monthRow = monthlyRows.find((r) => r.month === month);
  const subcategoryNameById = new Map(
    budgetCategories.flatMap((c) => c.subcategories.map((s) => [s.subcategoryId, s.name])),
  );

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
    y =
      addReportTable(
        doc,
        y,
        [["Ligne budgétaire", "Alloué", "Réel", "Engagé", "Restant"]],
        budgetRows,
      ) + 12;
  }

  y = addSectionHeading(doc, `Engagements — ${monthLabel}`, y);
  if (engagements.length > 0) {
    const engagementRows = engagements.map((e) => [
      e.date,
      subcategoryNameById.get(e.subcategoryId) ?? "—",
      e.label,
      formatFcfa(e.amount),
      ENGAGEMENT_STATUS_LABELS[e.status] ?? e.status,
    ]);
    y =
      addReportTable(
        doc,
        y,
        [["Date", "Ligne budgétaire", "Libellé", "Montant", "Statut"]],
        engagementRows,
      ) + 12;
  } else {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text("Aucun engagement ce mois-ci.", 14, y);
    y += 12;
  }

  y = addSectionHeading(doc, "Dettes & créances", y);
  if (debtSummaries.length > 0) {
    const debtRows = debtSummaries.map(({ debt, remaining, status }) => [
      debt.reference,
      debt.kind === "debt" ? "Dette" : "Créance",
      debt.counterparty,
      formatFcfa(debt.amount),
      formatFcfa(remaining),
      DEBT_STATUS_LABELS[status] ?? status,
    ]);
    addReportTable(
      doc,
      y,
      [["Réf.", "Type", "Tiers", "Montant initial", "Restant", "Statut"]],
      debtRows,
    );
  } else {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text("Aucune dette ni créance enregistrée.", 14, y);
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
