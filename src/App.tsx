import { AccountsPanel } from "@/components/AccountsPanel";
import { TransactionsPanel } from "@/components/TransactionsPanel";
import { BudgetPanel } from "@/components/BudgetPanel";
import { DebtsPanel } from "@/components/DebtsPanel";
import { MonthlyReportPanel } from "@/components/MonthlyReportPanel";
import { RecommendationsPanel } from "@/components/RecommendationsPanel";
import { UsersPanel } from "@/components/UsersPanel";
import { LoginScreen } from "@/components/LoginScreen";
import { useAuth } from "@/auth/AuthContext";
import { ROLE_LABELS } from "@/lib/permissions";
import "./App.css";

export function App() {
  const { currentUser, logout } = useAuth();

  if (!currentUser) {
    return <LoginScreen />;
  }

  return (
    <div className="app">
      <header>
        <div className="top-bar">
          <div>
            <h1>SEZZ Accounts</h1>
            <p className="tagline">Gestion budgétaire personnelle — fondation normalisée</p>
          </div>
          <div className="session-info">
            {currentUser.displayName} ({ROLE_LABELS[currentUser.role]}){" "}
            <button type="button" onClick={logout}>
              Se déconnecter
            </button>
          </div>
        </div>
      </header>
      <main>
        <AccountsPanel />
        <TransactionsPanel />
        <BudgetPanel />
        <DebtsPanel />
        <MonthlyReportPanel />
        <RecommendationsPanel />
        <UsersPanel />
      </main>
    </div>
  );
}
