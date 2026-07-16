import { useState, type FormEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { debtsRepository, debtPaymentsRepository } from "@/repositories";
import { useAccountsWithBalances } from "@/hooks/useAccountsWithBalances";
import { useDebtSummaries } from "@/hooks/useDebtSummaries";
import { useAuth } from "@/auth/AuthContext";
import { formatFcfa } from "@/lib/money";
import type { DebtKind } from "@/types/models";
import type { DebtStatus } from "@/db/debtSummary";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

const STATUS_LABELS: Record<DebtStatus, string> = {
  settled: "Soldé",
  overdue: "En retard",
  ongoing: "En cours",
};

export function DebtsPanel() {
  const accounts = useAccountsWithBalances();
  const summaries = useDebtSummaries();
  const debtsForPaymentForm = useLiveQuery(() => debtsRepository.list(), []);
  const { currentUser } = useAuth();
  const canManage = currentUser?.permissions.manageDebts ?? false;

  const [kind, setKind] = useState<DebtKind>("debt");
  const [counterparty, setCounterparty] = useState("");
  const [accountId, setAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayIso());
  const [dueDate, setDueDate] = useState("");
  const [debtError, setDebtError] = useState<string | null>(null);

  const [paymentDebtId, setPaymentDebtId] = useState("");
  const [paymentAccountId, setPaymentAccountId] = useState("");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(todayIso());
  const [paymentError, setPaymentError] = useState<string | null>(null);

  const hasAccounts = (accounts?.length ?? 0) > 0;

  async function handleCreateDebt(event: FormEvent) {
    event.preventDefault();
    setDebtError(null);
    try {
      await debtsRepository.create({
        kind,
        counterparty,
        accountId,
        amount: Number(amount),
        date,
        ...(dueDate ? { dueDate } : {}),
      });
      setCounterparty("");
      setAmount("");
      setDueDate("");
    } catch (error) {
      setDebtError(error instanceof Error ? error.message : "Erreur inattendue.");
    }
  }

  async function handleCreatePayment(event: FormEvent) {
    event.preventDefault();
    setPaymentError(null);
    try {
      await debtPaymentsRepository.create({
        debtId: paymentDebtId,
        accountId: paymentAccountId,
        amount: Number(paymentAmount),
        date: paymentDate,
      });
      setPaymentAmount("");
    } catch (error) {
      setPaymentError(error instanceof Error ? error.message : "Erreur inattendue.");
    }
  }

  async function handleDeleteDebt(id: string) {
    await debtsRepository.remove(id);
  }

  return (
    <section aria-labelledby="debts-heading">
      <h2 id="debts-heading">Dettes &amp; Créances</h2>
      <p className="tagline">
        « Dette » = argent que vous devez · « Créance » = argent qu&apos;on vous doit.
      </p>

      {!canManage ? (
        <p className="permission-notice">
          Vous n&apos;avez pas la permission de gérer les dettes et créances.
        </p>
      ) : !hasAccounts ? (
        <p className="empty">Créez d&apos;abord un compte.</p>
      ) : (
        <form onSubmit={handleCreateDebt} aria-label="Ajouter une dette ou créance">
          <div className="field">
            <label htmlFor="debt-kind">Type</label>
            <select
              id="debt-kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as DebtKind)}
            >
              <option value="debt">Dette</option>
              <option value="receivable">Créance</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="debt-counterparty">Tiers</label>
            <input
              id="debt-counterparty"
              value={counterparty}
              onChange={(e) => setCounterparty(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="debt-account">Compte concerné</label>
            <select
              id="debt-account"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
            >
              <option value="" disabled>
                Choisir…
              </option>
              {accounts?.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} — {formatFcfa(a.balance)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="debt-amount">Montant</label>
            <input
              id="debt-amount"
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="debt-date">Date</label>
            <input
              id="debt-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="debt-due">Échéance (optionnelle)</label>
            <input
              id="debt-due"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>
          <button type="submit">+ Ajouter</button>
          {debtError && (
            <p role="alert" className="form-error">
              {debtError}
            </p>
          )}
        </form>
      )}

      {summaries === undefined ? (
        <p>Chargement…</p>
      ) : summaries.length === 0 ? (
        <p className="empty">Aucune dette ou créance enregistrée.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Réf</th>
              <th>Type</th>
              <th>Tiers</th>
              <th>Montant initial</th>
              <th>Restant</th>
              <th>Mensualité prévisionnelle</th>
              <th>Statut</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {summaries.map(({ debt, remaining, status, plannedMonthlyPayment }) => (
              <tr key={debt.id}>
                <td>{debt.reference}</td>
                <td>{debt.kind === "debt" ? "Dette" : "Créance"}</td>
                <td>{debt.counterparty}</td>
                <td className="num">{formatFcfa(debt.amount)}</td>
                <td className={`num ${remaining < 0 ? "negative" : ""}`}>
                  {formatFcfa(remaining)}
                </td>
                <td className="num">
                  {plannedMonthlyPayment === null ? "—" : formatFcfa(plannedMonthlyPayment)}
                </td>
                <td>{STATUS_LABELS[status]}</td>
                <td>
                  {canManage && (
                    <button type="button" onClick={() => handleDeleteDebt(debt.id)}>
                      Supprimer
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {canManage && (debtsForPaymentForm?.length ?? 0) > 0 && (
        <>
          <h3>Remboursements</h3>
          <form onSubmit={handleCreatePayment} aria-label="Ajouter un remboursement">
            <div className="field">
              <label htmlFor="payment-debt">Dette / créance</label>
              <select
                id="payment-debt"
                value={paymentDebtId}
                onChange={(e) => setPaymentDebtId(e.target.value)}
              >
                <option value="" disabled>
                  Choisir…
                </option>
                {debtsForPaymentForm?.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.reference} — {d.counterparty}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="payment-account">Compte concerné</label>
              <select
                id="payment-account"
                value={paymentAccountId}
                onChange={(e) => setPaymentAccountId(e.target.value)}
              >
                <option value="" disabled>
                  Choisir…
                </option>
                {accounts?.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="payment-amount">Montant</label>
              <input
                id="payment-amount"
                type="number"
                value={paymentAmount}
                onChange={(e) => setPaymentAmount(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="payment-date">Date</label>
              <input
                id="payment-date"
                type="date"
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
              />
            </div>
            <button type="submit">+ Ajouter</button>
            {paymentError && (
              <p role="alert" className="form-error">
                {paymentError}
              </p>
            )}
          </form>
        </>
      )}
    </section>
  );
}
