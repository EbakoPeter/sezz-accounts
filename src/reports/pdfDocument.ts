import { jsPDF } from "jspdf";
import autoTable, { type RowInput } from "jspdf-autotable";

const INK = "#16333e";
const TEXT_DIM = "#726b5e";

/** jspdf-autotable attaches this to the jsPDF instance at runtime as a
 * plugin; its own published types don't declare it on jsPDF itself. This
 * is the one place that gap is bridged, with a type that states exactly
 * the runtime shape actually relied on, rather than opting out of
 * checking entirely. */
interface JsPDFWithAutoTable extends jsPDF {
  lastAutoTable: { finalY: number };
}

/** Creates a new PDF document with a consistent title block — used by
 * every report so they look like they belong to the same app, not three
 * unrelated documents. Returns the document positioned just below the
 * header, ready for the caller to add tables/text. */
export function createReportDocument(title: string, subtitle: string): jsPDF {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(INK);
  doc.text("NKaP", 14, 18);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(title, 14, 30);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(TEXT_DIM);
  doc.text(subtitle, 14, 37);

  const generatedAt = new Date().toLocaleString("fr-FR", {
    dateStyle: "long",
    timeStyle: "short",
  });
  doc.setFontSize(8);
  doc.text(`Généré le ${generatedAt}`, pageWidth - 14, 18, { align: "right" });

  doc.setDrawColor(INK);
  doc.setLineWidth(0.5);
  doc.line(14, 41, pageWidth - 14, 41);

  return doc;
}

/** Adds a table using the app's own colors, starting at `startY` — a thin
 * wrapper so every report's tables look consistent without each report
 * re-specifying the same styling. Returns the y position just below the
 * finished table, for whatever comes next. */
export function addReportTable(
  doc: jsPDF,
  startY: number,
  head: RowInput[],
  body: RowInput[],
): number {
  autoTable(doc, {
    startY,
    head,
    body,
    headStyles: { fillColor: INK, textColor: "#f4efe2" },
    styles: { fontSize: 9, cellPadding: 3 },
    margin: { left: 14, right: 14 },
  });
  return (doc as JsPDFWithAutoTable).lastAutoTable.finalY;
}

/** Adds a section heading (e.g. "Comptes", "Budget du mois") at the given
 * y position, returning the y position content should start at below it. */
export function addSectionHeading(doc: jsPDF, title: string, y: number): number {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(INK);
  doc.text(title, 14, y);
  return y + 6;
}

/** Triggers a browser download of the given document with the given
 * filename — the one place any report actually writes to disk, so the
 * "how" of downloading isn't repeated in every report module. */
export function downloadReport(doc: jsPDF, filename: string): void {
  doc.save(filename);
}
