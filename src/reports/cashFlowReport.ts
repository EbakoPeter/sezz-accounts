import type { jsPDF } from "jspdf";
import type { SezzAccountsDatabase } from "@/db/schema";
import { createAccountsRepository } from "@/db/accountsRepository";
import { getCashFlowOverTime } from "./cashFlow";
import { formatFcfa } from "@/lib/money";
import { createReportDocument, addReportTable, downloadReport } from "./pdfDocument";

/** Account balance evolution, one row per month in [from, to] ("YYYY-MM"
 * each) — the treasury report: how much did the household have, overall
 * and per account, at the end of each month. */
export async function generateCashFlowReportPdf(
  database: SezzAccountsDatabase,
  from: string,
  to: string,
): Promise<jsPDF> {
  const accountsRepo = createAccountsRepository(database);
  const [accounts, points] = await Promise.all([
    accountsRepo.list(),
    getCashFlowOverTime(database, from, to),
  ]);

  const doc = createReportDocument("Rapport de trésorerie", `Du ${from} au ${to}`);

  const head = [["Fin de mois", ...accounts.map((a) => a.name), "Total"]];
  const rows = points.map((point) => [
    point.date,
    ...accounts.map((a) => formatFcfa(point.byAccount.get(a.id) ?? 0)),
    formatFcfa(point.total),
  ]);

  addReportTable(doc, 48, head, rows);

  return doc;
}

export async function downloadCashFlowReport(
  database: SezzAccountsDatabase,
  from: string,
  to: string,
): Promise<void> {
  const doc = await generateCashFlowReportPdf(database, from, to);
  downloadReport(doc, `sezz-rapport-tresorerie-${from}-au-${to}.pdf`);
}
