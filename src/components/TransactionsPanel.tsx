import { useState, type FormEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { transactionsRepository, transfersRepository } from "@/repositories";
import { useAccountsWithBalances } from "@/hooks/useAccountsWithBalances";
import { useBudgetSummary } from "@/hooks/useBudgetSummary";
import { useAuth } from "@/auth/AuthContext";
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
  const { currentUser } = useAuth();
  const canManage = currentUser?.permissions.manageTransactions ?? false;

  const [accountId, setAccountId] = useState("");
  const [kind, setKind] = useState<TransactionKind>("expense");
  const [date, setDate] = useState(todayIso());
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [subcategoryId, setSubcategoryId] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editAccountId, setEditAccountId] = useState("");
  const [editKind, setEditKind] = useState<TransactionKind>("expense");
  const [editDate, setEditDate] = useState("");
  const [editLabel, setEditLabel] = useState("");
  const [editAmount, setEditAmount] = useState("");
  const [editSubcategoryId, setEditSubcategoryId] = useState("");
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);

  const transfers = useLiveQuery(() => transfersRepository.list(), []);
  const [transferFromId, setTransferFromId] = useState("");
  const [transferToId, setTransferToId] = useState("");
  const [transferAmount, setTransferAmount] = useState("");
  const [transferDate, setTransferDate] = useState(todayIso());
  const [transferLabel, setTransferLabel] = useState("");
  const [transferError, setTransferError] = useState<string | null>(null);

  const [editingTransferId, setEditingTransferId] = useState<string | null>(null);
  const [editTransferFromId, setEditTransferFromId] = useState("");
  const [editTransferToId, setEditTransferToId] = useState("");
  const [editTransferAmount, setEditTransferAmount] = useState("");
  const [editTransferDate, setEditTransferDate] = useState("");
  const [editTransferLabel, setEditTransferLabel] = useState("");
  const [transferRowError, setTransferRowError] = useState<{
    id: string;
    message: string;
  } | null>(null);

  const { year, month } = yearMonthOf(date);
  const budgetSummary = useBudgetSummary(year, month);
  const editYearMonth = yearMonthOf(editDate || todayIso());
  const editBudgetSummary = useBudgetSummary(editYearMonth.year, editYearMonth.month);

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

  function handleStartEdit(tx: {
    id: string;
    accountId: string;
    kind: TransactionKind;
    date: string;
    label: string;
    amount: number;
    subcategoryId?: string;
  }) {
    setRowError(null);
    setEditingId(tx.id);
    setEditAccountId(tx.accountId);
    setEditKind(tx.kind);
    setEditDate(tx.date);
    setEditLabel(tx.label);
    setEditAmount(String(tx.amount));
    setEditSubcategoryId(tx.subcategoryId ?? "");
  }

  function handleCancelEdit() {
    setEditingId(null);
  }

  async function handleSaveEdit(id: string) {
    setRowError(null);
    try {
      await transactionsRepository.update(id, {
        accountId: editAccountId,
        kind: editKind,
        date: editDate,
        label: editLabel,
        amount: Number(editAmount),
        subcategoryId: editKind === "expense" && editSubcategoryId ? editSubcategoryId : null,
      });
      setEditingId(null);
    } catch (error) {
      setRowError({
        id,
        message: error instanceof Error ? error.message : "Erreur inattendue.",
      });
    }
  }

  async function handleCreateTransfer(event: FormEvent) {
    event.preventDefault();
    setTransferError(null);
    try {
      await transfersRepository.create({
        fromAccountId: transferFromId,
        toAccountId: transferToId,
        amount: Number(transferAmount),
        date: transferDate,
        ...(transferLabel ? { label: transferLabel } : {}),
      });
      setTransferAmount("");
      setTransferLabel("");
    } catch (error) {
      setTransferError(error instanceof Error ? error.message : "Erreur inattendue.");
    }
  }

  async function handleDeleteTransfer(id: string) {
    setTransferRowError(null);
    try {
      await transfersRepository.remove(id);
    } catch (error) {
      setTransferRowError({
        id,
        message: error instanceof Error ? error.message : "Erreur inattendue.",
      });
    }
  }

  function handleStartEditTransfer(transfer: {
    id: string;
    fromAccountId: string;
    toAccountId: string;
    amount: number;
    date: string;
    label?: string;
  }) {
    setTransferRowError(null);
    setEditingTransferId(transfer.id);
    setEditTransferFromId(transfer.fromAccountId);
    setEditTransferToId(transfer.toAccountId);
    setEditTransferAmount(String(transfer.amount));
    setEditTransferDate(transfer.date);
    setEditTransferLabel(transfer.label ?? "");
  }

  function handleCancelEditTransfer() {
    setEditingTransferId(null);
  }

  async function handleSaveEditTransfer(id: string) {
    setTransferRowError(null);
    try {
      await transfersRepository.update(id, {
        fromAccountId: editTransferFromId,
        toAccountId: editTransferToId,
        amount: Number(editTransferAmount),
        date: editTransferDate,
        label: editTransferLabel,
      });
      setEditingTransferId(null);
    } catch (error) {
      setTransferRowError({
        id,
        message: error instanceof Error ? error.message : "Erreur inattendue.",
      });
    }
  }

  const hasAccounts = (accounts?.length ?? 0) > 0;

  return (
    <section aria-labelledby="transactions-heading">
      <h2 id="transactions-heading">Opérations</h2>

      {!canManage ? (
        <p className="permission-notice">
          Vous n&apos;avez pas la permission d&apos;enregistrer des opérations.
        </p>
      ) : !hasAccounts ? (
        <p className="empty">
          Créez d&apos;abord un compte pour pouvoir enregistrer une opération.
        </p>
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
        <div className="table-scroll">
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
              {transactions.map((tx) =>
                editingId === tx.id ? (
                  <tr key={tx.id}>
                    <td>
                      <input
                        aria-label={`Date de ${tx.label}`}
                        type="date"
                        value={editDate}
                        onChange={(e) => setEditDate(e.target.value)}
                      />
                    </td>
                    <td>
                      <select
                        aria-label={`Compte de ${tx.label}`}
                        value={editAccountId}
                        onChange={(e) => setEditAccountId(e.target.value)}
                      >
                        {accounts?.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                      </select>
                      <select
                        aria-label={`Type de ${tx.label}`}
                        value={editKind}
                        onChange={(e) => setEditKind(e.target.value as TransactionKind)}
                      >
                        <option value="income">Revenu</option>
                        <option value="expense">Dépense</option>
                      </select>
                    </td>
                    <td>
                      <input
                        aria-label={`Libellé de ${tx.label}`}
                        value={editLabel}
                        onChange={(e) => setEditLabel(e.target.value)}
                      />
                    </td>
                    <td>
                      {editKind === "expense" && (editBudgetSummary?.length ?? 0) > 0 && (
                        <select
                          aria-label={`Ligne budgétaire de ${tx.label}`}
                          value={editSubcategoryId}
                          onChange={(e) => setEditSubcategoryId(e.target.value)}
                        >
                          <option value="">Aucune</option>
                          {editBudgetSummary?.map((category) => (
                            <optgroup key={category.categoryId} label={category.name}>
                              {category.subcategories.map((sub) => (
                                <option key={sub.subcategoryId} value={sub.subcategoryId}>
                                  {sub.name}
                                </option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                      )}
                    </td>
                    <td>
                      <input
                        aria-label={`Montant de ${tx.label}`}
                        type="number"
                        value={editAmount}
                        onChange={(e) => setEditAmount(e.target.value)}
                      />
                    </td>
                    <td>
                      <button type="button" onClick={() => handleSaveEdit(tx.id)}>
                        Enregistrer
                      </button>{" "}
                      <button type="button" className="ghost" onClick={handleCancelEdit}>
                        Annuler
                      </button>
                      {rowError?.id === tx.id && (
                        <p role="alert" className="form-error">
                          {rowError.message}
                        </p>
                      )}
                    </td>
                  </tr>
                ) : (
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
                      {canManage && (
                        <>
                          <button type="button" onClick={() => handleStartEdit(tx)}>
                            Modifier
                          </button>{" "}
                          <button type="button" onClick={() => handleDelete(tx.id)}>
                            Supprimer
                          </button>
                        </>
                      )}
                      {rowError?.id === tx.id && (
                        <p role="alert" className="form-error">
                          {rowError.message}
                        </p>
                      )}
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}

      {canManage && hasAccounts && (accounts?.length ?? 0) >= 2 && (
        <>
          <h3>Transferts entre comptes</h3>
          <form onSubmit={handleCreateTransfer} aria-label="Ajouter un transfert">
            <div className="field">
              <label htmlFor="transfer-from">Compte source</label>
              <select
                id="transfer-from"
                value={transferFromId}
                onChange={(e) => setTransferFromId(e.target.value)}
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
              <label htmlFor="transfer-to">Compte destination</label>
              <select
                id="transfer-to"
                value={transferToId}
                onChange={(e) => setTransferToId(e.target.value)}
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
              <label htmlFor="transfer-amount">Montant</label>
              <input
                id="transfer-amount"
                type="number"
                value={transferAmount}
                onChange={(e) => setTransferAmount(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="transfer-date">Date</label>
              <input
                id="transfer-date"
                type="date"
                value={transferDate}
                onChange={(e) => setTransferDate(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="transfer-label">Libellé (optionnel)</label>
              <input
                id="transfer-label"
                value={transferLabel}
                onChange={(e) => setTransferLabel(e.target.value)}
                placeholder="Ex : Vers épargne"
              />
            </div>
            <button type="submit">+ Ajouter</button>
            {transferError && (
              <p role="alert" className="form-error">
                {transferError}
              </p>
            )}
          </form>
        </>
      )}

      {(transfers?.length ?? 0) > 0 && (
        <>
          {!canManage && <h3>Transferts entre comptes</h3>}
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>De</th>
                  <th>Vers</th>
                  <th>Libellé</th>
                  <th>Montant</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {transfers?.map((transfer) =>
                  editingTransferId === transfer.id ? (
                    <tr key={transfer.id}>
                      <td>
                        <input
                          aria-label={`Date du transfert du ${transfer.date}`}
                          type="date"
                          value={editTransferDate}
                          onChange={(e) => setEditTransferDate(e.target.value)}
                        />
                      </td>
                      <td>
                        <select
                          aria-label={`Compte source du transfert du ${transfer.date}`}
                          value={editTransferFromId}
                          onChange={(e) => setEditTransferFromId(e.target.value)}
                        >
                          {accounts?.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <select
                          aria-label={`Compte destination du transfert du ${transfer.date}`}
                          value={editTransferToId}
                          onChange={(e) => setEditTransferToId(e.target.value)}
                        >
                          {accounts?.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          aria-label={`Libellé du transfert du ${transfer.date}`}
                          value={editTransferLabel}
                          onChange={(e) => setEditTransferLabel(e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          aria-label={`Montant du transfert du ${transfer.date}`}
                          type="number"
                          value={editTransferAmount}
                          onChange={(e) => setEditTransferAmount(e.target.value)}
                        />
                      </td>
                      <td>
                        <button type="button" onClick={() => handleSaveEditTransfer(transfer.id)}>
                          Enregistrer
                        </button>{" "}
                        <button type="button" className="ghost" onClick={handleCancelEditTransfer}>
                          Annuler
                        </button>
                        {transferRowError?.id === transfer.id && (
                          <p role="alert" className="form-error">
                            {transferRowError.message}
                          </p>
                        )}
                      </td>
                    </tr>
                  ) : (
                    <tr key={transfer.id}>
                      <td>{transfer.date}</td>
                      <td>{accountNameById.get(transfer.fromAccountId) ?? "—"}</td>
                      <td>{accountNameById.get(transfer.toAccountId) ?? "—"}</td>
                      <td>{transfer.label ?? "—"}</td>
                      <td className="num">{formatFcfa(transfer.amount)}</td>
                      <td>
                        {canManage && (
                          <>
                            <button type="button" onClick={() => handleStartEditTransfer(transfer)}>
                              Modifier
                            </button>{" "}
                            <button type="button" onClick={() => handleDeleteTransfer(transfer.id)}>
                              Supprimer
                            </button>
                          </>
                        )}
                        {transferRowError?.id === transfer.id && (
                          <p role="alert" className="form-error">
                            {transferRowError.message}
                          </p>
                        )}
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
