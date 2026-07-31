export type Language = "fr" | "en";

export const LANGUAGE_LABELS: Record<Language, string> = {
  fr: "Français",
  en: "English",
};

/**
 * Flat key → string dictionaries, one per supported language. Kept flat
 * (dot-separated keys like "nav.accounts" rather than nested objects)
 * deliberately: a flat structure means adding a new key is one line in
 * each language's object with no risk of the two structures silently
 * drifting apart (a nested object missing a whole branch in one
 * language fails much less obviously than one missing key in a flat
 * list, which every translated component's own fallback — see
 * useTranslation.ts — still catches immediately in the console).
 *
 * Coverage today: navigation (every menu and submenu), the welcome
 * screen, the login/registration screens, and the shared set of
 * generic actions (Ajouter/Modifier/Supprimer and friends) reused
 * across many panels. The remaining screens (Comptes, Opérations,
 * Budget, Dettes, Rapports, Utilisateurs, Synchronisation) still show
 * their text in French regardless of the language chosen — extending
 * coverage to them is mechanical (wrap each hardcoded string in t())
 * but substantial in sheer volume across this many components, so it
 * wasn't attempted wholesale in this pass.
 */
export const TRANSLATIONS: Record<Language, Record<string, string>> = {
  fr: {
    "app.name": "LeN'KAP",
    "app.tagline": "Gestion budgétaire personnelle — fondation normalisée",

    "nav.accounts": "Comptes",
    "nav.accounts.list": "Listing",
    "nav.accounts.new": "Nouveau Compte",
    "nav.budget": "Budget",
    "nav.budget.engagements": "Engagements",
    "nav.budget.forecast": "Prévisionnel",
    "nav.transactions": "Opérations",
    "nav.transactions.forecastCredit": "Crédit Prév (CP)",
    "nav.transactions.operations": "Opérations",
    "nav.transactions.transfers": "Transferts",
    "nav.debts": "Dettes & Créances",
    "nav.debts.receivables": "Créances",
    "nav.debts.debts": "Dettes",
    "nav.reports": "Rapports",
    "nav.reports.general": "Général",
    "nav.reports.monthly": "Mensuel",
    "nav.reports.custom": "Personnalisé",
    "nav.reports.cashflow": "Trésorerie",
    "nav.recommendations": "Recommandations",
    "nav.users": "Utilisateurs",
    "nav.users.list": "Listing",
    "nav.users.profile": "Profil",
    "nav.sync": "Synchronisation",
    "nav.home": "Retour à l'accueil",
    "nav.logout": "Se déconnecter",
    "nav.language": "Langue",

    "home.welcome": "Bienvenue, {name} !",
    "home.overview": "Vue d'ensemble de votre situation, au {date}.",
    "home.ad.label": "Emplacement publicitaire",
    "home.video.title": "Découvrir {app}",
    "home.video.comingSoon": "Vidéo de présentation — bientôt disponible ici.",

    "login.username": "Nom d'utilisateur",
    "login.password": "Mot de passe",
    "login.submit": "Se connecter",
    "login.forgotPassword": "Mot de passe oublié ?",
    "login.noAccount": "Je n'ai pas de compte",

    "common.add": "+ Ajouter",
    "common.edit": "Modifier",
    "common.delete": "Supprimer",
    "common.cancel": "Annuler",
    "common.save": "Enregistrer",
    "common.loading": "Chargement…",
  },
  en: {
    "app.name": "LeN'KAP",
    "app.tagline": "Personal budget management — standardized foundation",

    "nav.accounts": "Accounts",
    "nav.accounts.list": "Listing",
    "nav.accounts.new": "New Account",
    "nav.budget": "Budget",
    "nav.budget.engagements": "Commitments",
    "nav.budget.forecast": "Forecast",
    "nav.transactions": "Transactions",
    "nav.transactions.forecastCredit": "Planned Credit (PC)",
    "nav.transactions.operations": "Transactions",
    "nav.transactions.transfers": "Transfers",
    "nav.debts": "Debts & Receivables",
    "nav.debts.receivables": "Receivables",
    "nav.debts.debts": "Debts",
    "nav.reports": "Reports",
    "nav.reports.general": "General",
    "nav.reports.monthly": "Monthly",
    "nav.reports.custom": "Custom",
    "nav.reports.cashflow": "Cash Flow",
    "nav.recommendations": "Recommendations",
    "nav.users": "Users",
    "nav.users.list": "Listing",
    "nav.users.profile": "Profile",
    "nav.sync": "Synchronization",
    "nav.home": "Back to home",
    "nav.logout": "Log out",
    "nav.language": "Language",

    "home.welcome": "Welcome, {name}!",
    "home.overview": "Overview of your situation, as of {date}.",
    "home.ad.label": "Advertisement space",
    "home.video.title": "Discover {app}",
    "home.video.comingSoon": "Presentation video — coming soon here.",

    "login.username": "Username",
    "login.password": "Password",
    "login.submit": "Log in",
    "login.forgotPassword": "Forgot password?",
    "login.noAccount": "I don't have an account",

    "common.add": "+ Add",
    "common.edit": "Edit",
    "common.delete": "Delete",
    "common.cancel": "Cancel",
    "common.save": "Save",
    "common.loading": "Loading…",
  },
};
