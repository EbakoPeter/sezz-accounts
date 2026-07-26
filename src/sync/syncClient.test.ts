import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDatabase } from "@/test/testDatabase";
import type { SezzAccountsDatabase } from "@/db/schema";
import {
  registerSyncAccount,
  loginSyncAccount,
  logoutSyncAccount,
  getSyncSession,
} from "./syncClient";

let database: SezzAccountsDatabase;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  database = createTestDatabase();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 400): Response {
  return { ok, status, json: () => Promise.resolve(body) } as Response;
}

describe("getSyncSession", () => {
  it("returns undefined when no session has ever been established", async () => {
    expect(await getSyncSession(database)).toBeUndefined();
  });
});

describe("registerSyncAccount", () => {
  it("stores the session on success", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ token: "tok-1", syncAccountId: "acct-1" }));

    await registerSyncAccount(
      "https://sync.example.com",
      "peter@example.com",
      "password123",
      database,
    );

    const session = await getSyncSession(database);
    expect(session).toEqual({
      serverUrl: "https://sync.example.com",
      token: "tok-1",
      syncAccountId: "acct-1",
    });
  });

  it("strips a trailing slash from the server URL", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ token: "tok-1", syncAccountId: "acct-1" }));

    await registerSyncAccount(
      "https://sync.example.com/",
      "peter@example.com",
      "password123",
      database,
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://sync.example.com/auth/register",
      expect.anything(),
    );
  });

  it("throws with the server's error message and stores nothing on failure", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: "Un compte existe déjà avec cette adresse e-mail." }, false, 409),
    );

    await expect(
      registerSyncAccount("https://sync.example.com", "peter@example.com", "password123", database),
    ).rejects.toThrow(/existe déjà/i);
    expect(await getSyncSession(database)).toBeUndefined();
  });
});

describe("loginSyncAccount", () => {
  it("stores the session on success", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ token: "tok-2", syncAccountId: "acct-2" }));

    await loginSyncAccount(
      "https://sync.example.com",
      "peter@example.com",
      "password123",
      database,
    );

    const session = await getSyncSession(database);
    expect(session?.token).toBe("tok-2");
  });

  it("throws with the server's error message on wrong credentials", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: "Adresse e-mail ou mot de passe incorrect." }, false, 401),
    );

    await expect(
      loginSyncAccount("https://sync.example.com", "peter@example.com", "wrong", database),
    ).rejects.toThrow(/incorrect/i);
  });
});

describe("logoutSyncAccount", () => {
  it("clears the session", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ token: "tok-1", syncAccountId: "acct-1" }));
    await registerSyncAccount(
      "https://sync.example.com",
      "peter@example.com",
      "password123",
      database,
    );

    await logoutSyncAccount(database);

    expect(await getSyncSession(database)).toBeUndefined();
  });

  it("resets the push/pull cursors, not just the credentials", async () => {
    await database.syncConfig.put({ key: "lastPushedAt", value: "12345" });
    await database.syncConfig.put({ key: "lastPulledAt", value: "12345" });

    await logoutSyncAccount(database);

    expect(await database.syncConfig.count()).toBe(0);
  });
});
