/**
 * Holds the raw DEK bytes for the current session, in memory only — never
 * written to IndexedDB, localStorage, or anywhere else. Cleared on logout.
 * This mirrors how the session itself works (AuthContext): no persistence,
 * re-authentication required every time the app opens.
 *
 * A plain module-level variable rather than React state deliberately —
 * repositories (which are plain functions, not components) need to reach
 * this without threading a prop through every call in the app.
 */

let activeDek: Uint8Array<ArrayBuffer> | null = null;

export function setActiveDek(dek: Uint8Array<ArrayBuffer>): void {
  activeDek = dek;
}

export function clearActiveDek(): void {
  activeDek = null;
}

export function getActiveDek(): Uint8Array<ArrayBuffer> | null {
  return activeDek;
}

/** Throws clearly rather than letting a repository silently fall back to
 * storing data in plain text if, somehow, no session is active. */
export function requireActiveDek(): Uint8Array<ArrayBuffer> {
  if (!activeDek) {
    throw new Error(
      "Aucune session chiffrée active : impossible de lire ou d'écrire des données protégées sans être connecté.",
    );
  }
  return activeDek;
}
