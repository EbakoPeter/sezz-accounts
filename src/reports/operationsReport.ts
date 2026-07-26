import type { jsPDF } from "jspdf";
import type { SezzAccountsDatabase } from "@/db/schema";
import { createTransactionsRepository } from "@/db/transactionsRepository";
import { createAccountsRepository } from "@/db/accountsRepository";
import { formatFcfa } from "@/lib/money";
import { createReportDocument, addReportTable, downloadReport } from "./pdfDocument";

/** All operations between `from` and `to` (inclusive, "YYYY-MM-DD"),
 * chronological, with a running total row at the end — the "relevé" a
 * bank-style operations report is expected to look like. */
export async function generateOperationsReportPdf(
  database: SezzAccountsDatabase,
  from: string,
  to: string,
): Promise<jsPDF> {
  const transactionsRepo = createTransactionsRepository(database);
  const accountsRepo = createAccountsRepository(database);
  const [transactions, accounts] = await Promise.all([
    transactionsRepo.list({ from, to }),
    accountsRepo.list(),
  ]);
  const accountNameById = new Map(accounts.map((a) => [a.id, a.name]));

  // list() sorts most-recent-first; a ledger reads naturally chronological
  const chronological = transactions.slice().reverse();

  const doc = createReportDocument(
    "Rapport par opérations",
    `Du ${from} au ${to} — ${chronological.length} opération(s)`,
  );

  const totalIncome = chronological
    .filter((tx) => tx.kind === "income")
    .reduce((sum, tx) => sum + tx.amount, 0);
  const totalExpense = chronological
    .filter((tx) => tx.kind === "expense")
    .reduce((sum, tx) => sum + tx.amount, 0);

  const rows = chronological.map((tx) => [
    tx.date,
    accountNameById.get(tx.accountId) ?? "—",
    tx.kind === "income" ? "Revenu" : "Dépense",
    tx.label,
    `${tx.kind === "expense" ? "-" : "+"}${formatFcfa(tx.amount)}`,
  ]);
  rows.push(["", "", "", "Total revenus", formatFcfa(totalIncome)]);
  rows.push(["", "", "", "Total dépenses", `-${formatFcfa(totalExpense)}`]);
  rows.push(["", "", "", "Solde net", formatFcfa(totalIncome - totalExpense)]);

  addReportTable(doc, 48, [["Date", "Compte", "Type", "Libellé", "Montant"]], rows);

  return doc;
}

export async function downloadOperationsReport(
  database: SezzAccountsDatabase,
  from: string,
  to: string,
): Promise<void> {
  const doc = await generateOperationsReportPdf(database, from, to);
  downloadReport(doc, `sezz-rapport-operations-${from}-au-${to}.pdf`);
}
