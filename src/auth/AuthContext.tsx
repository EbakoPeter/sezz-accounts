import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import type { User } from "@/types/models";
import { usersRepository } from "@/repositories";

interface AuthContextValue {
  currentUser: User | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  /** Re-reads the current user from the database — used after an admin
   * edits their own permissions/role so the in-memory session reflects it
   * immediately rather than on next login. */
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Deliberately in-memory only, exactly like the previous app version: no
 * session token is persisted anywhere, so closing or reloading the app
 * always requires logging in again. This is a conscious choice, not an
 * oversight — see README for the reasoning.
 *
 * `initialUser` exists for tests: it lets a session start already
 * authenticated, synchronously, rather than every test needing to render,
 * wait for an async `login()` call inside a `useEffect`, and only then
 * proceed — which in practice made React Testing Library's `findBy*`/
 * `waitFor` polling unreliable in this environment for the *next* async
 * update a test triggered afterwards. The real app never passes it.
 */
export function AuthProvider({
  children,
  initialUser = null,
}: {
  children: ReactNode;
  initialUser?: User | null;
}) {
  const [currentUser, setCurrentUser] = useState<User | null>(initialUser);

  const login = useCallback(async (username: string, password: string) => {
    const user = await usersRepository.authenticate(username, password);
    setCurrentUser(user);
  }, []);

  const logout = useCallback(() => {
    setCurrentUser(null);
  }, []);

  const refresh = useCallback(async () => {
    if (!currentUser) return;
    const fresh = await usersRepository.getById(currentUser.id);
    if (fresh) setCurrentUser(fresh);
  }, [currentUser]);

  return (
    <AuthContext.Provider value={{ currentUser, login, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

// The standard React context+hook co-location pattern (Provider and its
// matching useX hook in one file); splitting them into separate files
// would only help Fast Refresh granularity in dev mode, at the cost of the
// usual, well-understood pairing convention this codebase follows.
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider.");
  }
  return context;
}
