import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useAuth } from "@/auth/AuthContext";
import { useTranslation } from "@/i18n/LanguageContext";
import { db } from "@/db/schema";
import { createTransactionsRepository } from "@/db/transactionsRepository";
import { createAccountsRepository } from "@/db/accountsRepository";
import { formatFcfa } from "@/lib/money";
import { PageHeader } from "./PageHeader";

const transactionsRepository = createTransactionsRepository();
const accountsRepository = createAccountsRepository();

function currentYearMonth(): { year: number; month: number } {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

function isoMonth(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function firstOfMonthIso(): string {
  return `${todayIso().slice(0, 7)}-01`;
}

export function ReportsPanel({
  section = "all",
}: {
  section?: "general" | "custom" | "cashflow" | "all";
}) {
  const { currentUser } = useAuth();
  const { t } = useTranslation();
  const canView = currentUser?.permissions.viewReports ?? false;

  const { year: defaultYear, month: defaultMonth } = currentYearMonth();

  const [generalPeriod, setGeneralPeriod] = useState(isoMonth(defaultYear, defaultMonth));
  const [generalBusy, setGeneralBusy] = useState(false);
  const [generalError, setGeneralError] = useState<string | null>(null);

  const [opsFrom, setOpsFrom] = useState(firstOfMonthIso());
  const [opsTo, setOpsTo] = useState(todayIso());
  const [opsKind, setOpsKind] = useState<"all" | "income" | "expense">("all");
  const [opsBusy, setOpsBusy] = useState(false);
  const [opsError, setOpsError] = useState<string | null>(null);

  // Live preview — lets the person actually see what a filter combination
  // turns up before committing to a PDF download, rather than downloading
  // blind and finding out the period or type was wrong only after opening
  // the file.
  const opsPreview = useLiveQuery(async () => {
    if (opsFrom > opsTo) return [];
    const rows = await transactionsRepository.list({
      from: opsFrom,
      to: opsTo,
      ...(opsKind === "all" ? {} : { kind: opsKind }),
    });
    const accounts = await accountsRepository.list();
    const accountNameById = new Map(accounts.map((a) => [a.id, a.name]));
    return rows
      .slice()
      .reverse()
      .map((tx) => ({ ...tx, accountName: accountNameById.get(tx.accountId) ?? "—" }));
  }, [opsFrom, opsTo, opsKind]);

  const [cashFrom, setCashFrom] = useState(isoMonth(defaultYear, defaultMonth));
  const [cashTo, setCashTo] = useState(isoMonth(defaultYear, defaultMonth));
  const [cashBusy, setCashBusy] = useState(false);
  const [cashError, setCashError] = useState<string | null>(null);

  const pageTitle =
    section === "general"
      ? t("reports.titleGeneral")
      : section === "custom"
        ? t("reports.titleCustom")
        : section === "cashflow"
          ? t("reports.titleCashflow")
          : t("reports.title");

  if (!canView) {
    return (
      <section aria-labelledby="reports-heading">
        <PageHeader title={pageTitle} section="reports" id="reports-heading" />
        <p className="permission-notice">{t("reports.noPermission")}</p>
      </section>
    );
  }

  async function handleDownloadGeneral() {
    setGeneralError(null);
    setGeneralBusy(true);
    try {
      const [year, month] = generalPeriod.split("-").map(Number);
      if (!year || !month) throw new Error(t("reports.invalidMonth"));
      const { downloadGeneralReport } = await import("@/reports/generalReport");
      await downloadGeneralReport(db, year, month);
    } catch (error) {
      setGeneralError(error instanceof Error ? error.message : t("common.unexpectedError"));
    } finally {
      setGeneralBusy(false);
    }
  }

  async function handleDownloadOperations() {
    setOpsError(null);
    setOpsBusy(true);
    try {
      if (opsFrom > opsTo) throw new Error(t("reports.fromAfterTo"));
      const { downloadOperationsReport } = await import("@/reports/operationsReport");
      await downloadOperationsReport(db, opsFrom, opsTo, opsKind === "all" ? undefined : opsKind);
    } catch (error) {
      setOpsError(error instanceof Error ? error.message : t("common.unexpectedError"));
    } finally {
      setOpsBusy(false);
    }
  }

  async function handleDownloadCashFlow() {
    setCashError(null);
    setCashBusy(true);
    try {
      if (cashFrom > cashTo) throw new Error(t("reports.fromAfterToMonth"));
      const { downloadCashFlowReport } = await import("@/reports/cashFlowReport");
      await downloadCashFlowReport(db, cashFrom, cashTo);
    } catch (error) {
      setCashError(error instanceof Error ? error.message : t("common.unexpectedError"));
    } finally {
      setCashBusy(false);
    }
  }

  return (
    <section aria-labelledby="reports-heading">
      <PageHeader title={pageTitle} section="reports" id="reports-heading" />

      {(section === "general" || section === "all") && (
        <section className="accent-ink" aria-labelledby="general-report-heading">
          <h3 id="general-report-heading">{t("reports.general.heading")}</h3>
          <p className="tagline">{t("reports.general.tagline")}</p>
          <div className="field">
            <label htmlFor="general-report-month">{t("reports.general.month")}</label>
            <input
              id="general-report-month"
              type="month"
              value={generalPeriod}
              onChange={(e) => setGeneralPeriod(e.target.value)}
            />
          </div>
          <button type="button" onClick={handleDownloadGeneral} disabled={generalBusy}>
            {generalBusy ? t("reports.generating") : t("reports.downloadPdf")}
          </button>
          {generalError && (
            <p role="alert" className="form-error">
              {generalError}
            </p>
          )}
        </section>
      )}

      {(section === "custom" || section === "all") && (
        <section className="accent-gold" aria-labelledby="operations-report-heading">
          <h3 id="operations-report-heading">{t("reports.custom.heading")}</h3>
          <p className="tagline">{t("reports.custom.tagline")}</p>
          <div className="field">
            <label htmlFor="ops-report-from">{t("reports.custom.from")}</label>
            <input
              id="ops-report-from"
              type="date"
              value={opsFrom}
              onChange={(e) => setOpsFrom(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="ops-report-to">{t("reports.custom.to")}</label>
            <input
              id="ops-report-to"
              type="date"
              value={opsTo}
              onChange={(e) => setOpsTo(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="ops-report-kind">{t("reports.custom.type")}</label>
            <select
              id="ops-report-kind"
              value={opsKind}
              onChange={(e) => setOpsKind(e.target.value as "all" | "income" | "expense")}
            >
              <option value="all">{t("reports.custom.type.all")}</option>
              <option value="income">{t("reports.custom.type.income")}</option>
              <option value="expense">{t("reports.custom.type.expense")}</option>
            </select>
          </div>
          <button type="button" onClick={handleDownloadOperations} disabled={opsBusy}>
            {opsBusy ? t("reports.generating") : t("reports.downloadPdf")}
          </button>
          {opsError && (
            <p role="alert" className="form-error">
              {opsError}
            </p>
          )}

          <p className="tagline" style={{ marginTop: 16 }}>
            {t("reports.custom.preview", { count: String(opsPreview?.length ?? 0) })}
          </p>
          {opsFrom > opsTo ? (
            <p className="empty">{t("reports.fromAfterTo")}</p>
          ) : opsPreview === undefined ? (
            <p>{t("common.loading")}</p>
          ) : opsPreview.length === 0 ? (
            <p className="empty">{t("reports.custom.emptyPeriod")}</p>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>{t("reports.custom.table.date")}</th>
                    <th>{t("reports.custom.table.account")}</th>
                    <th>{t("reports.custom.table.type")}</th>
                    <th>{t("reports.custom.table.label")}</th>
                    <th className="num">{t("reports.custom.table.amount")}</th>
                  </tr>
                </thead>
                <tbody>
                  {opsPreview.map((tx) => (
                    <tr key={tx.id}>
                      <td>{tx.date}</td>
                      <td className="truncate">{tx.accountName}</td>
                      <td>
                        {tx.kind === "income"
                          ? t("reports.custom.income")
                          : t("reports.custom.expense")}
                      </td>
                      <td className="truncate">{tx.label}</td>
                      <td className={`num ${tx.kind === "expense" ? "negative" : ""}`}>
                        {tx.kind === "expense" ? "-" : "+"}
                        {formatFcfa(tx.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {(section === "cashflow" || section === "all") && (
        <section className="accent-sage" aria-labelledby="cashflow-report-heading">
          <h3 id="cashflow-report-heading">{t("reports.cashflow.heading")}</h3>
          <p className="tagline">{t("reports.cashflow.tagline")}</p>
          <div className="field">
            <label htmlFor="cashflow-report-from">{t("reports.cashflow.from")}</label>
            <input
              id="cashflow-report-from"
              type="month"
              value={cashFrom}
              onChange={(e) => setCashFrom(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="cashflow-report-to">{t("reports.cashflow.to")}</label>
            <input
              id="cashflow-report-to"
              type="month"
              value={cashTo}
              onChange={(e) => setCashTo(e.target.value)}
            />
          </div>
          <button type="button" onClick={handleDownloadCashFlow} disabled={cashBusy}>
            {cashBusy ? t("reports.generating") : t("reports.downloadPdf")}
          </button>
          {cashError && (
            <p role="alert" className="form-error">
              {cashError}
            </p>
          )}
        </section>
      )}
    </section>
  );
}
