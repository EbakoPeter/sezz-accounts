import { useState, type FormEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { usersRepository } from "@/repositories";
import { useAuth } from "@/auth/AuthContext";
import { BuildInfo } from "@/components/BuildInfo";

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

  if (pendingRecoveryCode) {
    return (
      <div className="login-screen">
        <div className="login-card">
          <h1>SEZZ Accounts</h1>
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
        <h1>SEZZ Accounts</h1>
        {isFirstRun ? (
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
