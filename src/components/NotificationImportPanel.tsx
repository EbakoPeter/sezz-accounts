import { useState, useMemo, type FormEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { PageHeader } from "@/components/PageHeader";
import { useAccountsWithBalances } from "@/hooks/useAccountsWithBalances";
import { transactionsRepository, engagementsRepository } from "@/repositories";
import { parseNotification, type ParsedNotification } from "@/lib/notificationParser";
import { formatFcfa } from "@/lib/money";
import type { TransactionKind, Engagement } from "@/types/models";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * The "Option B" confirmation flow: nothing a notification says is ever
 * written to an account automatically. A notification's text is parsed
 * into a draft, shown here for review — the person resolves anything the
 * parser flagged (an Orange Money transfer's direction, above all),
 * picks which local account it belongs to, and only an explicit tap
 * creates the transaction. Until then, no money has moved in NKaP.
 */
export function NotificationImportPanel() {
  const accounts = useAccountsWithBalances();
  const engagements = useLiveQuery(() => engagementsRepository.list(), []);

  const [rawText, setRawText] = useState("");
  const [ownNumber, setOwnNumber] = useState("");
  const [parsed, setParsed] = useState<ParsedNotification | undefined>();
  const [notRecognized, setNotRecognized] = useState(false);

  // Editable draft fields, seeded from the parse but freely correctable.
  const [accountId, setAccountId] = useState("");
  const [direction, setDirection] = useState<TransactionKind>("expense");
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [engagementId, setEngagementId] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleParse(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setConfirmed(false);
    const result = parseNotification(rawText, ownNumber.trim() || undefined);
    if (!result) {
      setNotRecognized(true);
      setParsed(undefined);
      return;
    }
    setNotRecognized(false);
    setParsed(result);
    // Seed the editable draft. Direction defaults to expense only when
    // the parser genuinely couldn't tell (unknown) — never a silent
    // guess that gets recorded, since the person still has to pick and
    // confirm below before anything is created.
    setDirection(result.direction === "unknown" ? "expense" : result.direction);
    setLabel(result.label);
    setAmount(String(result.amount));
    setEngagementId("");
    setAccountId("");
  }

  const settleableEngagements = useMemo(
    () => (engagements ?? []).filter((e: Engagement) => e.status === "engaged"),
    [engagements],
  );

  // Balance reconciliation: compare what the provider says the balance is
  // now against what NKaP would compute for the chosen account *after*
  // this transaction. A mismatch means transactions were likely missed
  // (made while the phone was off, or before NKaP was installed) — surfaced
  // as a warning to investigate, never silently "fixed", so the real
  // missing transaction gets found rather than masked by an adjustment.
  const discrepancy = useMemo(() => {
    if (!parsed?.reportedBalance || !accountId || !accounts) return undefined;
    const account = accounts.find((a) => a.id === accountId);
    if (!account) return undefined;
    const amt = Number(amount);
    if (!Number.isFinite(amt)) return undefined;
    const projected = account.balance + (direction === "income" ? amt : -amt);
    const diff = parsed.reportedBalance - projected;
    if (Math.abs(diff) < 1) return undefined;
    return { projected, reported: parsed.reportedBalance, diff };
  }, [parsed, accountId, accounts, amount, direction]);

  async function handleConfirm(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setError("Le montant doit être un nombre positif.");
      return;
    }
    if (!accountId) {
      setError("Choisissez le compte concerné.");
      return;
    }
    if (direction === "expense" && !engagementId) {
      setError("Une dépense doit être reliée à un engagement (Dépenses à Faire).");
      return;
    }
    try {
      await transactionsRepository.create({
        accountId,
        kind: direction,
        date: todayIso(),
        label,
        amount: amt,
        ...(direction === "expense" ? { engagementId } : {}),
        ...(parsed?.reference ? { note: `Réf: ${parsed.reference}` } : {}),
      });
      setConfirmed(true);
      setParsed(undefined);
      setRawText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inattendue.");
    }
  }

  const sourceLabel: Record<string, string> = {
    bank: "Banque",
    "mtn-momo": "MTN MoMo",
    "orange-money": "Orange Money",
  };

  return (
    <section aria-labelledby="notif-import-heading">
      <PageHeader
        title="Import depuis notification"
        section="operations"
        id="notif-import-heading"
      />
      <p className="tagline">
        Collez le texte d&apos;une notification (banque, MTN MoMo, Orange Money). NKaP en extrait
        une opération que vous vérifiez et confirmez — rien n&apos;est enregistré automatiquement.
      </p>

      <form
        onSubmit={handleParse}
        aria-label="Analyser une notification"
        className="budget-entry-section"
      >
        <div className="field">
          <label htmlFor="notif-text">Texte de la notification</label>
          <textarea
            id="notif-text"
            rows={4}
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="notif-own-number">
            Votre numéro Mobile Money (optionnel — aide à déterminer le sens d&apos;un transfert
            Orange Money)
          </label>
          <input
            id="notif-own-number"
            value={ownNumber}
            onChange={(e) => setOwnNumber(e.target.value)}
            placeholder="6XXXXXXXX"
          />
        </div>
        <button type="submit">Analyser</button>
      </form>

      {confirmed && (
        <p role="status" className="form-success">
          Opération enregistrée. Vous pouvez coller une autre notification.
        </p>
      )}

      {notRecognized && (
        <p role="alert" className="form-error">
          Format non reconnu. Vous pouvez saisir cette opération manuellement dans l&apos;onglet
          Dépenses ou Revenus.
        </p>
      )}

      {parsed && (
        <form
          onSubmit={handleConfirm}
          aria-label="Confirmer l'opération"
          className="dashboard-grid"
        >
          <section className="accent-ink">
            <h3>Opération détectée — {sourceLabel[parsed.source]}</h3>

            {parsed.needsReview && (
              <p role="alert" className="form-error">
                Le sens de cette opération n&apos;a pas pu être déterminé automatiquement. Vérifiez
                s&apos;il s&apos;agit d&apos;une entrée ou d&apos;une sortie avant de confirmer.
              </p>
            )}

            <div className="field">
              <label htmlFor="confirm-direction">Sens</label>
              <select
                id="confirm-direction"
                value={direction}
                onChange={(e) => setDirection(e.target.value as TransactionKind)}
              >
                <option value="expense">Sortie (dépense)</option>
                <option value="income">Entrée (revenu)</option>
              </select>
            </div>

            <div className="field">
              <label htmlFor="confirm-amount">Montant (FCFA)</label>
              <input
                id="confirm-amount"
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>

            <div className="field">
              <label htmlFor="confirm-label">Libellé</label>
              <input id="confirm-label" value={label} onChange={(e) => setLabel(e.target.value)} />
            </div>

            <div className="field">
              <label htmlFor="confirm-account">Compte concerné</label>
              <select
                id="confirm-account"
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

            {direction === "expense" && (
              <div className="field">
                <label htmlFor="confirm-engagement">Dépenses à Faire</label>
                <select
                  id="confirm-engagement"
                  value={engagementId}
                  onChange={(e) => setEngagementId(e.target.value)}
                >
                  <option value="" disabled>
                    Choisir…
                  </option>
                  {settleableEngagements.map((e: Engagement) => (
                    <option key={e.id} value={e.id}>
                      {e.label} — {formatFcfa(e.amount)}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {parsed.reportedBalance !== undefined && (
              <p className="computed">
                Solde annoncé par l&apos;opérateur : {formatFcfa(parsed.reportedBalance)}
              </p>
            )}

            {discrepancy && (
              <p role="alert" className="form-error">
                Écart détecté : après cette opération, NKaP calcule{" "}
                {formatFcfa(discrepancy.projected)}, mais l&apos;opérateur annonce{" "}
                {formatFcfa(discrepancy.reported)} (différence de {formatFcfa(discrepancy.diff)}).
                Des opérations ont peut-être été manquées — vérifiez avant de confirmer.
              </p>
            )}

            <button type="submit">Confirmer et enregistrer</button>
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
          </section>
        </form>
      )}
    </section>
  );
}
