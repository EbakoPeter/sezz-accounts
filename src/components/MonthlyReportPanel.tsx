import { useState } from "react";
import { useMonthlyReport } from "@/hooks/useMonthlyReport";
import { useAuth } from "@/auth/AuthContext";
import { useTranslation } from "@/i18n/LanguageContext";
import { formatFcfa } from "@/lib/money";
import { PageHeader } from "./PageHeader";

export const MONTHLY_CHART_WIDTH = 760;
export const MONTHLY_CHART_HEIGHT = 220;

export function MonthlyBarChart({ rows }: { rows: { income: number; expense: number }[] }) {
  const { t } = useTranslation();
  const maxValue = Math.max(1, ...rows.map((r) => Math.max(r.income, r.expense)));
  const groupWidth = MONTHLY_CHART_WIDTH / 12;
  const barWidth = groupWidth * 0.32;
  const baseY = MONTHLY_CHART_HEIGHT;

  return (
    <svg
      viewBox={`0 0 ${MONTHLY_CHART_WIDTH} ${MONTHLY_CHART_HEIGHT + 24}`}
      role="img"
      aria-label={t("monthlyReport.chart.ariaLabel")}
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
              fill="#3D6B52"
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
              {t(`month.${i + 1}`).slice(0, 3)}
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
  const { t } = useTranslation();

  const totalIncome = rows?.reduce((sum, r) => sum + r.income, 0) ?? 0;
  const totalExpense = rows?.reduce((sum, r) => sum + r.expense, 0) ?? 0;
  const finalCumulative = rows?.at(-1)?.cumulativeNet ?? 0;

  if (!currentUser?.permissions.viewReports) {
    return (
      <section aria-labelledby="monthly-report-heading">
        <PageHeader
          title={t("monthlyReport.title")}
          section="reports"
          id="monthly-report-heading"
        />
        <p className="permission-notice">{t("monthlyReport.noPermission")}</p>
      </section>
    );
  }

  return (
    <section aria-labelledby="monthly-report-heading">
      <PageHeader title={t("monthlyReport.title")} section="reports" id="monthly-report-heading" />
      <p className="tagline">{t("monthlyReport.tagline")}</p>

      <div className="field" style={{ marginBottom: 16 }}>
        <label htmlFor="report-year">{t("monthlyReport.year")}</label>
        <input
          id="report-year"
          type="number"
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          style={{ width: 100 }}
        />
      </div>

      {rows === undefined ? (
        <p>{t("common.loading")}</p>
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
                  background: "#3D6B52",
                  borderRadius: 2,
                  marginRight: 5,
                }}
              />
              {t("monthlyReport.income")}
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
              {t("monthlyReport.expense")}
            </span>
          </div>

          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{t("monthlyReport.table.month")}</th>
                  <th>{t("monthlyReport.income")}</th>
                  <th>{t("monthlyReport.expense")}</th>
                  <th>{t("monthlyReport.table.net")}</th>
                  <th>{t("monthlyReport.table.cumulative")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.month}>
                    <td>{t(`month.${row.month}`)}</td>
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
                  <td>{t("monthlyReport.table.yearTotal")}</td>
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
