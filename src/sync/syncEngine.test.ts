import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDatabase } from "@/test/testDatabase";
import type { SezzAccountsDatabase } from "@/db/schema";
import { pushChanges, pullChanges, syncNow } from "./syncEngine";
import type { SyncSession } from "./syncClient";

const session: SyncSession = {
  serverUrl: "https://sync.example.com",
  token: "test-token",
  syncAccountId: "acct-1",
};

let database: SezzAccountsDatabase;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  database = createTestDatabase();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 400): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

async function seedAccountRow(id: string, updatedAt: number) {
  await database.accounts.put({
    id,
    createdAt: updatedAt,
    updatedAt,
    _enc: { iv: "iv", data: `data-${id}` },
  });
}

describe("pushChanges", () => {
  it("sends every row across every table that has never been pushed", async () => {
    await seedAccountRow("acc-1", 1000);
    await database.transactions.put({
      id: "tx-1",
      accountId: "acc-1",
      kind: "expense",
      date: "2026-01-01",
      createdAt: 1000,
      updatedAt: 1000,
      _enc: { iv: "iv", data: "tx-data" },
    });
    fetchMock.mockResolvedValue(jsonResponse({ accepted: 2, serverTime: 5000 }));

    const result = await pushChanges(session, database);

    expect(result.pushed).toBe(2);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://sync.example.com/sync/push",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer test-token" }),
      }),
    );
    const sentBody = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(sentBody.records).toHaveLength(2);
    const account = sentBody.records.find((r: { tableName: string }) => r.tableName === "accounts");
    expect(account).toMatchObject({ id: "acc-1", encData: { iv: "iv", data: "data-acc-1" } });
  });

  it("only sends rows changed since the last successful push", async () => {
    await seedAccountRow("acc-old", 1000);
    fetchMock.mockResolvedValue(jsonResponse({ accepted: 1, serverTime: 2000 }));
    await pushChanges(session, database);

    await seedAccountRow("acc-new", 3000);
    fetchMock.mockClear();
    fetchMock.mockResolvedValue(jsonResponse({ accepted: 1, serverTime: 4000 }));
    const result = await pushChanges(session, database);

    expect(result.pushed).toBe(1);
    const sentBody = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(sentBody.records).toHaveLength(1);
    expect(sentBody.records[0].id).toBe("acc-new");
  });

  it("advances the push cursor to the server's clock, not the local one", async () => {
    await seedAccountRow("acc-1", 1000);
    fetchMock.mockResolvedValue(jsonResponse({ accepted: 1, serverTime: 999999 }));
    await pushChanges(session, database);

    const cursor = await database.syncConfig.get("lastPushedAt");
    expect(cursor?.value).toBe("999999");
  });

  it("includes pending deletion-log entries as tombstone records", async () => {
    await database.deletionLog.add({
      tableName: "accounts",
      recordId: "acc-deleted",
      deletedAt: 1500,
    });
    fetchMock.mockResolvedValue(jsonResponse({ accepted: 1, serverTime: 2000 }));

    await pushChanges(session, database);

    const sentBody = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(sentBody.records).toHaveLength(1);
    expect(sentBody.records[0]).toMatchObject({
      tableName: "accounts",
      id: "acc-deleted",
      deletedAt: 1500,
      encData: null,
    });
  });

  it("prunes deletion-log entries once successfully pushed", async () => {
    await database.deletionLog.add({ tableName: "accounts", recordId: "acc-1", deletedAt: 1500 });
    fetchMock.mockResolvedValue(jsonResponse({ accepted: 1, serverTime: 2000 }));

    await pushChanges(session, database);

    expect(await database.deletionLog.count()).toBe(0);
  });

  it("does nothing and does not call fetch when there is nothing to push", async () => {
    const result = await pushChanges(session, database);
    expect(result.pushed).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws with the server's error message on failure, without advancing the cursor", async () => {
    await seedAccountRow("acc-1", 1000);
    fetchMock.mockResolvedValue(
      jsonResponse({ error: "Session invalide ou expirée." }, false, 401),
    );

    await expect(pushChanges(session, database)).rejects.toThrow(/session invalide/i);
    expect(await database.syncConfig.get("lastPushedAt")).toBeUndefined();
  });
});

