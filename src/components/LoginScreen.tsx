import { useState, type FormEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { usersRepository } from "@/repositories";
import { useAuth } from "@/auth/AuthContext";
import { BuildInfo } from "@/components/BuildInfo";
import { loginSyncAccount, getSyncSession } from "@/sync/syncClient";
import { pullChanges } from "@/sync/syncEngine";

type Mode = "login" | "forgot-password";

export function LoginScreen() {
  const userCount = useLiveQuery(() => usersRepository.count(), []);
  const { login, recoverAccount } = useAuth();

  const [mode, setMode] = useState<Mode>("login");

  // Shared login/first-run fields
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Forgot-password fields
  const [recoverUsername, setRecoverUsername] = useState("");
  const [recoveryCodeInput, setRecoveryCodeInput] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");

  // "Join an existing household" fields — lets a genuinely fresh device
  // pull down an existing setup (users, accounts, everything) via sync
  // instead of creating its own independent admin account, which would
  // otherwise generate its own separate encryption key. See
  // handleJoinViaSync below for how this actually avoids that.
  const [joiningViaSync, setJoiningViaSync] = useState(false);
  const [joinServerUrl, setJoinServerUrl] = useState("");
  const [joinEmail, setJoinEmail] = useState("");
  const [joinPassword, setJoinPassword] = useState("");
  const [joining, setJoining] = useState(false);

  // Set once account creation or recovery produces a fresh recovery code
  // that must be shown and acknowledged before the person can proceed —
  // both flows funnel through this same mandatory screen.
  const [pendingRecoveryCode, setPendingRecoveryCode] = useState<{
    code: string;
    loginUsername: string;
    loginPassword: string;
  } | null>(null);
  const [codeAcknowledged, setCodeAcknowledged] = useState(false);

  if (userCount === undefined) {
    return <p>Chargement…</p>;
  }

  const isFirstRun = userCount === 0;

  async function handleCreateFirstAdmin(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (password !== confirmPassword) {
      setError("Les deux mots de passe ne correspondent pas.");
      return;
    }
    try {
      const { recoveryCode } = await usersRepository.create({
        username,
        displayName: displayName || username,
        password,
        role: "admin",
      });
      setPendingRecoveryCode({
        code: recoveryCode,
        loginUsername: username,
        loginPassword: password,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inattendue.");
    }
  }

  async function handleLogin(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await login(username, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inattendue.");
    }
  }

  async function handleRecover(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (newPassword !== confirmNewPassword) {
      setError("Les deux mots de passe ne correspondent pas.");
      return;
    }
    try {
      const newCode = await recoverAccount(recoverUsername, recoveryCodeInput, newPassword);
      setPendingRecoveryCode({
        code: newCode,
        loginUsername: recoverUsername,
        loginPassword: newPassword,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inattendue.");
    }
  }

  async function handleContinueAfterRecoveryCode() {
    if (!pendingRecoveryCode) return;
    await login(pendingRecoveryCode.loginUsername, pendingRecoveryCode.loginPassword);
  }

  /**
   * Connects to an *existing* sync account (never registers a new one —
   * joining implies one already exists, created by whichever device set
   * this household up first) and immediately pulls its data down,
   * *before* this device has ever created a local user of its own.
   *
   * This is what actually avoids the encryption-key mismatch: no local
   * admin is created here, so no new DEK is generated on this device. The
   * pull brings in the existing household's `users` table records exactly
   * as-is — including their `wrappedDek`, still wrapped under each user's
   * own password. Once that data exists locally, this component's
   * `userCount` (a live query) naturally flips from 0 to something
   * positive, and the screen re-renders into the ordinary login form on
   * its own. Logging in there with any of those pulled-in users' real
   * credentials unwraps the *same* shared DEK the other device already
   * uses — because unwrapping only ever depends on the password, not on
   * which device is doing it.
   */
  async function handleJoinViaSync(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setJoining(true);
    try {
      await loginSyncAccount(joinServerUrl, joinEmail, joinPassword);
      const session = await getSyncSession();
      if (!session) {
        throw new Error("La connexion à la synchronisation a échoué.");
      }
      const result = await pullChanges(session);
      if (result.pulled === 0 && result.deleted === 0) {
        setError(
          "Connecté, mais aucune donnée n'a été reçue. Vérifiez que l'autre appareil a " +
            "déjà synchronisé au moins une fois, puis réessayez.",
        );
      }
      // On success, userCount's own live query (watching the users table)
      // updates by itself once the pull writes to it — nothing further to
      // do here; this component re-renders into the login form on its own.
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inattendue.");
    } finally {
      setJoining(false);
    }
  }

  if (pendingRecoveryCode) {
    return (
      <div className="login-screen">
        <div className="login-card">
          <h1>SEZZ</h1>
          <h2>Votre code de récupération</h2>
          <p className="tagline">
            Notez ce code et conservez-le en lieu sûr. Il est le seul moyen de retrouver
            l&apos;accès à vos données si vous oubliez votre mot de passe — il ne sera plus jamais
            affiché.
          </p>
          <p className="recovery-code" data-testid="recovery-code">
            {pendingRecoveryCode.code}
          </p>
          <label className="field" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              checked={codeAcknowledged}
              onChange={(e) => setCodeAcknowledged(e.target.checked)}
            />
            J&apos;ai noté ce code en lieu sûr.
          </label>
          <button
            type="button"
            disabled={!codeAcknowledged}
            onClick={handleContinueAfterRecoveryCode}
          >
            Continuer
          </button>
          <BuildInfo />
        </div>
      </div>
    );
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <h1>SEZZ</h1>
        {isFirstRun && joiningViaSync ? (
          <form onSubmit={handleJoinViaSync} aria-label="Rejoindre un foyer existant">
            <p className="tagline">
              Connectez-vous à la synchronisation déjà configurée sur un autre appareil — ses
              comptes et données seront récupérés ici, sans en créer de nouveaux.
            </p>
            <div className="field">
              <label htmlFor="join-server-url">Adresse du serveur</label>
              <input
                id="join-server-url"
                placeholder="https://votre-serveur.exemple.com"
                value={joinServerUrl}
                onChange={(e) => setJoinServerUrl(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="join-email">Adresse e-mail (compte de synchronisation)</label>
              <input
                id="join-email"
                type="email"
                value={joinEmail}
                onChange={(e) => setJoinEmail(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="join-password">Mot de passe (compte de synchronisation)</label>
              <input
                type="password"
                id="join-password"
                value={joinPassword}
                onChange={(e) => setJoinPassword(e.target.value)}
              />
            </div>
            <button type="submit" disabled={joining}>
              {joining ? "Connexion…" : "Se connecter et récupérer les données"}
            </button>
            <button type="button" className="ghost" onClick={() => setJoiningViaSync(false)}>
              Retour
            </button>
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
          </form>
        ) : isFirstRun ? (
          <>
            <p className="tagline">Premier lancement : créez le compte administrateur principal.</p>
            <form onSubmit={handleCreateFirstAdmin} aria-label="Créer le compte administrateur">
              <div className="field">
                <label htmlFor="first-username">Nom d&apos;utilisateur</label>
                <input
                  id="first-username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="first-display-name">Nom affiché</label>
                <input
                  id="first-display-name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="first-password">Mot de passe</label>
                <input
                  type="password"
                  id="first-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="first-confirm-password">Confirmer le mot de passe</label>
                <input
                  type="password"
                  id="first-confirm-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </div>
              <button type="submit">Créer et se connecter</button>
              <button type="button" className="ghost" onClick={() => setJoiningViaSync(true)}>
                Rejoindre un foyer existant via synchronisation
              </button>
              {error && (
                <p role="alert" className="form-error">
                  {error}
                </p>
              )}
            </form>
          </>
        ) : mode === "login" ? (
          <form onSubmit={handleLogin} aria-label="Se connecter">
            <div className="field">
              <label htmlFor="login-username">Nom d&apos;utilisateur</label>
              <input
                id="login-username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="login-password">Mot de passe</label>
              <input
                type="password"
                id="login-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <button type="submit">Se connecter</button>
            <button type="button" className="ghost" onClick={() => setMode("forgot-password")}>
              Mot de passe oublié ?
            </button>
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
          </form>
        ) : (
          <form onSubmit={handleRecover} aria-label="Récupérer l'accès">
            <p className="tagline">
              Utilisez votre code de récupération pour définir un nouveau mot de passe.
            </p>
            <div className="field">
              <label htmlFor="recover-username">Nom d&apos;utilisateur</label>
              <input
                id="recover-username"
                value={recoverUsername}
                onChange={(e) => setRecoverUsername(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="recover-code">Code de récupération</label>
              <input
                id="recover-code"
                value={recoveryCodeInput}
                onChange={(e) => setRecoveryCodeInput(e.target.value)}
                placeholder="XXXX-XXXX-XXXX-XXXX"
              />
            </div>
            <div className="field">
              <label htmlFor="recover-new-password">Nouveau mot de passe</label>
              <input
                type="password"
                id="recover-new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="recover-confirm-password">Confirmer le nouveau mot de passe</label>
              <input
                type="password"
                id="recover-confirm-password"
                value={confirmNewPassword}
                onChange={(e) => setConfirmNewPassword(e.target.value)}
              />
            </div>
            <button type="submit">Réinitialiser et se connecter</button>
            <button type="button" className="ghost" onClick={() => setMode("login")}>
              Retour à la connexion
            </button>
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
          </form>
        )}
        <BuildInfo />
      </div>
    </div>
  );
}
