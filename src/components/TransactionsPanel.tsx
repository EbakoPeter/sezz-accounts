import { useState, type FormEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { transactionsRepository } from "@/repositories";
import { useAccountsWithBalances } from "@/hooks/useAccountsWithBalances";
import { useBudgetSummary } from "@/hooks/useBudgetSummary";
import { formatFcfa } from "@/lib/money";
import type { TransactionKind } from "@/types/models";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function yearMonthOf(isoDate: string): { year: number; month: number } {
  const [y, m] = isoDate.split("-").map(Number);
  return { year: y ?? new Date().getFullYear(), month: m ?? new Date().getMonth() + 1 };
}

export function TransactionsPanel() {
  const accounts = useAccountsWithBalances();
  const transactions = useLiveQuery(() => transactionsRepository.list(), []);

  const [accountId, setAccountId] = useState("");
  const [kind, setKind] = useState<TransactionKind>("expense");
  const [date, setDate] = useState(todayIso());
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [subcategoryId, setSubcategoryId] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const { year, month } = yearMonthOf(date);
  const budgetSummary = useBudgetSummary(year, month);

  const accountNameById = new Map((accounts ?? []).map((a) => [a.id, a.name]));
  const subcategoryNameById = new Map(
    (budgetSummary ?? []).flatMap((c) => c.subcategories.map((s) => [s.subcategoryId, s.name])),
  );

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    try {
      await transactionsRepository.create({
        accountId,
        kind,
        date,
        label,
        amount: Number(amount),
        ...(kind === "expense" && subcategoryId ? { subcategoryId } : {}),
      });
      setLabel("");
      setAmount("");
      setSubcategoryId("");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Erreur inattendue.");
    }
  }

  async function handleDelete(id: string) {
    await transactionsRepository.remove(id);
  }

  const hasAccounts = (accounts?.length ?? 0) > 0;

  return (
    <section aria-labelledby="transactions-heading">
      <h2 id="transactions-heading">Opérations</h2>

      {!hasAccounts ? (
        <p className="empty">Créez d'abord un compte pour pouvoir enregistrer une opération.</p>
      ) : (
        <form onSubmit={handleCreate} aria-label="Ajouter une opération">
          <div className="field">
            <label htmlFor="tx-account">Compte</label>
            <select
              id="tx-account"
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
            <label htmlFor="tx-kind">Type</label>
            <select
              id="tx-kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as TransactionKind)}
            >
              <option value="income">Revenu</option>
              <option value="expense">Dépense</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="tx-date">Date</label>
            <input
              id="tx-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="tx-label">Libellé</label>
            <input id="tx-label" value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="tx-amount">Montant (FCFA)</label>
            <input
              id="tx-amount"
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          {kind === "expense" && (budgetSummary?.length ?? 0) > 0 && (
            <div className="field">
              <label htmlFor="tx-subcategory">Ligne budgétaire</label>
              <select
                id="tx-subcategory"
                value={subcategoryId}
                onChange={(e) => setSubcategoryId(e.target.value)}
              >
                <option value="">Aucune</option>
                {budgetSummary?.map((category) => (
                  <optgroup key={category.categoryId} label={category.name}>
                    {category.subcategories.map((sub) => (
                      <option key={sub.subcategoryId} value={sub.subcategoryId}>
                        {sub.name}
                        {sub.monthlyAllocation > 0
                          ? ` — reste ${formatFcfa(sub.remaining)} / ${formatFcfa(sub.monthlyAllocation)}`
                          : " — (non provisionné)"}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
          )}
          <button type="submit">+ Ajouter</button>
          {formError && (
            <p role="alert" className="form-error">
              {formError}
            </p>
          )}
        </form>
      )}

      {transactions === undefined ? (
        <p>Chargement…</p>
      ) : transactions.length === 0 ? (
        <p className="empty">Aucune opération enregistrée.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Compte</th>
              <th>Libellé</th>
              <th>Ligne budgétaire</th>
              <th>Montant</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {transactions.map((tx) => (
              <tr key={tx.id}>
                <td>{tx.date}</td>
                <td>{accountNameById.get(tx.accountId) ?? "—"}</td>
                <td>{tx.label}</td>
                <td>
                  {tx.subcategoryId ? (subcategoryNameById.get(tx.subcategoryId) ?? "—") : "—"}
                </td>
                <td className={`num ${tx.kind === "expense" ? "negative" : "positive"}`}>
                  {tx.kind === "expense" ? "-" : "+"}
                  {formatFcfa(tx.amount)}
                </td>
                <td>
                  <button type="button" onClick={() => handleDelete(tx.id)}>
                    Supprimer
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
