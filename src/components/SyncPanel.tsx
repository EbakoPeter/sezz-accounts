import { useEffect, useState, type FormEvent } from "react";
import {
  getSyncSession,
  registerSyncAccount,
  loginSyncAccount,
  logoutSyncAccount,
  type SyncSession,
} from "@/sync/syncClient";
import { syncNow, type SyncResult } from "@/sync/syncEngine";

type Mode = "register" | "login";

export function SyncPanel() {
  const [session, setSession] = useState<SyncSession | undefined | null>(null);
  const [mode, setMode] = useState<Mode>("register");
  const [serverUrl, setServerUrl] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [syncing, setSyncing] = useState(false);
  const [lastResult, setLastResult] = useState<SyncResult | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);

  useEffect(() => {
    getSyncSession().then(setSession);
  }, []);

  async function handleConnect(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setConnecting(true);
    try {
      if (mode === "register") {
        await registerSyncAccount(serverUrl, email, password);
      } else {
        await loginSyncAccount(serverUrl, email, password);
      }
      setSession(await getSyncSession());
      setPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inattendue.");
    } finally {
      setConnecting(false);
    }
  }

  async function handleLogout() {
    await logoutSyncAccount();
    setSession(undefined);
    setLastResult(null);
    setLastSyncedAt(null);
  }

  async function handleSyncNow() {
    if (!session) return;
    setError(null);
    setSyncing(true);
    try {
      const result = await syncNow(session);
      setLastResult(result);
      setLastSyncedAt(new Date());
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Erreur inattendue lors de la synchronisation.",
      );
    } finally {
      setSyncing(false);
    }
  }

  if (session === null) {
    return (
      <section aria-labelledby="sync-heading">
        <h2 id="sync-heading">Synchronisation</h2>
        <p>Chargement…</p>
      </section>
    );
  }

  return (
    <section aria-labelledby="sync-heading">
      <h2 id="sync-heading">Synchronisation entre appareils</h2>
      <p className="tagline">
        Un serveur ne fait que transmettre des données déjà chiffrées entre vos appareils — il ne
        peut jamais les lire. Se connecter ici ne déverrouille rien : seul votre mot de passe
        d&apos;utilisateur local fait cela.
      </p>

      {!session ? (
        <form onSubmit={handleConnect} aria-label="Se connecter à la synchronisation">
          <div className="field">
            <label htmlFor="sync-server-url">Adresse du serveur</label>
            <input
              id="sync-server-url"
              placeholder="https://votre-serveur.exemple.com"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="sync-email">Adresse e-mail</label>
            <input
              id="sync-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="sync-password">Mot de passe</label>
            <input
              type="password"
              id="sync-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button type="submit" disabled={connecting}>
            {mode === "register" ? "Créer le compte de synchronisation" : "Se connecter"}
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => setMode(mode === "register" ? "login" : "register")}
          >
            {mode === "register"
              ? "J'ai déjà un compte de synchronisation"
              : "Créer un nouveau compte de synchronisation"}
          </button>
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
        </form>
      ) : (
        <div>
          <p>
            Connecté à <strong>{session.serverUrl}</strong>.
          </p>
          <button type="button" onClick={handleSyncNow} disabled={syncing}>
            {syncing ? "Synchronisation…" : "Synchroniser maintenant"}
          </button>{" "}
          <button type="button" onClick={handleLogout}>
            Se déconnecter de la synchronisation
          </button>
          {lastResult && lastSyncedAt && (
            <p role="status">
              Dernière synchronisation à {lastSyncedAt.toLocaleTimeString("fr-FR")} —{" "}
              {lastResult.push.pushed} élément(s) envoyé(s), {lastResult.pull.pulled} reçu(s),{" "}
              {lastResult.pull.deleted} suppression(s) appliquée(s).
            </p>
          )}
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
