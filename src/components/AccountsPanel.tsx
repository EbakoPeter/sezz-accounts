import { useState, type FormEvent } from "react";
import { accountsRepository } from "@/repositories";
import { useAccountsWithBalances } from "@/hooks/useAccountsWithBalances";
import { useAuth } from "@/auth/AuthContext";
import { useTranslation } from "@/i18n/LanguageContext";
import { formatFcfa } from "@/lib/money";
import { PageHeader } from "./PageHeader";

export function AccountsPanel({ view = "both" }: { view?: "new" | "list" | "both" }) {
  const accounts = useAccountsWithBalances();
  const totalBalance = (accounts ?? []).reduce((sum, a) => sum + a.balance, 0);
  const { currentUser } = useAuth();
  const { t } = useTranslation();
  const canManage = currentUser?.permissions.manageAccounts ?? false;
  const [name, setName] = useState("");
  const [initialBalance, setInitialBalance] = useState("0");
  const [formError, setFormError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editInitialBalance, setEditInitialBalance] = useState("0");

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    try {
      await accountsRepository.create({
        name,
        initialBalance: Number(initialBalance),
      });
      setName("");
      setInitialBalance("0");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : t("common.unexpectedError"));
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm(t("accounts.confirmDelete"))) {
      return;
    }
    setRowError(null);
    try {
      await accountsRepository.remove(id);
    } catch (error) {
      setRowError({
        id,
        message: error instanceof Error ? error.message : t("common.unexpectedError"),
      });
    }
  }

  function handleStartEdit(account: { id: string; name: string; initialBalance: number }) {
    setRowError(null);
    setEditingId(account.id);
    setEditName(account.name);
    setEditInitialBalance(String(account.initialBalance));
  }

  function handleCancelEdit() {
    setEditingId(null);
  }

  async function handleSaveEdit(id: string) {
    setRowError(null);
    try {
      await accountsRepository.update(id, {
        name: editName,
        initialBalance: Number(editInitialBalance),
      });
      setEditingId(null);
    } catch (error) {
      setRowError({
        id,
        message: error instanceof Error ? error.message : t("common.unexpectedError"),
      });
    }
  }

  const pageTitle =
    view === "new"
      ? t("accounts.new")
      : view === "list"
        ? t("accounts.listTitle")
        : t("accounts.title");

  return (
    <section aria-labelledby="accounts-heading">
      <PageHeader title={pageTitle} section="accounts" id="accounts-heading" />

      {(view === "new" || view === "both") &&
        (!canManage ? (
          <p className="permission-notice">{t("accounts.noPermission")}</p>
        ) : (
          <form onSubmit={handleCreate} aria-label={t("accounts.addForm")}>
            <div className="field">
              <label htmlFor="account-name">{t("accounts.form.name")}</label>
              <input
                id="account-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("accounts.form.namePlaceholder")}
              />
            </div>
            <div className="field">
              <label htmlFor="account-initial">{t("accounts.form.initialBalance")}</label>
              <input
                id="account-initial"
                type="number"
                value={initialBalance}
                onChange={(e) => setInitialBalance(e.target.value)}
              />
            </div>
            <button type="submit">{t("common.add")}</button>
            {formError && (
              <p role="alert" className="form-error">
                {formError}
              </p>
            )}
          </form>
        ))}

      {(view === "list" || view === "both") &&
        (accounts === undefined ? (
          <p>{t("common.loading")}</p>
        ) : accounts.length === 0 ? (
          <p className="empty">{t("accounts.empty")}</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{t("accounts.table.account")}</th>
                  <th>{t("accounts.form.initialBalance")}</th>
                  <th>{t("accounts.table.currentBalance")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {accounts.map((account) =>
                  editingId === account.id ? (
                    <tr key={account.id}>
                      <td>
                        <input
                          aria-label={t("accounts.aria.nameOf", { name: account.name })}
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          aria-label={t("accounts.aria.initialBalanceOf", { name: account.name })}
                          type="number"
                          value={editInitialBalance}
                          onChange={(e) => setEditInitialBalance(e.target.value)}
                        />
                      </td>
                      <td className={`num ${account.balance < 0 ? "negative" : ""}`}>
                        {formatFcfa(account.balance)}
                      </td>
                      <td>
                        <button type="button" onClick={() => handleSaveEdit(account.id)}>
                          {t("common.save")}
                        </button>{" "}
                        <button type="button" className="ghost" onClick={handleCancelEdit}>
                          {t("common.cancel")}
                        </button>
                        {rowError?.id === account.id && (
                          <p role="alert" className="form-error">
                            {rowError.message}
                          </p>
                        )}
                      </td>
                    </tr>
                  ) : (
                    <tr key={account.id}>
                      <td>{account.name}</td>
                      <td className="num">{formatFcfa(account.initialBalance)}</td>
                      <td className={`num ${account.balance < 0 ? "negative" : ""}`}>
                        {formatFcfa(account.balance)}
                      </td>
                      <td>
                        {canManage && (
                          <span className="row-actions">
                            <button type="button" onClick={() => handleStartEdit(account)}>
                              {t("common.edit")}
                            </button>
                            <button type="button" onClick={() => handleDelete(account.id)}>
                              {t("common.delete")}
                            </button>
                          </span>
                        )}
                        {rowError?.id === account.id && (
                          <p role="alert" className="form-error">
                            {rowError.message}
                          </p>
                        )}
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">{t("common.total")}</th>
                  <td />
                  <td className={`num ${totalBalance < 0 ? "negative" : ""}`}>
                    <strong>{formatFcfa(totalBalance)}</strong>
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        ))}
    </section>
  );
}
