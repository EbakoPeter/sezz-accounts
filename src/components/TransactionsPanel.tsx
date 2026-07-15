import { useState, type FormEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { transactionsRepository } from "@/repositories";
import { useAccountsWithBalances } from "@/hooks/useAccountsWithBalances";
import { formatFcfa } from "@/lib/money";
import type { TransactionKind } from "@/types/models";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function TransactionsPanel() {
  const accounts = useAccountsWithBalances();
  const transactions = useLiveQuery(() => transactionsRepository.list(), []);

  const [accountId, setAccountId] = useState("");
  const [kind, setKind] = useState<TransactionKind>("expense");
  const [date, setDate] = useState(todayIso());
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const accountNameById = new Map((accounts ?? []).map((a) => [a.id, a.name]));

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
      });
      setLabel("");
      setAmount("");
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
