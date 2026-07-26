import type { Permissions, UserRole } from "@/types/models";

export const ROLE_DEFAULT_PERMISSIONS: Record<UserRole, Permissions> = {
  admin: {
    manageAccounts: true,
    manageTransactions: true,
    manageBudget: true,
    manageDebts: true,
    viewReports: true,
    manageUsers: true,
  },
  standard: {
    manageAccounts: true,
    manageTransactions: true,
    manageBudget: true,
    manageDebts: true,
    viewReports: true,
    manageUsers: false,
  },
  viewer: {
    manageAccounts: false,
    manageTransactions: false,
    manageBudget: false,
    manageDebts: false,
    viewReports: true,
    manageUsers: false,
  },
};

export const PERMISSION_LABELS: Record<keyof Permissions, string> = {
  manageAccounts: "Gérer les comptes",
  manageTransactions: "Gérer les opérations",
  manageBudget: "Gérer le budget prévisionnel",
  manageDebts: "Gérer les dettes et créances",
  viewReports: "Consulter les rapports et recommandations",
  manageUsers: "Gérer les utilisateurs",
};

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Administrateur",
  standard: "Standard",
  viewer: "Lecture seule",
};
