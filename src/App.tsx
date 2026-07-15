import { AccountsPanel } from "@/components/AccountsPanel";
import { TransactionsPanel } from "@/components/TransactionsPanel";
import "./App.css";

export function App() {
  return (
    <div className="app">
      <header>
        <h1>SEZZ Accounts</h1>
        <p className="tagline">Comptes et opérations — fondation normalisée</p>
      </header>
      <main>
        <AccountsPanel />
        <TransactionsPanel />
      </main>
    </div>
  );
}
