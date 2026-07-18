import { useState } from "react";
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
import type { Permissions } from "@/types/models";
import "./App.css";

type TabId =
  "accounts" | "transactions" | "budget" | "debts" | "report" | "recommendations" | "users";

interface TabDef {
  id: TabId;
  label: string;
  /** Tab is hidden entirely (not just disabled) for a user lacking this
   * permission — showing a tab whose whole content is "you can't do this"
   * is worse than not showing it at all. Accounts/Transactions/Budget/Debts
   * have no such gate: everyone can at least view those tables, even if
   * creating/editing is gated within the panel itself. */
  requires?: keyof Permissions;
}

const ALL_TABS: TabDef[] = [
  { id: "accounts", label: "Comptes" },
  { id: "transactions", label: "Opérations" },
  { id: "budget", label: "Budget Prévisionnel" },
  { id: "debts", label: "Dettes & Créances" },
  { id: "report", label: "Rapport Mensuel", requires: "viewReports" },
  { id: "recommendations", label: "Recommandations", requires: "viewReports" },
  { id: "users", label: "Utilisateurs", requires: "manageUsers" },
];

export function App() {
  const { currentUser, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<TabId>("accounts");

  if (!currentUser) {
    return <LoginScreen />;
  }

  const tabs = ALL_TABS.filter((tab) => !tab.requires || currentUser.permissions[tab.requires]);
  const selectedTab = tabs.some((tab) => tab.id === activeTab)
    ? activeTab
    : (tabs[0]?.id ?? "accounts");

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
        <nav className="tab-bar" role="tablist" aria-label="Sections de l'application">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`tab-${tab.id}`}
              aria-selected={selectedTab === tab.id}
              aria-controls={`tabpanel-${tab.id}`}
              className={`tab-button${selectedTab === tab.id ? " active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </header>
      <main role="tabpanel" id={`tabpanel-${selectedTab}`} aria-labelledby={`tab-${selectedTab}`}>
        {selectedTab === "accounts" && <AccountsPanel />}
        {selectedTab === "transactions" && <TransactionsPanel />}
        {selectedTab === "budget" && <BudgetPanel />}
        {selectedTab === "debts" && <DebtsPanel />}
        {selectedTab === "report" && <MonthlyReportPanel />}
        {selectedTab === "recommendations" && <RecommendationsPanel />}
        {selectedTab === "users" && <UsersPanel />}
      </main>
    </div>
  );
}
