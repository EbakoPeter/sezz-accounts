import { useState } from "react";
import { useAuth } from "@/auth/AuthContext";
import { db } from "@/db/schema";

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

export function ReportsPanel() {
  const { currentUser } = useAuth();
  const canView = currentUser?.permissions.viewReports ?? false;

  const { year: defaultYear, month: defaultMonth } = currentYearMonth();

  const [generalPeriod, setGeneralPeriod] = useState(isoMonth(defaultYear, defaultMonth));
  const [generalBusy, setGeneralBusy] = useState(false);
  const [generalError, setGeneralError] = useState<string | null>(null);

  const [opsFrom, setOpsFrom] = useState(firstOfMonthIso());
  const [opsTo, setOpsTo] = useState(todayIso());
  const [opsBusy, setOpsBusy] = useState(false);
  const [opsError, setOpsError] = useState<string | null>(null);

  const [cashFrom, setCashFrom] = useState(isoMonth(defaultYear, defaultMonth));
  const [cashTo, setCashTo] = useState(isoMonth(defaultYear, defaultMonth));
  const [cashBusy, setCashBusy] = useState(false);
  const [cashError, setCashError] = useState<string | null>(null);

  if (!canView) {
    return (
      <section aria-labelledby="reports-heading">
        <h2 id="reports-heading">Rapports</h2>
        <p className="permission-notice">
          Vous n&apos;avez pas la permission de consulter les rapports.
        </p>
      </section>
    );
  }

  async function handleDownloadGeneral() {
    setGeneralError(null);
    setGeneralBusy(true);
    try {
      const [year, month] = generalPeriod.split("-").map(Number);
      if (!year || !month) throw new Error("Mois invalide.");
      const { downloadGeneralReport } = await import("@/reports/generalReport");
      await downloadGeneralReport(db, year, month);
    } catch (error) {
      setGeneralError(error instanceof Error ? error.message : "Erreur inattendue.");
    } finally {
      setGeneralBusy(false);
    }
  }

  async function handleDownloadOperations() {
    setOpsError(null);
    setOpsBusy(true);
    try {
      if (opsFrom > opsTo) throw new Error("La date de début doit précéder la date de fin.");
      const { downloadOperationsReport } = await import("@/reports/operationsReport");
      await downloadOperationsReport(db, opsFrom, opsTo);
    } catch (error) {
      setOpsError(error instanceof Error ? error.message : "Erreur inattendue.");
    } finally {
      setOpsBusy(false);
    }
  }

  async function handleDownloadCashFlow() {
    setCashError(null);
    setCashBusy(true);
    try {
      if (cashFrom > cashTo) throw new Error("Le mois de début doit précéder le mois de fin.");
      const { downloadCashFlowReport } = await import("@/reports/cashFlowReport");
      await downloadCashFlowReport(db, cashFrom, cashTo);
    } catch (error) {
      setCashError(error instanceof Error ? error.message : "Erreur inattendue.");
    } finally {
      setCashBusy(false);
    }
  }

  return (
    <section aria-labelledby="reports-heading">
      <h2 id="reports-heading">Rapports</h2>

      <section aria-labelledby="general-report-heading">
        <h3 id="general-report-heading">Rapport général</h3>
        <p className="tagline">
          Vue d&apos;ensemble d&apos;un mois : soldes des comptes, revenus et dépenses, budget
          prévisionnel.
        </p>
        <div className="field">
          <label htmlFor="general-report-month">Mois</label>
          <input
            id="general-report-month"
            type="month"
            value={generalPeriod}
            onChange={(e) => setGeneralPeriod(e.target.value)}
          />
        </div>
        <button type="button" onClick={handleDownloadGeneral} disabled={generalBusy}>
          {generalBusy ? "Génération…" : "Télécharger en PDF"}
        </button>
        {generalError && (
          <p role="alert" className="form-error">
            {generalError}
          </p>
        )}
      </section>

      <section aria-labelledby="operations-report-heading">
        <h3 id="operations-report-heading">Rapport par opérations</h3>
        <p className="tagline">
          Relevé de toutes les opérations d&apos;une période donnée, comme un relevé bancaire.
        </p>
        <div className="field">
          <label htmlFor="ops-report-from">Du</label>
          <input
            id="ops-report-from"
            type="date"
            value={opsFrom}
            onChange={(e) => setOpsFrom(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="ops-report-to">Au</label>
          <input
            id="ops-report-to"
            type="date"
            value={opsTo}
            onChange={(e) => setOpsTo(e.target.value)}
          />
        </div>
        <button type="button" onClick={handleDownloadOperations} disabled={opsBusy}>
          {opsBusy ? "Génération…" : "Télécharger en PDF"}
        </button>
        {opsError && (
          <p role="alert" className="form-error">
            {opsError}
          </p>
        )}
      </section>

      <section aria-labelledby="cashflow-report-heading">
        <h3 id="cashflow-report-heading">Rapport de trésorerie</h3>
        <p className="tagline">
          Évolution du solde de chaque compte, mois par mois, sur la période choisie.
        </p>
        <div className="field">
          <label htmlFor="cashflow-report-from">Du mois</label>
          <input
            id="cashflow-report-from"
            type="month"
            value={cashFrom}
            onChange={(e) => setCashFrom(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="cashflow-report-to">Au mois</label>
          <input
            id="cashflow-report-to"
            type="month"
            value={cashTo}
            onChange={(e) => setCashTo(e.target.value)}
          />
        </div>
        <button type="button" onClick={handleDownloadCashFlow} disabled={cashBusy}>
          {cashBusy ? "Génération…" : "Télécharger en PDF"}
        </button>
        {cashError && (
          <p role="alert" className="form-error">
            {cashError}
          </p>
        )}
      </section>
    </section>
  );
}
