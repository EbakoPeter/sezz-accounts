import { useState, type FormEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { transactionsRepository, transfersRepository, engagementsRepository } from "@/repositories";
import { useAccountsWithBalances } from "@/hooks/useAccountsWithBalances";
import { useBudgetSummary } from "@/hooks/useBudgetSummary";
import { useAuth } from "@/auth/AuthContext";
import { useTranslation } from "@/i18n/LanguageContext";
import { formatFcfa } from "@/lib/money";
import type { TransactionKind } from "@/types/models";
import { PageHeader } from "./PageHeader";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function yearMonthOf(isoDate: string): { year: number; month: number } {
  const [y, m] = isoDate.split("-").map(Number);
  return { year: y ?? new Date().getFullYear(), month: m ?? new Date().getMonth() + 1 };
}

export function TransactionsPanel({
  view = "both",
}: {
  view?: "transfers" | "operations" | "expense" | "income" | "both";
}) {
  const accounts = useAccountsWithBalances();
  const { currentUser } = useAuth();
  const { t } = useTranslation();
  const canManage = currentUser?.permissions.manageTransactions ?? false;

  // "expense" and "income" are dedicated, single-purpose tabs (Dépenses,
  // and Revenus > Entrées) — each always creates that one kind, so there
  // is nothing to choose and no Type selector to show at all, matching
  // the "less typing, friendlier" goal these two tabs exist for.
  const lockedKind = view === "expense" ? "expense" : view === "income" ? "income" : undefined;

  const transactions = useLiveQuery(
    () => transactionsRepository.list(lockedKind ? { kind: lockedKind } : {}),
    [lockedKind],
  );

  const [accountId, setAccountId] = useState("");
  const [kind, setKind] = useState<TransactionKind>(lockedKind ?? "expense");
  const [date, setDate] = useState(todayIso());
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [engagementId, setEngagementId] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editAccountId, setEditAccountId] = useState("");
  const [editKind, setEditKind] = useState<TransactionKind>("expense");
  const [editDate, setEditDate] = useState("");
  const [editLabel, setEditLabel] = useState("");
  const [editAmount, setEditAmount] = useState("");
  const [editEngagementId, setEditEngagementId] = useState("");
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
  const engagements = useLiveQuery(() => engagementsRepository.list(), []);

  const accountNameById = new Map((accounts ?? []).map((a) => [a.id, a.name]));
  const subcategoryNameById = new Map(
    (budgetSummary ?? []).flatMap((c) => c.subcategories.map((s) => [s.subcategoryId, s.name])),
  );

  /** Options for the "which engagement does this expense settle" dropdown
   * — every engagement still available to settle (status "engagé"), plus
   * whichever one `alreadyLinkedId` currently points to even if its
   * status is already "réalisé" by this same transaction (otherwise
   * editing a settled expense without changing anything would show an
   * empty/invalid selection). */
  function settleableEngagements(alreadyLinkedId?: string) {
    return (engagements ?? []).filter((e) => e.status === "engaged" || e.id === alreadyLinkedId);
  }

  function engagementOptionLabel(e: { label: string; amount: number; subcategoryId: string }) {
    const subName = subcategoryNameById.get(e.subcategoryId);
    return `${e.label} — ${formatFcfa(e.amount)}${subName ? ` (${subName})` : ""}`;
  }

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
        ...(kind === "expense" ? { engagementId } : {}),
      });
      setLabel("");
      setAmount("");
      setEngagementId("");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : t("common.unexpectedError"));
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm(t("tx.confirmDelete"))) {
      return;
    }
    await transactionsRepository.remove(id);
  }

  function handleStartEdit(tx: {
    id: string;
    accountId: string;
    kind: TransactionKind;
    date: string;
    label: string;
    amount: number;
    engagementId?: string;
  }) {
    setRowError(null);
    setEditingId(tx.id);
    setEditAccountId(tx.accountId);
    setEditKind(tx.kind);
    setEditDate(tx.date);
    setEditLabel(tx.label);
    setEditAmount(String(tx.amount));
    setEditEngagementId(tx.engagementId ?? "");
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
        engagementId: editKind === "expense" ? editEngagementId || null : null,
      });
      setEditingId(null);
    } catch (error) {
      setRowError({
        id,
        message: error instanceof Error ? error.message : t("common.unexpectedError"),
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
      setTransferError(error instanceof Error ? error.message : t("common.unexpectedError"));
    }
  }

  async function handleDeleteTransfer(id: string) {
    if (!window.confirm(t("transfer.confirmDelete"))) {
      return;
    }
    setTransferRowError(null);
    try {
      await transfersRepository.remove(id);
    } catch (error) {
      setTransferRowError({
        id,
        message: error instanceof Error ? error.message : t("common.unexpectedError"),
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
        message: error instanceof Error ? error.message : t("common.unexpectedError"),
      });
    }
  }

  const hasAccounts = (accounts?.length ?? 0) > 0;
  const pageTitle =
    view === "transfers"
      ? t("tx.title.transfers")
      : view === "expense"
        ? t("tx.title.expenses")
        : view === "income"
          ? t("tx.title.income")
          : t("tx.title.operations");

  return (
    <section aria-labelledby="transactions-heading">
      <PageHeader title={pageTitle} section="operations" id="transactions-heading" />

      {(view === "operations" || view === "expense" || view === "income" || view === "both") &&
        (!canManage ? (
          <p className="permission-notice">{t("tx.noPermission")}</p>
        ) : !hasAccounts ? (
          <p className="empty">
            Créez d&apos;abord un compte pour pouvoir enregistrer une opération.
          </p>
        ) : (
          <form onSubmit={handleCreate} aria-label={t("tx.form.label")}>
            {!lockedKind && (
              <div className="field">
                <label htmlFor="tx-kind">{t("field.type")}</label>
                <select
                  id="tx-kind"
                  value={kind}
                  onChange={(e) => setKind(e.target.value as TransactionKind)}
                >
                  <option value="income">{t("field.kind.income")}</option>
                  <option value="expense">{t("field.kind.expense")}</option>
                </select>
              </div>
            )}
            {kind === "expense" &&
              (settleableEngagements().length > 0 ? (
                <div className="field">
                  <label htmlFor="tx-engagement">{t("tx.engagement")}</label>
                  <select
                    id="tx-engagement"
                    value={engagementId}
                    onChange={(e) => {
                      const id = e.target.value;
                      setEngagementId(id);
                      // Auto-fills Libellé from the engagement's own
                      // label — one less field to type for what's
                      // already the most common expense flow, and the
                      // engagement's own label is normally exactly what
                      // someone would have typed here anyway. Still
                      // freely editable afterward for a more specific
                      // wording on this one particular payment.
                      const chosen = settleableEngagements().find((e) => e.id === id);
                      if (chosen) setLabel(chosen.label);
                    }}
                  >
                    <option value="" disabled>
                      {t("common.choose")}
                    </option>
                    {settleableEngagements().map((e) => (
                      <option key={e.id} value={e.id}>
                        {engagementOptionLabel(e)}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <p className="tagline">{t("tx.engagement.none")}</p>
              ))}
            <div className="field">
              <label htmlFor="tx-date">{t("field.date")}</label>
              <input
                id="tx-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="tx-label">{t("field.label")}</label>
              <input id="tx-label" value={label} onChange={(e) => setLabel(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="tx-amount">{t("field.amountFcfa")}</label>
              <input
                id="tx-amount"
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="tx-account">{t("field.account")}</label>
              <select
                id="tx-account"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
              >
                <option value="" disabled>
                  {t("common.choose")}
                </option>
                {accounts?.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} — {formatFcfa(a.balance)}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit">{t("common.add")}</button>
            {formError && (
              <p role="alert" className="form-error">
                {formError}
              </p>
            )}
          </form>
        ))}

      {(view === "operations" || view === "expense" || view === "income" || view === "both") &&
        (transactions === undefined ? (
          <p>{t("common.loading")}</p>
        ) : transactions.length === 0 ? (
          <p className="empty">{t("tx.empty")}</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{t("field.date")}</th>
                  <th>{t("field.account")}</th>
                  <th>{t("field.label")}</th>
                  <th>{t("tx.col.engagement")}</th>
                  <th>{t("field.amount")}</th>
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
                        {editKind === "expense" && (
                          <select
                            aria-label={`Engagement de ${tx.label}`}
                            value={editEngagementId}
                            onChange={(e) => setEditEngagementId(e.target.value)}
                          >
                            <option value="" disabled>
                              {t("common.choose")}
                            </option>
                            {settleableEngagements(tx.engagementId).map((e) => (
                              <option key={e.id} value={e.id}>
                                {engagementOptionLabel(e)}
                              </option>
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
                      <td className="truncate">{tx.label}</td>
                      <td className="truncate">
                        {tx.subcategoryId
                          ? (subcategoryNameById.get(tx.subcategoryId) ?? "—")
                          : "—"}
                      </td>
                      <td className={`num ${tx.kind === "expense" ? "negative" : "positive"}`}>
                        {tx.kind === "expense" ? "-" : "+"}
                        {formatFcfa(tx.amount)}
                      </td>
                      <td>
                        {canManage && (
                          <span className="row-actions">
                            <button type="button" onClick={() => handleStartEdit(tx)}>
                              Modifier
                            </button>
                            <button type="button" onClick={() => handleDelete(tx.id)}>
                              Supprimer
                            </button>
                          </span>
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
        ))}

      {(view === "transfers" || view === "both") &&
        ((canManage && hasAccounts && (accounts?.length ?? 0) >= 2) ||
          (transfers?.length ?? 0) > 0) && (
          <section className="accent-gold" aria-labelledby="transfers-heading">
            <h3 id="transfers-heading">{t("transfer.heading")}</h3>
            {canManage && (accounts?.length ?? 0) >= 2 && (
              <>
                <form onSubmit={handleCreateTransfer} aria-label={t("transfer.form.label")}>
                  <div className="field">
                    <label htmlFor="transfer-from">{t("transfer.from")}</label>
                    <select
                      id="transfer-from"
                      value={transferFromId}
                      onChange={(e) => setTransferFromId(e.target.value)}
                    >
                      <option value="" disabled>
                        {t("common.choose")}
                      </option>
                      {accounts?.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name} — {formatFcfa(a.balance)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="transfer-to">{t("transfer.to")}</label>
                    <select
                      id="transfer-to"
                      value={transferToId}
                      onChange={(e) => setTransferToId(e.target.value)}
                    >
                      <option value="" disabled>
                        {t("common.choose")}
                      </option>
                      {accounts?.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name} — {formatFcfa(a.balance)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="transfer-amount">{t("field.amount")}</label>
                    <input
                      id="transfer-amount"
                      type="number"
                      value={transferAmount}
                      onChange={(e) => setTransferAmount(e.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="transfer-date">{t("field.date")}</label>
                    <input
                      id="transfer-date"
                      type="date"
                      value={transferDate}
                      onChange={(e) => setTransferDate(e.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="transfer-label">{t("transfer.labelOptional")}</label>
                    <input
                      id="transfer-label"
                      value={transferLabel}
                      onChange={(e) => setTransferLabel(e.target.value)}
                      placeholder={t("transfer.labelPlaceholder")}
                    />
                  </div>
                  <button type="submit">{t("common.add")}</button>
                  {transferError && (
                    <p role="alert" className="form-error">
                      {transferError}
                    </p>
                  )}
                </form>
              </>
            )}

            {(transfers?.length ?? 0) > 0 && (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>{t("field.date")}</th>
                      <th>{t("transfer.col.from")}</th>
                      <th>{t("transfer.col.to")}</th>
                      <th>{t("field.label")}</th>
                      <th>{t("field.amount")}</th>
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
                            <button
                              type="button"
                              onClick={() => handleSaveEditTransfer(transfer.id)}
                            >
                              Enregistrer
                            </button>{" "}
                            <button
                              type="button"
                              className="ghost"
                              onClick={handleCancelEditTransfer}
                            >
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
                          <td className="truncate">{transfer.label ?? "—"}</td>
                          <td className="num">{formatFcfa(transfer.amount)}</td>
                          <td>
                            {canManage && (
                              <span className="row-actions">
                                <button
                                  type="button"
                                  onClick={() => handleStartEditTransfer(transfer)}
                                >
                                  Modifier
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteTransfer(transfer.id)}
                                >
                                  Supprimer
                                </button>
                              </span>
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
            )}
          </section>
        )}
    </section>
  );
}
