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
import { Logo } from "@/components/Logo";
import { useAuth } from "@/auth/AuthContext";
import { useAutoSync } from "@/sync/useAutoSync";
import { useTranslation } from "@/i18n/LanguageContext";
import { LANGUAGE_LABELS, type Language } from "@/i18n/translations";
import { ROLE_LABELS } from "@/lib/permissions";
import type { Permissions } from "@/types/models";
import "./App.css";

interface SubMenuDef {
  id: string;
  labelKey: string;
}

interface MenuDef {
  id: string;
  labelKey: string;
  /** Menu (and every one of its submenus) is hidden entirely for a user
   * lacking this permission — showing a menu whose whole content is "you
   * can't do this" is worse than not showing it at all. */
  requires?: keyof Permissions;
  submenus?: SubMenuDef[];
}

const MENUS: MenuDef[] = [
  {
    id: "accounts",
    labelKey: "nav.accounts",
    submenus: [
      { id: "list", labelKey: "nav.accounts.list" },
      { id: "new", labelKey: "nav.accounts.new" },
    ],
  },
  {
    id: "budget",
    labelKey: "nav.budget",
    submenus: [
      { id: "engagements", labelKey: "nav.budget.engagements" },
      { id: "forecast", labelKey: "nav.budget.forecast" },
    ],
  },
  {
    id: "transactions",
    labelKey: "nav.transactions",
    submenus: [
      { id: "forecastCredit", labelKey: "nav.transactions.forecastCredit" },
      { id: "operations", labelKey: "nav.transactions.operations" },
      { id: "transfers", labelKey: "nav.transactions.transfers" },
    ],
  },
  {
    id: "debts",
    labelKey: "nav.debts",
    submenus: [
      { id: "receivables", labelKey: "nav.debts.receivables" },
      { id: "debts", labelKey: "nav.debts.debts" },
    ],
  },
  {
    id: "reports",
    labelKey: "nav.reports",
    requires: "viewReports",
    submenus: [
      { id: "general", labelKey: "nav.reports.general" },
      { id: "monthly", labelKey: "nav.reports.monthly" },
      { id: "custom", labelKey: "nav.reports.custom" },
      { id: "cashflow", labelKey: "nav.reports.cashflow" },
    ],
  },
  { id: "recommendations", labelKey: "nav.recommendations", requires: "viewReports" },
  {
    id: "users",
    labelKey: "nav.users",
    requires: "manageUsers",
    submenus: [
      { id: "list", labelKey: "nav.users.list" },
      { id: "profile", labelKey: "nav.users.profile" },
    ],
  },
  // Reuses manageUsers rather than a dedicated permission: configuring
  // where this device's data is synced to is an infrastructure-level
  // decision in the same spirit as managing users, and adding a whole
  // new permission flag (touching Permissions, ROLE_DEFAULT_PERMISSIONS,
  // every existing user's stored record, and their tests) for a single
  // tab wasn't proportionate to build in this first pass.
  { id: "sync", labelKey: "nav.sync", requires: "manageUsers" },
];

export function App() {
  const { currentUser, logout } = useAuth();
  const { t, language, setLanguage } = useTranslation();
  const [activeMenu, setActiveMenu] = useState("accounts");
  // The welcome screen (see HomePanel) is no longer one of the regular
  // tabs in `menus` below — it's what's shown by default on login,
  // separate from tab-based navigation entirely, with its own path back
  // to it (clicking the SEZZ title) rather than being just another item
  // in the tab list a person could otherwise never fully leave.
  const [showingWelcome, setShowingWelcome] = useState(true);
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

  // currentUser?.id (not just currentUser) as the dependency: this must
  // fire again on every *new* login, but not on every re-render a
  // logged-in session naturally causes (a user's own record refreshing
  // after a permission change, for instance) — those still leave the
  // same id, and shouldn't yank someone back to the welcome screen
  // while they're in the middle of using a different tab.
  useEffect(() => {
    setShowingWelcome(true);
  }, [currentUser?.id]);

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
    setShowingWelcome(false);
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
    setShowingWelcome(false);
    setActiveSubmenu(sub.id);
    setOpenDropdown(null);
  }

  const dropdownMenu = openDropdown ? menus.find((menu) => menu.id === openDropdown) : undefined;

  return (
    <div className="app">
      <header>
        <div className="top-bar">
          <div>
            <button
              type="button"
              className="brand-home-link"
              onClick={() => {
                setShowingWelcome(true);
                setOpenDropdown(null);
              }}
              aria-label={t("nav.home")}
            >
              <Logo size={40} />
              <h1 className="brand-name">
                <span className="brand-name-primary">Le</span>
                <span className="brand-name-accent">N&apos;KAP</span>
              </h1>
            </button>
            <p className="tagline">{t("app.tagline")}</p>
          </div>
          <div className="session-info">
            <label className="language-picker">
              <span className="sr-only">{t("nav.language")}</span>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value as Language)}
                aria-label={t("nav.language")}
              >
                {(Object.keys(LANGUAGE_LABELS) as Language[]).map((lang) => (
                  <option key={lang} value={lang}>
                    {LANGUAGE_LABELS[lang]}
                  </option>
                ))}
              </select>
            </label>
            {currentUser.displayName} ({ROLE_LABELS[currentUser.role]}){" "}
            <button type="button" onClick={logout}>
              {t("nav.logout")}
            </button>
          </div>
        </div>

        <section className="ad-slot" aria-label={t("home.ad.label")}>
          <span className="ad-slot-label">{t("home.ad.label")}</span>
        </section>

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
                aria-selected={!showingWelcome && selectedMenu.id === menu.id}
                aria-expanded={menu.submenus ? openDropdown === menu.id : undefined}
                aria-haspopup={menu.submenus ? "true" : undefined}
                aria-label={t(menu.labelKey)}
                className={`tab-button${!showingWelcome && selectedMenu.id === menu.id ? " active" : ""}`}
                onClick={() => handleClickMenu(menu)}
              >
                <span aria-hidden="true">{t(menu.labelKey)}</span>
                {menu.submenus && <span className="dropdown-caret" aria-hidden="true" />}
              </button>
            ))}
          </div>
          {dropdownMenu?.submenus && (
            <div
              className="submenu-dropdown"
              role="menu"
              aria-label={`${t(dropdownMenu.labelKey)} —`}
            >
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
                  {t(sub.labelKey)}
                </button>
              ))}
            </div>
          )}
        </nav>
      </header>
      {showingWelcome ? (
        <main aria-label="Accueil">
          <HomePanel />
        </main>
      ) : (
        <main
          role="tabpanel"
          id={`tabpanel-${selectedMenu.id}`}
          aria-labelledby={`tab-${selectedMenu.id}`}
        >
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
          {selectedMenu.id === "reports" && selectedSubmenuId === "monthly" && (
            <MonthlyReportPanel />
          )}
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
      )}
    </div>
  );
}
