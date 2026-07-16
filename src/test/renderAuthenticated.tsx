import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { AuthProvider } from "@/auth/AuthContext";
import { usersRepository } from "@/repositories";
import type { UserRole, Permissions } from "@/types/models";
import { ROLE_DEFAULT_PERMISSIONS } from "@/lib/permissions";

/**
 * Component tests render against the app's real singleton database (backed
 * by fake-indexeddb) rather than an isolated per-test instance — matching
 * the pattern already used throughout this test suite for panels. Since
 * every panel now reads `useAuth()`, tests need a logged-in session.
 *
 * The session is created and resolved *before* React ever mounts anything
 * (via AuthProvider's `initialUser` prop), rather than via an async
 * `login()` call inside a mounted component's `useEffect` — the latter was
 * tried first and made RTL's `findBy*`/`waitFor` polling unreliable for
 * whatever async update a test triggered *afterwards*, in this environment.
 */

let counter = 0;

export async function createTestUser(role: UserRole, permissionOverrides?: Partial<Permissions>) {
  // usersRepository.create() deliberately forces the very first user ever
  // created to be a full admin (so the app can never start locked out) —
  // correct behavior for the real app, but it means a test asking for a
  // restricted role (e.g. "viewer") would silently get "admin" instead if
  // the users table happened to be empty. A throwaway bootstrap admin
  // absorbs that rule first, so the actual test user gets exactly the
  // role/permissions it asked for.
  const existingUsers = await usersRepository.list();
  if (existingUsers.length === 0) {
    counter += 1;
    await usersRepository.create({
      username: `bootstrap-admin-${counter}`,
      displayName: "Bootstrap Admin",
      password: "bootstrap-password",
      role: "admin",
    });
  }

  counter += 1;
  const username = `test-user-${counter}`;
  const password = "test-password-123";
  const user = await usersRepository.create({
    username,
    displayName: username,
    password,
    role,
    ...(permissionOverrides
      ? { permissions: { ...ROLE_DEFAULT_PERMISSIONS[role], ...permissionOverrides } }
      : {}),
  });
  return user;
}

/** Renders `ui` inside an already-authenticated session. Defaults to an
 * admin user (full permissions) unless `role`/`permissionOverrides` are
 * given — most existing tests exercise full-permission behavior; a handful
 * of dedicated tests use this to verify permission-gating for restricted
 * roles. */
export async function renderAuthenticated(
  ui: ReactElement,
  options: { role?: UserRole; permissionOverrides?: Partial<Permissions> } = {},
) {
  const user = await createTestUser(options.role ?? "admin", options.permissionOverrides);
  const utils = render(<AuthProvider initialUser={user}>{ui}</AuthProvider>);
  return { ...utils, user };
}
