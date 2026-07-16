import { useRecommendations } from "@/hooks/useRecommendations";
import { useAuth } from "@/auth/AuthContext";
import type { InsightSeverity } from "@/db/recommendations";

const SEVERITY_STYLE: Record<
  InsightSeverity,
  { background: string; border: string; label: string }
> = {
  success: { background: "#E4EEE6", border: "#4C7A5B", label: "✓" },
  info: { background: "#FBEFD8", border: "#C98A3B", label: "ℹ" },
  warning: { background: "#F5E3E1", border: "#B23A34", label: "⚠" },
};

export function RecommendationsPanel() {
  const now = new Date();
  const insights = useRecommendations(now.getFullYear(), now.getMonth() + 1);
  const { currentUser } = useAuth();

  if (!currentUser?.permissions.viewReports) {
    return (
      <section aria-labelledby="recommendations-heading">
        <h2 id="recommendations-heading">Recommandations</h2>
        <p className="permission-notice">
          Vous n&apos;avez pas la permission de consulter les recommandations.
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="recommendations-heading">
      <h2 id="recommendations-heading">Recommandations</h2>
      <p className="tagline">
        Analyse automatique du mois en cours, calculée uniquement à partir de vos données — rien
        n&apos;est envoyé à l&apos;extérieur.
      </p>

      {insights === undefined ? (
        <p>Chargement…</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {insights.map((insight) => {
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
        </div>
      )}
    </section>
  );
}
