import { useState } from "react";
import { AccountsPanel } from "@/components/AccountsPanel";
import { TransactionsPanel } from "@/components/TransactionsPanel";
import { BudgetPanel } from "@/components/BudgetPanel";
import { DebtsPanel } from "@/components/DebtsPanel";
import { MonthlyReportPanel } from "@/components/MonthlyReportPanel";
import { RecommendationsPanel } from "@/components/RecommendationsPanel";
import { ReportsPanel } from "@/components/ReportsPanel";
import { UsersPanel } from "@/components/UsersPanel";
import { SyncPanel } from "@/components/SyncPanel";
import { LoginScreen } from "@/components/LoginScreen";
import { useAuth } from "@/auth/AuthContext";
import { useAutoSync } from "@/sync/useAutoSync";
import { ROLE_LABELS } from "@/lib/permissions";
import type { Permissions } from "@/types/models";
import "./App.css";

interface SubMenuDef {
  id: string;
  label: string;
}

interface MenuDef {
  id: string;
  label: string;
  /** Menu (and every one of its submenus) is hidden entirely for a user
   * lacking this permission — showing a menu whose whole content is "you
   * can't do this" is worse than not showing it at all. */
  requires?: keyof Permissions;
  submenus?: SubMenuDef[];
}

const MENUS: MenuDef[] = [
  {
    id: "accounts",
    label: "Comptes",
    submenus: [
      { id: "new", label: "Nouveau Compte" },
      { id: "list", label: "Listing" },
    ],
  },
  {
    id: "transactions",
    label: "Opérations",
    submenus: [
      { id: "transfers", label: "Transferts" },
      { id: "operations", label: "Opérations" },
    ],
  },
  {
    id: "budget",
    label: "Budget",
    submenus: [
      { id: "forecast", label: "Prévisionnel" },
      { id: "engagements", label: "Engagements" },
    ],
  },
  {
    id: "debts",
    label: "Dettes & Créances",
    submenus: [
      { id: "debts", label: "Dettes" },
      { id: "receivables", label: "Créances" },
    ],
  },
  {
    id: "reports",
    label: "Rapports",
    requires: "viewReports",
    submenus: [
      { id: "monthly", label: "Mensuel" },
      { id: "general", label: "Général" },
      { id: "custom", label: "Personnalisé" },
      { id: "cashflow", label: "Trésorerie" },
    ],
  },
  { id: "recommendations", label: "Recommandations", requires: "viewReports" },
  {
    id: "users",
    label: "Utilisateurs",
    requires: "manageUsers",
    submenus: [
      { id: "list", label: "Listing" },
      { id: "profile", label: "Profil" },
    ],
  },
  // Reuses manageUsers rather than a dedicated permission: configuring
  // where this device's data is synced to is an infrastructure-level
  // decision in the same spirit as managing users, and adding a whole
  // new permission flag (touching Permissions, ROLE_DEFAULT_PERMISSIONS,
  // every existing user's stored record, and their tests) for a single
  // tab wasn't proportionate to build in this first pass.
  { id: "sync", label: "Synchronisation", requires: "manageUsers" },
];

export function App() {
  const { currentUser, logout } = useAuth();
  const [activeMenu, setActiveMenu] = useState("accounts");
  const [activeSubmenu, setActiveSubmenu] = useState<string | null>("new");
  // Called unconditionally, before the login check below, per React's rules
  // of hooks — but it's also correct to run regardless of local login
  // state: sync moves already-encrypted data and never decrypts anything,
  // so keeping it running even while sitting on the login screen (after a
  // logout, say) keeps this device's data fresh for whoever logs in next.
  useAutoSync();

  if (!currentUser) {
    return <LoginScreen />;
  }

  const menus = MENUS.filter((menu) => !menu.requires || currentUser.permissions[menu.requires]);
  const selectedMenu = menus.some((menu) => menu.id === activeMenu)
    ? menus.find((menu) => menu.id === activeMenu)!
    : menus[0]!;
  const selectedSubmenuId =
    selectedMenu.submenus?.some((s) => s.id === activeSubmenu) === true
      ? activeSubmenu!
      : (selectedMenu.submenus?.[0]?.id ?? null);

  function handleSelectMenu(menu: MenuDef) {
    setActiveMenu(menu.id);
    setActiveSubmenu(menu.submenus?.[0]?.id ?? null);
  }

  return (
    <div className="app">
      <header>
        <div className="top-bar">
          <div>
            <h1>SEZZ</h1>
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
          {menus.map((menu) => (
            <button
              key={menu.id}
              type="button"
              role="tab"
              id={`tab-${menu.id}`}
              aria-selected={selectedMenu.id === menu.id}
              className={`tab-button${selectedMenu.id === menu.id ? " active" : ""}`}
              onClick={() => handleSelectMenu(menu)}
            >
              {menu.label}
            </button>
          ))}
        </nav>
        {selectedMenu.submenus && (
          <nav
            className="tab-bar sub-tab-bar"
            role="tablist"
            aria-label={`Sous-sections de ${selectedMenu.label}`}
          >
            {selectedMenu.submenus.map((sub) => (
              <button
                key={sub.id}
                type="button"
                role="tab"
                id={`subtab-${selectedMenu.id}-${sub.id}`}
                aria-selected={selectedSubmenuId === sub.id}
                className={`tab-button${selectedSubmenuId === sub.id ? " active" : ""}`}
                onClick={() => setActiveSubmenu(sub.id)}
              >
                {sub.label}
              </button>
            ))}
          </nav>
        )}
      </header>
      <main
        role="tabpanel"
        id={`tabpanel-${selectedMenu.id}`}
        aria-labelledby={
          selectedSubmenuId
            ? `subtab-${selectedMenu.id}-${selectedSubmenuId}`
            : `tab-${selectedMenu.id}`
        }
      >
        {selectedMenu.id === "accounts" && (
          <AccountsPanel view={selectedSubmenuId === "new" ? "new" : "list"} />
        )}
        {selectedMenu.id === "transactions" && (
          <TransactionsPanel
            view={selectedSubmenuId === "transfers" ? "transfers" : "operations"}
          />
        )}
        {selectedMenu.id === "budget" && (
          <BudgetPanel view={selectedSubmenuId === "engagements" ? "engagements" : "forecast"} />
        )}
        {selectedMenu.id === "debts" && (
          <DebtsPanel view={selectedSubmenuId === "receivables" ? "receivables" : "debts"} />
        )}
        {selectedMenu.id === "reports" && selectedSubmenuId === "monthly" && <MonthlyReportPanel />}
        {selectedMenu.id === "reports" && selectedSubmenuId !== "monthly" && (
          <ReportsPanel
            section={
              selectedSubmenuId === "general"
                ? "general"
                : selectedSubmenuId === "cashflow"
                  ? "cashflow"
                  : "custom"
            }
          />
        )}
        {selectedMenu.id === "recommendations" && <RecommendationsPanel />}
        {selectedMenu.id === "users" && (
          <UsersPanel view={selectedSubmenuId === "profile" ? "profile" : "list"} />
        )}
        {selectedMenu.id === "sync" && <SyncPanel />}
      </main>
    </div>
  );
}
