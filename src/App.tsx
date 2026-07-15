import { AccountsPanel } from "@/components/AccountsPanel";
import { TransactionsPanel } from "@/components/TransactionsPanel";
import { BudgetPanel } from "@/components/BudgetPanel";
import { DebtsPanel } from "@/components/DebtsPanel";
import { MonthlyReportPanel } from "@/components/MonthlyReportPanel";
import "./App.css";

export function App() {
  return (
    <div className="app">
      <header>
        <h1>SEZZ Accounts</h1>
        <p className="tagline">
          Comptes, opérations, budget, dettes et rapport — fondation normalisée
        </p>
      </header>
      <main>
        <AccountsPanel />
        <TransactionsPanel />
        <BudgetPanel />
        <DebtsPanel />
        <MonthlyReportPanel />
      </main>
    </div>
  );
}
