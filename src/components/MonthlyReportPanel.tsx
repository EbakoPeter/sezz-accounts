import { useState } from "react";
import { useMonthlyReport } from "@/hooks/useMonthlyReport";
import { useAuth } from "@/auth/AuthContext";
import { formatFcfa } from "@/lib/money";

const MONTH_NAMES = [
  "Janvier",
  "Février",
  "Mars",
  "Avril",
  "Mai",
  "Juin",
  "Juillet",
  "Août",
  "Septembre",
  "Octobre",
  "Novembre",
  "Décembre",
];

export const MONTHLY_CHART_WIDTH = 760;
export const MONTHLY_CHART_HEIGHT = 220;

export function MonthlyBarChart({ rows }: { rows: { income: number; expense: number }[] }) {
  const maxValue = Math.max(1, ...rows.map((r) => Math.max(r.income, r.expense)));
  const groupWidth = MONTHLY_CHART_WIDTH / 12;
  const barWidth = groupWidth * 0.32;
  const baseY = MONTHLY_CHART_HEIGHT;

  return (
    <svg
      viewBox={`0 0 ${MONTHLY_CHART_WIDTH} ${MONTHLY_CHART_HEIGHT + 24}`}
      role="img"
      aria-label="Graphique des revenus et dépenses par mois"
      style={{ width: "100%", maxWidth: 800, height: "auto" }}
    >
      <line
        x1={0}
        y1={MONTHLY_CHART_HEIGHT}
        x2={MONTHLY_CHART_WIDTH}
        y2={MONTHLY_CHART_HEIGHT}
        stroke="#DDD3BE"
      />
      {rows.map((row, i) => {
        const x0 = i * groupWidth + groupWidth * 0.12;
        const incomeHeight = (row.income / maxValue) * (MONTHLY_CHART_HEIGHT - 20);
        const expenseHeight = (row.expense / maxValue) * (MONTHLY_CHART_HEIGHT - 20);
        return (
          // fixed 12-month layout: index is a stable, meaningful key here
          <g key={i}>
            <rect
              x={x0}
              y={baseY - incomeHeight}
              width={barWidth}
              height={incomeHeight}
              fill="#4C7A5B"
              rx={2}
            />
            <rect
              x={x0 + barWidth + 3}
              y={baseY - expenseHeight}
              width={barWidth}
              height={expenseHeight}
              fill="#B23A34"
              rx={2}
            />
            <text
              x={x0 + barWidth + 1.5}
              y={MONTHLY_CHART_HEIGHT + 16}
              fontSize={10}
              textAnchor="middle"
              fill="#726B5E"
            >
              {MONTH_NAMES[i]?.slice(0, 3)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function MonthlyReportPanel() {
  const [year, setYear] = useState(new Date().getFullYear());
  const rows = useMonthlyReport(year);
  const { currentUser } = useAuth();

  const totalIncome = rows?.reduce((sum, r) => sum + r.income, 0) ?? 0;
  const totalExpense = rows?.reduce((sum, r) => sum + r.expense, 0) ?? 0;
  const finalCumulative = rows?.at(-1)?.cumulativeNet ?? 0;

  if (!currentUser?.permissions.viewReports) {
    return (
      <section aria-labelledby="monthly-report-heading">
        <h2 id="monthly-report-heading">Rapport Mensuel</h2>
        <p className="permission-notice">
          Vous n&apos;avez pas la permission de consulter les rapports.
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="monthly-report-heading">
      <h2 id="monthly-report-heading">Rapport Mensuel</h2>
      <p className="tagline">Revenus et dépenses, triés de janvier à décembre.</p>

      <div className="field" style={{ marginBottom: 16 }}>
        <label htmlFor="report-year">Année</label>
        <input
          id="report-year"
          type="number"
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          style={{ width: 100 }}
        />
      </div>

      {rows === undefined ? (
        <p>Chargement…</p>
      ) : (
        <>
          <MonthlyBarChart rows={rows} />
          <div
            style={{
              display: "flex",
              gap: 18,
              fontSize: ".78rem",
              color: "#726B5E",
              margin: "6px 0 18px",
            }}
          >
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
              Revenus
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
              Dépenses
            </span>
          </div>

          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Mois</th>
                  <th>Revenus</th>
                  <th>Dépenses</th>
                  <th>Solde net</th>
                  <th>Solde cumulé</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.month}>
                    <td>{MONTH_NAMES[row.month - 1]}</td>
                    <td className="num pos">{formatFcfa(row.income)}</td>
                    <td className="num negative">{formatFcfa(row.expense)}</td>
                    <td className={`num ${row.net < 0 ? "negative" : ""}`}>
                      {formatFcfa(row.net)}
                    </td>
                    <td className={`num ${row.cumulativeNet < 0 ? "negative" : ""}`}>
                      {formatFcfa(row.cumulativeNet)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>TOTAL ANNÉE</td>
                  <td className="num">{formatFcfa(totalIncome)}</td>
                  <td className="num">{formatFcfa(totalExpense)}</td>
                  <td className={`num ${totalIncome - totalExpense < 0 ? "negative" : ""}`}>
                    {formatFcfa(totalIncome - totalExpense)}
                  </td>
                  <td className={`num ${finalCumulative < 0 ? "negative" : ""}`}>
                    {formatFcfa(finalCumulative)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
