import { useEffect, useState, type FormEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  getSyncSession,
  registerSyncAccount,
  loginSyncAccount,
  logoutSyncAccount,
  type SyncSession,
} from "@/sync/syncClient";
import { syncNow, getLastSyncStatus } from "@/sync/syncEngine";
import { PageHeader } from "./PageHeader";
import {
  buildBackup,
  parseBackup,
  summarizeBackup,
  restoreBackup,
  type BackupFile,
  type BackupSummary,
} from "@/backup/backupEngine";

type Mode = "register" | "login";

export function SyncPanel() {
  const [session, setSession] = useState<SyncSession | undefined | null>(null);
  const [mode, setMode] = useState<Mode>("register");
  const [serverUrl, setServerUrl] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const [syncing, setSyncing] = useState(false);
  // Reactive: reflects the outcome of the most recent sync attempt whether
  // it was triggered by the button below or automatically in the
  // background (see useAutoSync) — both write to the same syncConfig
  // entry, so both show up here without this component needing to know
  // which one happened.
  const status = useLiveQuery(() => getLastSyncStatus(), []);

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [pendingRestore, setPendingRestore] = useState<{
    backup: BackupFile;
    summary: BackupSummary;
  } | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreFileInputKey, setRestoreFileInputKey] = useState(0);

  useEffect(() => {
    getSyncSession().then(setSession);
  }, []);

  async function handleConnect(event: FormEvent) {
    event.preventDefault();
    setConnectError(null);
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
      setConnectError(err instanceof Error ? err.message : "Erreur inattendue.");
    } finally {
      setConnecting(false);
    }
  }

  async function handleLogout() {
    await logoutSyncAccount();
    setSession(undefined);
  }

  async function handleSyncNow() {
    if (!session) return;
    setSyncing(true);
    try {
      await syncNow(session);
    } catch {
      // Deliberately not handled here: syncNow already records the
      // failure (see getLastSyncStatus above), which is what's displayed.
    } finally {
      setSyncing(false);
    }
  }

  async function handleDownloadBackup() {
    setExportError(null);
    setExporting(true);
    try {
      const backup = await buildBackup();
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const datePart = new Date(backup.exportedAt).toISOString().slice(0, 10);
      link.href = url;
      link.download = `sezz-sauvegarde-${datePart}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Erreur inattendue.");
    } finally {
      setExporting(false);
    }
  }

  function readFileAsText(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(new Error("Impossible de lire ce fichier."));
      reader.readAsText(file);
    });
  }

  async function handleBackupFileSelected(event: React.ChangeEvent<HTMLInputElement>) {
    setRestoreError(null);
    setPendingRestore(null);
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const content = await readFileAsText(file);
      const backup = parseBackup(content);
      setPendingRestore({ backup, summary: summarizeBackup(backup) });
    } catch (error) {
      setRestoreError(error instanceof Error ? error.message : "Erreur inattendue.");
      setRestoreFileInputKey((k) => k + 1); // clears the file input for a retry
    }
  }

  async function handleConfirmRestore() {
    if (!pendingRestore) return;
    if (
      !window.confirm(
        "Cette action va remplacer TOUTES les données actuelles de cet appareil par celles de " +
          "la sauvegarde. Ce qui existe actuellement et n'est pas dans la sauvegarde sera perdu. " +
          "Cette action est irréversible. Voulez-vous vraiment continuer ?",
      )
    ) {
      return;
    }
    setRestoring(true);
    setRestoreError(null);
    try {
      await restoreBackup(pendingRestore.backup);
      // A wholesale data replacement leaves this session's own state (the
      // in-memory DEK, whichever user is "logged in") potentially
      // mismatched with what's now actually stored — reloading is the
      // simplest way to guarantee a clean re-initialization against the
      // restored data, back at the login screen.
      window.location.reload();
    } catch (error) {
      setRestoreError(error instanceof Error ? error.message : "Erreur inattendue.");
      setRestoring(false);
    }
  }

  if (session === null) {
    return (
      <section aria-labelledby="sync-heading">
        <PageHeader title="Synchronisation" section="sync" id="sync-heading" />
        <p>Chargement…</p>
      </section>
    );
  }

  return (
    <section aria-labelledby="sync-heading">
      <PageHeader title="Synchronisation" section="sync" id="sync-heading" />
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
          {connectError && (
            <p role="alert" className="form-error">
              {connectError}
            </p>
          )}
        </form>
      ) : (
        <div>
          <p>
            Connecté à <strong>{session.serverUrl}</strong>.
          </p>
          <p className="tagline">
            La synchronisation se déclenche aussi automatiquement (à l&apos;ouverture, toutes les 5
            minutes, et au retour d&apos;une connexion réseau) — ce bouton reste utile pour forcer
            une synchronisation immédiate.
          </p>
          <button type="button" onClick={handleSyncNow} disabled={syncing}>
            {syncing ? "Synchronisation…" : "Synchroniser maintenant"}
          </button>{" "}
          <button type="button" onClick={handleLogout}>
            Se déconnecter de la synchronisation
          </button>
          {status && status.success && (
            <p role="status">
              Dernière synchronisation à {new Date(status.attemptedAt).toLocaleTimeString("fr-FR")}{" "}
              — {status.pushed} élément(s) envoyé(s), {status.pulled} reçu(s), {status.deleted}{" "}
              suppression(s) appliquée(s).
              {(status.conflicts ?? 0) > 0 && (
                <>
                  {" "}
                  {status.conflicts} élément(s) modifié(s) ailleurs entre-temps n&apos;ont pas été
                  envoyés — la version la plus à jour a été reçue à la place.
                </>
              )}
            </p>
          )}
          {status && !status.success && status.requiresSubscription && (
            <p role="alert" className="form-error">
              La synchronisation nécessite un abonnement actif — votre période d&apos;essai ou votre
              abonnement a expiré. Vos données restent utilisables normalement sur cet appareil ;
              seul l&apos;échange avec vos autres appareils est en pause jusqu&apos;au
              renouvellement.
            </p>
          )}
          {status && !status.success && !status.requiresSubscription && (
            <p role="alert" className="form-error">
              Échec de la dernière synchronisation (
              {new Date(status.attemptedAt).toLocaleTimeString("fr-FR")}) : {status.error}
            </p>
          )}
        </div>
      )}

      <section className="accent-sage" aria-labelledby="backup-heading">
        <h3 id="backup-heading">Sauvegarde locale</h3>
        <p className="tagline">
          Un fichier téléchargé sur cet appareil, indépendant du serveur de synchronisation — utile
          pour garder une copie avant un changement important, ou pour transférer vos données vers
          un nouvel appareil sans passer par la synchronisation. Les données sensibles restent
          chiffrées à l&apos;intérieur du fichier exactement comme dans l&apos;application.
        </p>

        <button type="button" onClick={handleDownloadBackup} disabled={exporting}>
          {exporting ? "Préparation…" : "Télécharger une sauvegarde"}
        </button>
        {exportError && (
          <p role="alert" className="form-error">
            {exportError}
          </p>
        )}

        <p>
          <strong>Restaurer une sauvegarde</strong>
        </p>
        <p className="tagline">
          Remplace toutes les données actuelles de cet appareil par celles du fichier choisi. Cette
          action est irréversible.
        </p>
        <div className="field">
          <label htmlFor="restore-file">Fichier de sauvegarde</label>
          <input
            key={restoreFileInputKey}
            id="restore-file"
            type="file"
            accept=".json,application/json"
            onChange={handleBackupFileSelected}
          />
        </div>
        {restoreError && (
          <p role="alert" className="form-error">
            {restoreError}
          </p>
        )}
        {pendingRestore && (
          <div className="note-box" role="status">
            <p>
              Sauvegarde du{" "}
              <strong>{new Date(pendingRestore.summary.exportedAt).toLocaleString("fr-FR")}</strong>{" "}
              — {pendingRestore.summary.totalRecords} enregistrement(s) au total.
            </p>
            <p className="tagline">
              Restaurer remplacera toutes les données actuelles de cet appareil par celles-ci.
              L&apos;application se rechargera une fois terminé.
            </p>
            <button type="button" onClick={handleConfirmRestore} disabled={restoring}>
              {restoring ? "Restauration…" : "Restaurer cette sauvegarde"}
            </button>{" "}
            <button
              type="button"
              className="ghost"
              onClick={() => {
                setPendingRestore(null);
                setRestoreFileInputKey((k) => k + 1);
              }}
              disabled={restoring}
            >
              Annuler
            </button>
          </div>
        )}
      </section>
    </section>
  );
}
