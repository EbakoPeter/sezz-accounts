import { useState, type FormEvent } from "react";
import { accountsRepository } from "@/repositories";
import { useAccountsWithBalances } from "@/hooks/useAccountsWithBalances";
import { useAuth } from "@/auth/AuthContext";
import { formatFcfa } from "@/lib/money";

export function AccountsPanel() {
  const accounts = useAccountsWithBalances();
  const totalBalance = (accounts ?? []).reduce((sum, a) => sum + a.balance, 0);
  const { currentUser } = useAuth();
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
      setFormError(error instanceof Error ? error.message : "Erreur inattendue.");
    }
  }

  async function handleDelete(id: string) {
    if (
      !window.confirm("Voulez-vous vraiment supprimer ce compte ? Cette action est irréversible.")
    ) {
      return;
    }
    setRowError(null);
    try {
      await accountsRepository.remove(id);
    } catch (error) {
      setRowError({
        id,
        message: error instanceof Error ? error.message : "Erreur inattendue.",
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
        message: error instanceof Error ? error.message : "Erreur inattendue.",
      });
    }
  }

  return (
    <section aria-labelledby="accounts-heading">
      <h2 id="accounts-heading">Comptes</h2>

      {!canManage ? (
        <p className="permission-notice">
          Vous n&apos;avez pas la permission de créer ou modifier des comptes.
        </p>
      ) : (
        <form onSubmit={handleCreate} aria-label="Ajouter un compte">
          <div className="field">
            <label htmlFor="account-name">Nom du compte</label>
            <input
              id="account-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex : Compte Principal"
            />
          </div>
          <div className="field">
            <label htmlFor="account-initial">Solde initial</label>
            <input
              id="account-initial"
              type="number"
              value={initialBalance}
              onChange={(e) => setInitialBalance(e.target.value)}
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

      {accounts === undefined ? (
        <p>Chargement…</p>
      ) : accounts.length === 0 ? (
        <p className="empty">Aucun compte pour le moment.</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Compte</th>
                <th>Solde initial</th>
                <th>Solde actuel</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) =>
                editingId === account.id ? (
                  <tr key={account.id}>
                    <td>
                      <input
                        aria-label={`Nom de ${account.name}`}
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        aria-label={`Solde initial de ${account.name}`}
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
                        Enregistrer
                      </button>{" "}
                      <button type="button" className="ghost" onClick={handleCancelEdit}>
                        Annuler
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
                            Modifier
                          </button>
                          <button type="button" onClick={() => handleDelete(account.id)}>
                            Supprimer
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
                <th scope="row">Total</th>
                <td />
                <td className={`num ${totalBalance < 0 ? "negative" : ""}`}>
                  <strong>{formatFcfa(totalBalance)}</strong>
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}
