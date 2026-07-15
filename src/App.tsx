import { AccountsPanel } from "@/components/AccountsPanel";
import { TransactionsPanel } from "@/components/TransactionsPanel";
import { BudgetPanel } from "@/components/BudgetPanel";
import "./App.css";

export function App() {
  return (
    <div className="app">
      <header>
        <h1>SEZZ Accounts</h1>
        <p className="tagline">Comptes, opérations et budget — fondation normalisée</p>
      </header>
      <main>
        <AccountsPanel />
        <TransactionsPanel />
        <BudgetPanel />
      </main>
    </div>
  );
}
