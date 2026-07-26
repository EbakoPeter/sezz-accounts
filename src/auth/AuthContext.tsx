import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import type { User } from "@/types/models";
import { usersRepository } from "@/repositories";
import { setActiveDek, clearActiveDek } from "@/lib/encryptionSession";

interface AuthContextValue {
  currentUser: User | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  /** Re-reads the current user from the database — used after an admin
   * edits their own permissions/role so the in-memory session reflects it
   * immediately rather than on next login. */
  refresh: () => Promise<void>;
  /** Uses a recovery code to set a new password, in place of a forgotten
   * one. Deliberately does *not* log the person in itself — it returns the
   * freshly-rotated recovery code so the caller can show it once and get
   * acknowledgment, exactly like first-run account creation; the caller
   * then calls `login()` with the new password as a separate, explicit
   * step once that's done. */
  recoverAccount: (username: string, recoveryCode: string, newPassword: string) => Promise<string>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Deliberately in-memory only, exactly like the previous app version: no
 * session token is persisted anywhere, so closing or reloading the app
 * always requires logging in again. This is a conscious choice, not an
 * oversight — see README for the reasoning. The same is true of the
 * decryption key itself (see src/lib/encryptionSession.ts): it lives only
 * as long as the session does.
 *
 * `initialUser`/`initialDek` exist for tests: they let a session start
 * already authenticated and already holding an active DEK, synchronously,
 * rather than every test needing to render, wait for an async `login()`
 * call inside a `useEffect`, and only then proceed — which in practice made
 * React Testing Library's `findBy*`/`waitFor` polling unreliable in this
 * environment for the *next* async update a test triggered afterwards. The
 * real app never passes either.
 */
export function AuthProvider({
  children,
  initialUser = null,
  initialDek,
}: {
  children: ReactNode;
  initialUser?: User | null;
  initialDek?: Uint8Array<ArrayBuffer>;
}) {
  const [currentUser, setCurrentUser] = useState<User | null>(() => {
    if (initialUser && initialDek) setActiveDek(initialDek);
    return initialUser;
  });

  const login = useCallback(async (username: string, password: string) => {
    const { user, dek } = await usersRepository.authenticate(username, password);
    setActiveDek(dek);
    setCurrentUser(user);
  }, []);

  const logout = useCallback(() => {
    clearActiveDek();
    setCurrentUser(null);
  }, []);

  const refresh = useCallback(async () => {
    if (!currentUser) return;
    const fresh = await usersRepository.getById(currentUser.id);
    if (fresh) setCurrentUser(fresh);
  }, [currentUser]);

  const recoverAccount = useCallback(
    async (username: string, recoveryCode: string, newPassword: string): Promise<string> => {
      const result = await usersRepository.recoverWithCode(username, recoveryCode, newPassword);
      return result.recoveryCode;
    },
    [],
  );

  return (
    <AuthContext.Provider value={{ currentUser, login, logout, refresh, recoverAccount }}>
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
