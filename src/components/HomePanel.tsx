import { useState, type FormEvent } from "react";
import { useAuth } from "@/auth/AuthContext";
import { useAccountsWithBalances } from "@/hooks/useAccountsWithBalances";
import { useBudgetSummary } from "@/hooks/useBudgetSummary";
import { useRecommendations } from "@/hooks/useRecommendations";
import { useMonthlyReport } from "@/hooks/useMonthlyReport";
import { formatFcfa } from "@/lib/money";
import { MonthlyBarChart } from "./MonthlyReportPanel";
import { PageHeader } from "./PageHeader";
import { usersRepository } from "@/repositories";
import type { InsightSeverity } from "@/db/recommendations";

const SEVERITY_STYLE: Record<
  InsightSeverity,
  { background: string; border: string; label: string }
> = {
  success: { background: "#E1EBE4", border: "#3D6B52", label: "✓" },
  info: { background: "#F3E9D3", border: "#B8923F", label: "ℹ" },
  warning: { background: "#F5E3E1", border: "#B23A34", label: "⚠" },
};

/** A rotating palette for pies with more slices than a fixed semantic
 * color can cover (accounts, whose number and identity aren't known
 * ahead of time) — the two-slice pies below (income/expense,
 * spent/remaining) use fixed, meaningful colors instead, matching the
 * green/red convention already used everywhere else in the app. */
const PALETTE = ["#0D1B2A", "#B8923F", "#3D6B52", "#B23A34", "#5A5340", "#5F5330"];

function point(cx: number, cy: number, radius: number, angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + radius * Math.sin(rad), y: cy - radius * Math.cos(rad) };
}

interface PieSlice {
  label: string;
  value: number;
  color: string;
}

/** A generic pie — any number of non-negative slices, drawn clockwise
 * from the top (the conventional orientation). Every statistic on this
 * dashboard is expressed through this same component, rather than each
 * picking its own chart type, per the request that each one reads as a
 * pie specifically. Slices with a value of 0 (or negative — a pie can't
 * meaningfully represent a negative share of a whole) are simply
 * skipped rather than drawn as nothing. */
function PieChart({
  slices,
  ariaLabel,
  emptyMessage,
}: {
  slices: PieSlice[];
  ariaLabel: string;
  emptyMessage: string;
}) {
  const positiveSlices = slices.filter((s) => s.value > 0);
  const total = positiveSlices.reduce((sum, s) => sum + s.value, 0);
  const size = 200;
  const cx = size / 2;
  const cy = size / 2;
  const radius = 80;

  if (total <= 0) {
    return <p className="empty">{emptyMessage}</p>;
  }

  let cumulativeAngle = 0;
  const arcs = positiveSlices.map((slice) => {
    const sliceAngle = (slice.value / total) * 360;
    const startAngle = cumulativeAngle;
    const endAngle = cumulativeAngle + sliceAngle;
    cumulativeAngle = endAngle;
    const start = point(cx, cy, radius, startAngle);
    const end = point(cx, cy, radius, endAngle);
    const largeArc = sliceAngle > 180 ? 1 : 0;
    return {
      path: `M ${cx},${cy} L ${start.x},${start.y} A ${radius},${radius} 0 ${largeArc},1 ${end.x},${end.y} Z`,
      color: slice.color,
    };
  });

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={ariaLabel}
      style={{ width: "100%", maxWidth: 200, height: "auto" }}
    >
      {arcs.map((arc, i) => (
        // a fixed set of slices computed fresh every render from the same
        // underlying data — index is a stable, meaningful key here, same
        // as the fixed 12-month bar chart elsewhere in this app
        <path key={i} d={arc.path} fill={arc.color} />
      ))}
    </svg>
  );
}

function PieLegend({ slices }: { slices: PieSlice[] }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px", fontSize: ".78rem" }}>
      {slices.map((slice) => (
        <span key={slice.label}>
          <span
            style={{
              display: "inline-block",
              width: 10,
              height: 10,
              background: slice.color,
              borderRadius: 2,
              marginRight: 5,
            }}
          />
          {slice.label} — {formatFcfa(slice.value)}
        </span>
      ))}
    </div>
  );
}

