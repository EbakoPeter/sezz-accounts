import { useAuth } from "@/auth/AuthContext";
import { useAccountsWithBalances } from "@/hooks/useAccountsWithBalances";
import { useBudgetSummary } from "@/hooks/useBudgetSummary";
import { useRecommendations } from "@/hooks/useRecommendations";
import { useMonthlyReport } from "@/hooks/useMonthlyReport";
import { formatFcfa } from "@/lib/money";
import { MonthlyBarChart } from "./MonthlyReportPanel";
import type { InsightSeverity } from "@/db/recommendations";

const SEVERITY_STYLE: Record<
  InsightSeverity,
  { background: string; border: string; label: string }
> = {
  success: { background: "#E4EEE6", border: "#4C7A5B", label: "✓" },
  info: { background: "#FBEFD8", border: "#C98A3B", label: "ℹ" },
  warning: { background: "#F5E3E1", border: "#B23A34", label: "⚠" },
};

function point(cx: number, cy: number, radius: number, angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + radius * Math.sin(rad), y: cy - radius * Math.cos(rad) };
}

/** A two-slice pie (income/expense) — deliberately not a generic n-slice
 * component, since this dashboard only ever needs these two values. Draws
 * clockwise from the top, the conventional orientation for this kind of
 * chart. */
function IncomeExpensePie({ income, expense }: { income: number; expense: number }) {
  const total = income + expense;
  const size = 200;
  const cx = size / 2;
  const cy = size / 2;
  const radius = 80;

  if (total <= 0) {
    return <p className="empty">Aucune opération ce mois-ci.</p>;
  }

  const incomeAngle = (income / total) * 360;
  const start = point(cx, cy, radius, 0);
  const mid = point(cx, cy, radius, incomeAngle);
  const end = point(cx, cy, radius, 360);
  const incomeLargeArc = incomeAngle > 180 ? 1 : 0;
  const expenseLargeArc = 360 - incomeAngle > 180 ? 1 : 0;

  const incomePath = `M ${cx},${cy} L ${start.x},${start.y} A ${radius},${radius} 0 ${incomeLargeArc},1 ${mid.x},${mid.y} Z`;
  const expensePath = `M ${cx},${cy} L ${mid.x},${mid.y} A ${radius},${radius} 0 ${expenseLargeArc},1 ${end.x},${end.y} Z`;

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={`Répartition entrées/sorties du mois : ${formatFcfa(income)} d'entrées, ${formatFcfa(expense)} de sorties`}
      style={{ width: "100%", maxWidth: 220, height: "auto" }}
    >
      {income > 0 && <path d={incomePath} fill="#4C7A5B" />}
      {expense > 0 && <path d={expensePath} fill="#B23A34" />}
    </svg>
  );
}

/** One horizontal bar per subcategory — % of allocation actually used
 * (real spending only, matching the same "engagements don't count toward
 * this percentage" rule budgetSummary itself already applies). Capped
 * visually at 100% width even when a line runs over, with the bar itself
 * turning the same red used everywhere else in the app for a negative/
 * over-budget figure — the number alongside it still shows the real
 * percentage, uncapped. */
function BudgetExecutionBars({
  categories,
}: {
  categories: { name: string; subcategories: { name: string; percentUsed: number | null }[] }[];
}) {
  const rows = categories.flatMap((c) =>
    c.subcategories
      .filter((s) => s.percentUsed !== null)
      .map((s) => ({ label: `${c.name} — ${s.name}`, percentUsed: s.percentUsed! })),
  );

  if (rows.length === 0) {
    return <p className="empty">Aucune ligne budgétaire provisionnée pour le moment.</p>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {rows.map((row) => (
        <div key={row.label}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: ".8rem" }}>
            <span>{row.label}</span>
            <span>{Math.round(row.percentUsed)}%</span>
          </div>
          <div style={{ background: "#EFE7D3", borderRadius: 4, height: 8, overflow: "hidden" }}>
            <div
              style={{
                width: `${Math.min(100, Math.max(0, row.percentUsed))}%`,
                height: "100%",
                background: row.percentUsed > 100 ? "#B23A34" : "#4C7A5B",
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export function HomePanel() {
  const { currentUser } = useAuth();
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  const accounts = useAccountsWithBalances();
  const budgetSummary = useBudgetSummary(year, month);
  const insights = useRecommendations(year, month);
  const monthlyRows = useMonthlyReport(year);

  const totalBalance = (accounts ?? []).reduce((sum, a) => sum + a.balance, 0);
  const currentMonthRow = monthlyRows?.find((r) => r.month === month);
  const currentIncome = currentMonthRow?.income ?? 0;
  const currentExpense = currentMonthRow?.expense ?? 0;

  return (
    <section aria-labelledby="home-heading">
      <h2 id="home-heading">Accueil</h2>
      <p className="tagline">
        Vue d&apos;ensemble de votre situation, au {now.toLocaleDateString("fr-FR")}.
      </p>

      <section className="accent-ink" aria-labelledby="home-situation-heading">
        <h3 id="home-situation-heading">Situation financière</h3>
        {accounts === undefined ? (
          <p>Chargement…</p>
        ) : (
          <p>
            Solde cumulé de tous les comptes :{" "}
            <strong className={totalBalance < 0 ? "negative" : ""}>
              {formatFcfa(totalBalance)}
            </strong>{" "}
            <span className="empty">({accounts.length} compte(s))</span>
          </p>
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
                <IncomeExpensePie income={currentIncome} expense={currentExpense} />
                <div style={{ display: "flex", gap: 18, fontSize: ".78rem", color: "#726B5E" }}>
                  <span>
                    <span
                      style={{
                        display: "inline-block",
                        width: 10,
                        height: 10,
                        background: "#4C7A5B",
                        borderRadius: 2,
                        marginRight: 5,
                      }}
                    />
                    Entrées — {formatFcfa(currentIncome)}
                  </span>
                  <span>
                    <span
                      style={{
                        display: "inline-block",
                        width: 10,
                        height: 10,
                        background: "#B23A34",
                        borderRadius: 2,
                        marginRight: 5,
                      }}
                    />
                    Sorties — {formatFcfa(currentExpense)}
                  </span>
                </div>
              </>
            )}
          </section>

          <section className="accent-sage" aria-labelledby="home-budget-heading">
            <h3 id="home-budget-heading">Exécution du budget (mois en cours)</h3>
            {budgetSummary === undefined ? (
              <p>Chargement…</p>
            ) : (
              <BudgetExecutionBars categories={budgetSummary} />
            )}
          </section>

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
    </section>
  );
}
