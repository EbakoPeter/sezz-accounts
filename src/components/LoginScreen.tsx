import { useState, type FormEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { usersRepository } from "@/repositories";
import { useAuth } from "@/auth/AuthContext";

export function LoginScreen() {
  const userCount = useLiveQuery(() => usersRepository.list().then((list) => list.length), []);
  const { login } = useAuth();

  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

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
      await usersRepository.create({
        username,
        displayName: displayName || username,
        password,
        role: "admin",
      });
      await login(username, password);
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
                  id="first-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="first-confirm-password">Confirmer le mot de passe</label>
                <input
                  id="first-confirm-password"
                  type="password"
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
        ) : (
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
                id="login-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <button type="submit">Se connecter</button>
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
