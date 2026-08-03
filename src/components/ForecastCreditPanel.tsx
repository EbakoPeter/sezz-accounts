import { useState, type FormEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useAuth } from "@/auth/AuthContext";
import { useTranslation } from "@/i18n/LanguageContext";
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
  const { t } = useTranslation();
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
      setFormError(error instanceof Error ? error.message : t("common.unexpectedError"));
    }
  }

  return (
    <section aria-labelledby="forecast-credit-heading">
      <PageHeader title={t("forecast.title")} section="operations" id="forecast-credit-heading" />
      <p className="tagline">{t("forecast.tagline")}</p>

      {!canManage ? (
        <p className="permission-notice">{t("forecast.noPermission")}</p>
      ) : (
        <form onSubmit={handleCredit} aria-label={t("forecast.form")}>
          <div className="field">
            <label htmlFor="cp-source">{t("forecast.form.source")}</label>
            <input
              id="cp-source"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder={t("forecast.form.sourcePlaceholder")}
            />
          </div>
          <div className="field">
            <label htmlFor="cp-amount">{t("forecast.form.amount")}</label>
            <input
              id="cp-amount"
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="cp-date">{t("forecast.form.date")}</label>
            <input
              id="cp-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <button type="submit">{t("forecast.submit")}</button>
          {formError && (
            <p role="alert" className="form-error">
              {formError}
            </p>
          )}
        </form>
      )}

      <h3>{t("forecast.historyTitle")}</h3>
      {credits === undefined ? (
        <p>{t("common.loading")}</p>
      ) : credits.length === 0 ? (
        <p className="empty">{t("forecast.empty")}</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>{t("forecast.table.date")}</th>
                <th>{t("forecast.table.source")}</th>
                <th className="num">{t("forecast.table.amount")}</th>
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
