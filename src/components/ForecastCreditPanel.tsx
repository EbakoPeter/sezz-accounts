import { useState, type FormEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useAuth } from "@/auth/AuthContext";
import { formatFcfa } from "@/lib/money";
import { creditForecastAccount, FORECAST_ACCOUNT_NAME } from "@/db/forecastAccount";
import { createAccountsRepository } from "@/db/accountsRepository";
import { createTransactionsRepository } from "@/db/transactionsRepository";
import { PageHeader } from "./PageHeader";

const accountsRepository = createAccountsRepository();
const transactionsRepository = createTransactionsRepository();

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * "Crédit Prév (CP)" — a deliberately minimal form (source, montant,
 * date only, none of the account/kind/engagement choices a regular
 * operation asks for) that credits a single, auto-provisioned forecast
 * account (see forecastAccount.ts) rather than any account the person
 * picks. The account itself is entirely ordinary once created — visible
 * in Comptes, counted in Accueil's balance — the only special thing
 * about it is that this form exists as a fast, three-field path to
 * crediting it specifically.
 *
 * The account is only ever actually created at submit time (inside
 * creditForecastAccount) — never merely by viewing this panel. The
 * history section below looks it up reactively by name instead of
 * assuming it exists yet: with nothing credited so far, there's nothing
 * to show either way, so there's nothing to gain by creating it earlier
 * than the moment it's first genuinely needed.
 */
export function ForecastCreditPanel() {
  const { currentUser } = useAuth();
  const canManage = currentUser?.permissions.manageTransactions ?? false;

  const credits = useLiveQuery(async () => {
    const accounts = await accountsRepository.list();
    const forecastAccount = accounts.find((a) => a.name === FORECAST_ACCOUNT_NAME);
    if (!forecastAccount) return [];
    // Uses the accountId index rather than decrypting every transaction
    // in the database just to filter down to this one account's own —
    // the same query transactionsRepository.list() already exposes for
    // exactly this purpose.
    const own = await transactionsRepository.list({ accountId: forecastAccount.id });
    return own.sort((a, b) => b.date.localeCompare(a.date));
  }, []);

  const [source, setSource] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayIso());
  const [formError, setFormError] = useState<string | null>(null);

  async function handleCredit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    try {
      await creditForecastAccount({ source, amount: Number(amount), date });
      setSource("");
      setAmount("");
      setDate(todayIso());
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Erreur inattendue.");
    }
  }

  return (
    <section aria-labelledby="forecast-credit-heading">
      <PageHeader title="Crédit Prév (CP)" section="operations" id="forecast-credit-heading" />
      <p className="tagline">
        Enregistre une entrée d&apos;argent prévisionnelle — source, montant et date — créditée
        automatiquement sur le compte prévisionnel, sans avoir à choisir un compte à chaque fois.
      </p>

      {!canManage ? (
        <p className="permission-notice">
          Vous n&apos;avez pas la permission d&apos;enregistrer des opérations.
        </p>
      ) : (
        <form onSubmit={handleCredit} aria-label="Créditer le compte prévisionnel">
          <div className="field">
            <label htmlFor="cp-source">Source</label>
            <input
              id="cp-source"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="Salaire, vente, remboursement…"
            />
          </div>
          <div className="field">
            <label htmlFor="cp-amount">Montant (FCFA)</label>
            <input
              id="cp-amount"
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="cp-date">Date</label>
            <input
              id="cp-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <button type="submit">+ Créditer</button>
          {formError && (
            <p role="alert" className="form-error">
              {formError}
            </p>
          )}
        </form>
      )}

      <h3>Historique des crédits prévisionnels</h3>
      {credits === undefined ? (
        <p>Chargement…</p>
      ) : credits.length === 0 ? (
        <p className="empty">Aucun crédit prévisionnel enregistré pour le moment.</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Source</th>
                <th className="num">Montant</th>
              </tr>
            </thead>
            <tbody>
              {credits.map((credit) => (
                <tr key={credit.id}>
                  <td>{credit.date}</td>
                  <td className="truncate">{credit.label}</td>
                  <td className="num">{formatFcfa(credit.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