describe("pullChanges", () => {
  it("upserts a new record into the correct local table", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        records: [
          {
            tableName: "accounts",
            id: "acc-remote",
            structural: {},
            encData: { iv: "iv", data: "remote-data" },
            createdAt: 1000,
            updatedAt: 1000,
          },
        ],
        serverTime: 2000,
      }),
    );

    const result = await pullChanges(session, database);

    expect(result.pulled).toBe(1);
    const stored = await database.accounts.get("acc-remote");
    expect(stored).toMatchObject({ id: "acc-remote", _enc: { iv: "iv", data: "remote-data" } });
  });

  it("removes the local row for a tombstone record", async () => {
    await seedAccountRow("acc-1", 1000);
    fetchMock.mockResolvedValue(
      jsonResponse({
        records: [
          {
            tableName: "accounts",
            id: "acc-1",
            structural: {},
            encData: null,
            createdAt: 1000,
            updatedAt: 2000,
            deletedAt: 2000,
          },
        ],
        serverTime: 3000,
      }),
    );

    const result = await pullChanges(session, database);

    expect(result.deleted).toBe(1);
    expect(await database.accounts.get("acc-1")).toBeUndefined();
  });

  it("does not overwrite a newer local edit that has not been pushed yet", async () => {
    await seedAccountRow("acc-1", 5000); // newer local edit
    fetchMock.mockResolvedValue(
      jsonResponse({
        records: [
          {
            tableName: "accounts",
            id: "acc-1",
            structural: {},
            encData: { iv: "iv", data: "stale-remote-data" },
            createdAt: 1000,
            updatedAt: 3000, // older than local
          },
        ],
        serverTime: 4000,
      }),
    );

    await pullChanges(session, database);

    const stored = await database.accounts.get("acc-1");
    expect(stored?._enc.data).toBe("data-acc-1"); // unchanged, still the local version
  });

  it("preserves structural fields (e.g. accountId, kind) when merging", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        records: [
          {
            tableName: "transactions",
            id: "tx-remote",
            structural: { accountId: "acc-1", kind: "expense", date: "2026-01-01" },
            encData: { iv: "iv", data: "d" },
            createdAt: 1000,
            updatedAt: 1000,
          },
        ],
        serverTime: 2000,
      }),
    );

    await pullChanges(session, database);

    const stored = await database.transactions.get("tx-remote");
    expect(stored).toMatchObject({ accountId: "acc-1", kind: "expense", date: "2026-01-01" });
  });

  it("advances the pull cursor to the server's clock", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ records: [], serverTime: 777777 }));
    await pullChanges(session, database);

    const cursor = await database.syncConfig.get("lastPulledAt");
    expect(cursor?.value).toBe("777777");
  });

  it("requests records since the stored pull cursor", async () => {
    await database.syncConfig.put({ key: "lastPulledAt", value: "12345" });
    fetchMock.mockResolvedValue(jsonResponse({ records: [], serverTime: 20000 }));

    await pullChanges(session, database);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://sync.example.com/sync/pull?since=12345",
      expect.anything(),
    );
  });

  it("throws with the server's error message on failure", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "Authentification requise." }, false, 401));
    await expect(pullChanges(session, database)).rejects.toThrow(/authentification requise/i);
  });
});

describe("syncNow", () => {
  it("pushes before pulling", async () => {
    await seedAccountRow("acc-1", 1000);
    const callOrder: string[] = [];
    fetchMock.mockImplementation((url: string) => {
      callOrder.push(url.includes("/sync/push") ? "push" : "pull");
      return Promise.resolve(
        url.includes("/sync/push")
          ? jsonResponse({ accepted: 1, serverTime: 2000 })
          : jsonResponse({ records: [], serverTime: 3000 }),
      );
    });

    await syncNow(session, database);

    expect(callOrder).toEqual(["push", "pull"]);
  });
});