export function HomePanel() {
  const { currentUser } = useAuth();
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  const [situationRevealed, setSituationRevealed] = useState(false);
  const [showPasswordPrompt, setShowPasswordPrompt] = useState(false);
  const [situationPassword, setSituationPassword] = useState("");
  const [situationError, setSituationError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [throttledUntil, setThrottledUntil] = useState<number | null>(null);

  // A light, local-only throttle -- not the shared account lockout
  // authenticate() uses, and deliberately so: this only ever gates
  // re-displaying an already-decrypted summary for the person already
  // signed in as this exact user, not a real login, so treating repeated
  // wrong guesses here as a lockout-worthy event would risk locking
  // someone out of the whole app over mistyping a password while trying
  // to peek at a dashboard card. Resets whenever the page reloads, since
  // this state was never meant to persist across sessions in the first
  // place.
  const isThrottled = throttledUntil !== null && Date.now() < throttledUntil;

  async function handleRevealSituation(event: FormEvent) {
    event.preventDefault();
    setSituationError(null);
    if (isThrottled) return;
    setVerifying(true);
    try {
      if (!currentUser) return;
      const isValid = await usersRepository.verifyOwnPassword(currentUser.id, situationPassword);
      if (isValid) {
        setSituationRevealed(true);
        setShowPasswordPrompt(false);
        setSituationPassword("");
        setFailedAttempts(0);
        setThrottledUntil(null);
      } else {
        const attempts = failedAttempts + 1;
        setFailedAttempts(attempts);
        if (attempts >= 5) {
          setThrottledUntil(Date.now() + 30_000);
          setSituationError("Trop de tentatives. Réessayez dans 30 secondes.");
        } else {
          setSituationError("Mot de passe incorrect.");
        }
      }
    } finally {
      setVerifying(false);
    }
  }

  const accounts = useAccountsWithBalances();
  const budgetSummary = useBudgetSummary(year, month);
  const insights = useRecommendations(year, month);
  const monthlyRows = useMonthlyReport(year);

  const totalBalance = (accounts ?? []).reduce((sum, a) => sum + a.balance, 0);
  const currentMonthRow = monthlyRows?.find((r) => r.month === month);
  const currentIncome = currentMonthRow?.income ?? 0;
  const currentExpense = currentMonthRow?.expense ?? 0;

  const balanceSlices: PieSlice[] = (accounts ?? []).map((account, i) => ({
    label: account.name,
    value: account.balance,
    color: PALETTE[i % PALETTE.length]!,
  }));

  const provisionedLines = (budgetSummary ?? []).flatMap((c) =>
    c.subcategories.filter((s) => s.percentUsed !== null),
  );
  const totalAllocated = provisionedLines.reduce((sum, s) => sum + s.monthlyAllocation, 0);
  const totalSpent = provisionedLines.reduce((sum, s) => sum + s.actual, 0);
  const budgetSlices: PieSlice[] = [
    { label: "Dépensé", value: Math.min(totalSpent, totalAllocated), color: "#B23A34" },
    { label: "Restant", value: Math.max(0, totalAllocated - totalSpent), color: "#3D6B52" },
  ];
  const overrun = totalSpent - totalAllocated;

  return (
    <section aria-labelledby="home-heading">
      <PageHeader
        title={`Bienvenue, ${currentUser?.displayName ?? ""} !`}
        section="home"
        id="home-heading"
      />
      <p className="tagline">
        Vue d&apos;ensemble de votre situation, au {now.toLocaleDateString("fr-FR")}.
      </p>

      <div className="dashboard-grid">
        <section className="accent-ink" aria-labelledby="home-situation-heading">
          <h3 id="home-situation-heading">Situation financière</h3>
          {!situationRevealed ? (
            <>
              <p className="tagline">
                Masquée par défaut — utile si quelqu&apos;un d&apos;autre peut voir cet écran.
              </p>
              {!showPasswordPrompt ? (
                <button type="button" onClick={() => setShowPasswordPrompt(true)}>
                  Afficher
                </button>
              ) : (
                <form
                  onSubmit={handleRevealSituation}
                  aria-label="Afficher la situation financière"
                >
                  <div className="field">
                    <label htmlFor="situation-password">Votre mot de passe</label>
                    <input
                      type="password"
                      id="situation-password"
                      value={situationPassword}
                      onChange={(e) => setSituationPassword(e.target.value)}
                      autoFocus
                    />
                  </div>
                  <button type="submit" disabled={verifying || isThrottled}>
                    {verifying ? "Vérification…" : "Confirmer"}
                  </button>{" "}
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => {
                      setShowPasswordPrompt(false);
                      setSituationPassword("");
                      setSituationError(null);
                    }}
                  >
                    Annuler
                  </button>
                  {situationError && (
                    <p role="alert" className="form-error">
                      {situationError}
                    </p>
                  )}
                </form>
              )}
            </>
          ) : accounts === undefined ? (
            <p>Chargement…</p>
          ) : (
            <>
              <button type="button" className="ghost" onClick={() => setSituationRevealed(false)}>
                Masquer à nouveau
              </button>
              <PieChart
                slices={balanceSlices}
                ariaLabel="Répartition du solde par compte"
                emptyMessage="Aucun compte avec un solde positif à répartir."
              />
              <PieLegend slices={balanceSlices} />
              <p>
                Solde cumulé de tous les comptes :{" "}
                <strong className={totalBalance < 0 ? "negative" : ""}>
                  {formatFcfa(totalBalance)}
                </strong>{" "}
                <span className="empty">({accounts.length} compte(s))</span>
              </p>
            </>
          )}
        </section>

        {currentUser?.permissions.viewReports && (
          <>
            <section className="accent-gold" aria-labelledby="home-pie-heading">
              <h3 id="home-pie-heading">Entrées et sorties du mois</h3>
              {monthlyRows === undefined ? (
                <p>Chargement…</p>
              ) : (
                <>
                  <PieChart
                    slices={[
                      { label: "Entrées", value: currentIncome, color: "#3D6B52" },
                      { label: "Sorties", value: currentExpense, color: "#B23A34" },
                    ]}
                    ariaLabel={`Répartition entrées/sorties du mois : ${formatFcfa(currentIncome)} d'entrées, ${formatFcfa(currentExpense)} de sorties`}
                    emptyMessage="Aucune opération ce mois-ci."
                  />
                  <PieLegend
                    slices={[
                      { label: "Entrées", value: currentIncome, color: "#3D6B52" },
                      { label: "Sorties", value: currentExpense, color: "#B23A34" },
                    ]}
                  />
                </>
              )}
            </section>

            <section className="accent-sage" aria-labelledby="home-budget-heading">
              <h3 id="home-budget-heading">Exécution du budget (mois en cours)</h3>
              {budgetSummary === undefined ? (
                <p>Chargement…</p>
              ) : (
                <>
                  <PieChart
                    slices={budgetSlices}
                    ariaLabel="Répartition dépensé/restant du budget du mois"
                    emptyMessage="Aucune ligne budgétaire provisionnée pour le moment."
                  />
                  <PieLegend slices={budgetSlices} />
                  {overrun > 0 && (
                    <p className="negative">Dépassement global : {formatFcfa(overrun)}</p>
                  )}
                </>
              )}
            </section>
          </>
        )}
      </div>

      {currentUser?.permissions.viewReports && (
        <>
          <section aria-labelledby="home-operations-heading">
            <h3 id="home-operations-heading">Opérations sur l&apos;année</h3>
            {monthlyRows === undefined ? (
              <p>Chargement…</p>
            ) : (
              <MonthlyBarChart rows={monthlyRows} />
            )}
          </section>

          <section className="accent-ink" aria-labelledby="home-recommendations-heading">
            <h3 id="home-recommendations-heading">Recommandations</h3>
            {insights === undefined ? (
              <p>Chargement…</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {insights.slice(0, 3).map((insight) => {
                  const style = SEVERITY_STYLE[insight.severity];
                  return (
                    <div
                      key={insight.id}
                      className="rec-card"
                      data-severity={insight.severity}
                      style={{
                        background: style.background,
                        borderLeft: `4px solid ${style.border}`,
                        borderRadius: 6,
                        padding: "10px 14px",
                      }}
                    >
                      <strong>
                        {style.label} {insight.title}
                      </strong>
                      <p style={{ margin: "4px 0 0", fontSize: ".85rem" }}>{insight.message}</p>
                    </div>
                  );
                })}
                {insights.length > 3 && (
                  <p className="empty">
                    +{insights.length - 3} autre(s) — voir l&apos;onglet Recommandations.
                  </p>
                )}
              </div>
            )}
          </section>
        </>
      )}

      <section className="ad-slot" aria-label="Espace publicitaire">
        <span className="ad-slot-label">Emplacement publicitaire</span>
      </section>

      <section aria-labelledby="home-video-heading">
        <h3 id="home-video-heading">Découvrir SEZZ</h3>
        <div className="video-slot">
          <p className="video-slot-icon" aria-hidden="true">
            ▶
          </p>
          <p className="tagline">Vidéo de présentation — bientôt disponible ici.</p>
        </div>
      </section>
    </section>
  );
}
