import type { SezzAccountsDatabase } from "@/db/schema";
import { db as defaultDb } from "@/db/schema";

export interface SyncSession {
  serverUrl: string;
  token: string;
  syncAccountId: string;
}

async function readConfig(
  database: SezzAccountsDatabase,
  key: string,
): Promise<string | undefined> {
  const entry = await database.syncConfig.get(key as never);
  return entry?.value;
}

async function writeConfig(
  database: SezzAccountsDatabase,
  key: string,
  value: string,
): Promise<void> {
  await database.syncConfig.put({ key, value } as never);
}

/** Current sync session, or undefined if this device has never registered/
 * logged into a sync account. Reading this never touches the network. */
export async function getSyncSession(
  database: SezzAccountsDatabase = defaultDb,
): Promise<SyncSession | undefined> {
  const [serverUrl, token, syncAccountId] = await Promise.all([
    readConfig(database, "serverUrl"),
    readConfig(database, "token"),
    readConfig(database, "syncAccountId"),
  ]);
  if (!serverUrl || !token || !syncAccountId) return undefined;
  return { serverUrl, token, syncAccountId };
}

async function requestAuth(
  serverUrl: string,
  path: "/auth/register" | "/auth/login",
  email: string,
  password: string,
): Promise<{ token: string; syncAccountId: string }> {
  const response = await fetch(`${serverUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = (await response.json().catch(() => ({}))) as {
    token?: string;
    syncAccountId?: string;
    error?: string;
  };
  if (!response.ok || !body.token || !body.syncAccountId) {
    throw new Error(body.error ?? "Erreur de connexion au serveur de synchronisation.");
  }
  return { token: body.token, syncAccountId: body.syncAccountId };
}

/** Registers a brand-new sync account on `serverUrl` and stores the
 * resulting session on this device. Does not touch any local app data —
 * see src/sync/README or the server's own README for why registering or
 * logging into a sync account never decrypts anything. */
export async function registerSyncAccount(
  serverUrl: string,
  email: string,
  password: string,
  database: SezzAccountsDatabase = defaultDb,
): Promise<void> {
  const normalizedUrl = serverUrl.replace(/\/+$/, "");
  const { token, syncAccountId } = await requestAuth(
    normalizedUrl,
    "/auth/register",
    email,
    password,
  );
  await Promise.all([
    writeConfig(database, "serverUrl", normalizedUrl),
    writeConfig(database, "token", token),
    writeConfig(database, "syncAccountId", syncAccountId),
  ]);
}

export async function loginSyncAccount(
  serverUrl: string,
  email: string,
  password: string,
  database: SezzAccountsDatabase = defaultDb,
): Promise<void> {
  const normalizedUrl = serverUrl.replace(/\/+$/, "");
  const { token, syncAccountId } = await requestAuth(normalizedUrl, "/auth/login", email, password);
  await Promise.all([
    writeConfig(database, "serverUrl", normalizedUrl),
    writeConfig(database, "token", token),
    writeConfig(database, "syncAccountId", syncAccountId),
  ]);
}

/** Forgets this device's sync session entirely — does not delete anything
 * from the server, and does not touch any local app data (accounts,
 * transactions, ...), only the sync configuration itself. Also resets the
 * push/pull cursors, so re-registering or logging back in later starts a
 * fresh full sync rather than resuming from a stale cursor. */
export async function logoutSyncAccount(database: SezzAccountsDatabase = defaultDb): Promise<void> {
  await database.syncConfig.clear();
}
