import { useState, useRef, useEffect } from "react";
import { HomePanel } from "@/components/HomePanel";
import { AccountsPanel } from "@/components/AccountsPanel";
import { TransactionsPanel } from "@/components/TransactionsPanel";
import { ForecastCreditPanel } from "@/components/ForecastCreditPanel";
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
  /** Shown instead of the full label while this menu isn't the active
   * one — a fixed, short length so every menu occupies the same-sized
   * box regardless of how long its real name is, rather than the tab
   * bar's width varying tab to tab. The full label still shows once a
   * menu becomes active (see the tab button's own rendering below). */
  abbrev: string;
  /** Menu (and every one of its submenus) is hidden entirely for a user
   * lacking this permission — showing a menu whose whole content is "you
   * can't do this" is worse than not showing it at all. */
  requires?: keyof Permissions;
  submenus?: SubMenuDef[];
}

const MENUS: MenuDef[] = [
  { id: "home", label: "Accueil", abbrev: "ACCU" },
  {
    id: "accounts",
    label: "Comptes",
    abbrev: "CPTS",
    submenus: [
      { id: "list", label: "Listing" },
      { id: "new", label: "Nouveau Compte" },
    ],
  },
  {
    id: "transactions",
    label: "Opérations",
    abbrev: "OPER",
    submenus: [
      { id: "forecastCredit", label: "Crédit Prév (CP)" },
      { id: "operations", label: "Opérations" },
      { id: "transfers", label: "Transferts" },
    ],
  },
  {
    id: "budget",
    label: "Budget",
    abbrev: "BDGT",
    submenus: [
      { id: "engagements", label: "Engagements" },
      { id: "forecast", label: "Prévisionnel" },
    ],
  },
  {
    id: "debts",
    label: "Dettes & Créances",
    abbrev: "D&C",
    submenus: [
      { id: "receivables", label: "Créances" },
      { id: "debts", label: "Dettes" },
    ],
  },
  {
    id: "reports",
    label: "Rapports",
    abbrev: "RAPP",
    requires: "viewReports",
    submenus: [
      { id: "general", label: "Général" },
      { id: "monthly", label: "Mensuel" },
      { id: "custom", label: "Personnalisé" },
      { id: "cashflow", label: "Trésorerie" },
    ],
  },
  { id: "recommendations", label: "Recommandations", abbrev: "RECO", requires: "viewReports" },
  {
    id: "users",
    label: "Utilisateurs",
    abbrev: "UTIL",
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
  { id: "sync", label: "Synchronisation", abbrev: "SYNC", requires: "manageUsers" },
];

export function App() {
  const { currentUser, logout } = useAuth();
  const [activeMenu, setActiveMenu] = useState("home");
  const [activeSubmenu, setActiveSubmenu] = useState<string | null>(null);
  // Which top-level menu's submenu dropdown is currently unfolded, if
  // any — deliberately separate from activeMenu/activeSubmenu (which
  // track what content is showing): a menu can be the active one while
  // its dropdown sits closed, exactly like a website's own nav menu only
  // reveals its children while you're actually interacting with it.
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const navRef = useRef<HTMLElement>(null);

  // Called unconditionally, before the login check below, per React's rules
  // of hooks — but it's also correct to run regardless of local login
  // state: sync moves already-encrypted data and never decrypts anything,
  // so keeping it running even while sitting on the login screen (after a
  // logout, say) keeps this device's data fresh for whoever logs in next.
  useAutoSync();

  // Closes an open dropdown on an outside tap/click — the other half of
  // "behaves like a website's nav dropdown" alongside the toggle logic
  // below: it shouldn't take a second tap on the same menu, or a
  // selection, to make it go away if the person just taps elsewhere.
  useEffect(() => {
    if (!openDropdown) return;
    function handlePointerDown(event: PointerEvent) {
      if (navRef.current && !navRef.current.contains(event.target as Node)) {
        setOpenDropdown(null);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [openDropdown]);

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

  function handleClickMenu(menu: MenuDef) {
    if (!menu.submenus) {
      // A leaf menu (Recommandations, Synchronisation) just navigates —
      // there is nothing to unfold.
      setActiveMenu(menu.id);
      setActiveSubmenu(null);
      setOpenDropdown(null);
      return;
    }
    if (openDropdown === menu.id) {
      // Tapping the already-open menu again closes it, same as a
      // website's nav dropdown toggling shut on a second click.
      setOpenDropdown(null);
      return;
    }
    setOpenDropdown(menu.id);
    if (activeMenu !== menu.id) {
      setActiveMenu(menu.id);
      setActiveSubmenu(menu.submenus[0]!.id);
    }
  }

  function handleClickSubmenu(sub: SubMenuDef) {
    setActiveSubmenu(sub.id);
    setOpenDropdown(null);
  }

  const dropdownMenu = openDropdown ? menus.find((menu) => menu.id === openDropdown) : undefined;

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
        <nav
          ref={navRef}
          className="tab-bar-wrapper"
          role="navigation"
          aria-label="Sections de l'application"
        >
          <div className="tab-bar" role="tablist">
            {menus.map((menu) => (
              <button
                key={menu.id}
                type="button"
                role="tab"
                id={`tab-${menu.id}`}
                aria-selected={selectedMenu.id === menu.id}
                aria-expanded={menu.submenus ? openDropdown === menu.id : undefined}
                aria-haspopup={menu.submenus ? "true" : undefined}
                aria-label={menu.label}
                className={`tab-button${selectedMenu.id === menu.id ? " active" : ""}`}
                onClick={() => handleClickMenu(menu)}
              >
                <span aria-hidden="true">
                  {selectedMenu.id === menu.id ? menu.label : menu.abbrev}
                </span>
                {menu.submenus && <span className="dropdown-caret" aria-hidden="true" />}
              </button>
            ))}
          </div>
          {dropdownMenu?.submenus && (
            <div className="submenu-dropdown" role="menu" aria-label={`${dropdownMenu.label} —`}>
              {dropdownMenu.submenus.map((sub) => (
                <button
                  key={sub.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={dropdownMenu.id === selectedMenu.id && selectedSubmenuId === sub.id}
                  className={`submenu-item${
                    dropdownMenu.id === selectedMenu.id && selectedSubmenuId === sub.id
                      ? " active"
                      : ""
                  }`}
                  onClick={() => handleClickSubmenu(sub)}
                >
                  {sub.label}
                </button>
              ))}
            </div>
          )}
        </nav>
      </header>
      <main
        role="tabpanel"
        id={`tabpanel-${selectedMenu.id}`}
        aria-labelledby={`tab-${selectedMenu.id}`}
      >
        {selectedMenu.id === "home" && <HomePanel />}
        {selectedMenu.id === "accounts" && (
          <AccountsPanel view={selectedSubmenuId === "new" ? "new" : "list"} />
        )}
        {selectedMenu.id === "transactions" && selectedSubmenuId === "forecastCredit" && (
          <ForecastCreditPanel />
        )}
        {selectedMenu.id === "transactions" && selectedSubmenuId !== "forecastCredit" && (
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
