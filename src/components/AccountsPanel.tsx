import { useState, type FormEvent } from "react";
import { accountsRepository } from "@/repositories";
import { useAccountsWithBalances } from "@/hooks/useAccountsWithBalances";
import { formatFcfa } from "@/lib/money";

export function AccountsPanel() {
  const accounts = useAccountsWithBalances();
  const [name, setName] = useState("");
  const [initialBalance, setInitialBalance] = useState("0");
  const [formError, setFormError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);

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

  return (
    <section aria-labelledby="accounts-heading">
      <h2 id="accounts-heading">Comptes</h2>

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

      {accounts === undefined ? (
        <p>Chargement…</p>
      ) : accounts.length === 0 ? (
        <p className="empty">Aucun compte pour le moment.</p>
      ) : (
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
            {accounts.map((account) => (
              <tr key={account.id}>
                <td>{account.name}</td>
                <td className="num">{formatFcfa(account.initialBalance)}</td>
                <td className={`num ${account.balance < 0 ? "negative" : ""}`}>
                  {formatFcfa(account.balance)}
                </td>
                <td>
                  <button type="button" onClick={() => handleDelete(account.id)}>
                    Supprimer
                  </button>
                  {rowError?.id === account.id && (
                    <p role="alert" className="form-error">
                      {rowError.message}
                    </p>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
