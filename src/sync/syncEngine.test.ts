import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDatabase } from "@/test/testDatabase";
import type { SezzAccountsDatabase } from "@/db/schema";
import { pushChanges, pullChanges, syncNow, getLastSyncStatus } from "./syncEngine";
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

async function seedAccountRow(id: string, updatedAt: number, seq?: number) {
  await database.accounts.put({
    id,
    createdAt: updatedAt,
    updatedAt,
    ...(seq !== undefined ? { seq } : {}),
    _enc: { iv: "iv", data: `data-${id}` },
  });
}

/** Mocks a successful push: every record in the request is accepted,
 * each assigned the next seq starting from `startSeq`. */
function mockPushAccepting(startSeq: number, serverTime = Date.now()) {
  fetchMock.mockImplementationOnce((_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string) as {
      records: { tableName: string; id: string }[];
    };
    const accepted = body.records.map((r, i) => ({
      tableName: r.tableName,
      id: r.id,
      seq: startSeq + i,
    }));
    return Promise.resolve(
      jsonResponse({ accepted, rejected: [], total: body.records.length, serverTime }),
    );
  });
}

function mockPull(records: unknown[], serverSeq: number) {
  fetchMock.mockImplementationOnce(() => Promise.resolve(jsonResponse({ records, serverSeq })));
}

describe("pushChanges", () => {
  it("sends every row across every table that has never been pushed, with baseSeq 0", async () => {
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
    mockPushAccepting(1);

    const result = await pushChanges(session, database);

    expect(result.pushed).toBe(2);
    expect(result.conflicts).toHaveLength(0);
    const sentBody = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(sentBody.records).toHaveLength(2);
    const account = sentBody.records.find((r: { tableName: string }) => r.tableName === "accounts");
    expect(account).toMatchObject({
      id: "acc-1",
      encData: { iv: "iv", data: "data-acc-1" },
      baseSeq: 0,
    });
  });

  it("only sends rows changed since the last successful push", async () => {
    await seedAccountRow("acc-old", 1000);
    mockPushAccepting(1, 2000);
    await pushChanges(session, database);

    await seedAccountRow("acc-new", 3000);
    mockPushAccepting(2, 4000);
    const result = await pushChanges(session, database);

    expect(result.pushed).toBe(1);
    const sentBody = JSON.parse(fetchMock.mock.calls[1]![1].body);
    expect(sentBody.records).toHaveLength(1);
    expect(sentBody.records[0].id).toBe("acc-new");
  });

  it("sends a row's own current seq as baseSeq once it has one", async () => {
    await seedAccountRow("acc-1", 1000, 42);
    mockPushAccepting(43);

    await pushChanges(session, database);

    const sentBody = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(sentBody.records[0].baseSeq).toBe(42);
  });

  it("updates the local row's seq to what the server assigned once accepted", async () => {
    await seedAccountRow("acc-1", 1000);
    mockPushAccepting(77);

    await pushChanges(session, database);

    const row = await database.accounts.get("acc-1");
    expect(row?.seq).toBe(77);
  });

  it("includes pending deletion-log entries as tombstone records, carrying their stored baseSeq", async () => {
    await database.deletionLog.add({
      tableName: "accounts",
      recordId: "acc-deleted",
      deletedAt: 1500,
      baseSeq: 12,
    });
    mockPushAccepting(13);

    await pushChanges(session, database);

    const sentBody = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(sentBody.records).toHaveLength(1);
    expect(sentBody.records[0]).toMatchObject({
      tableName: "accounts",
      id: "acc-deleted",
      deletedAt: 1500,
      encData: null,
      baseSeq: 12,
    });
  });

  it("prunes deletion-log entries once accepted", async () => {
    await database.deletionLog.add({
      tableName: "accounts",
      recordId: "acc-deleted",
      deletedAt: 1500,
      baseSeq: 0,
    });
    mockPushAccepting(1);

    await pushChanges(session, database);

    expect(await database.deletionLog.count()).toBe(0);
  });

  it("does nothing and does not call fetch when there is nothing to push", async () => {
    const result = await pushChanges(session, database);

    expect(result).toEqual({ pushed: 0, conflicts: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws with the server's error message on failure, without advancing the cursor", async () => {
    await seedAccountRow("acc-1", 1000);
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "Session invalide." }, false, 401));

    await expect(pushChanges(session, database)).rejects.toThrow(/session invalide/i);
  });

  describe("when the server rejects a record (compare-and-swap conflict)", () => {
    it("applies the server's current version locally instead of the stale local one", async () => {
      await seedAccountRow("acc-1", 1000, 5);
      fetchMock.mockImplementationOnce(() =>
        Promise.resolve(
          jsonResponse({
            accepted: [],
            rejected: [
              {
                tableName: "accounts",
                id: "acc-1",
                current: {
                  tableName: "accounts",
                  id: "acc-1",
                  structural: {},
                  encData: { iv: "iv", data: "from-server-newer" },
                  createdAt: 1000,
                  updatedAt: 9000,
                  deletedAt: null,
                  seq: 99,
                },
              },
            ],
            total: 1,
          }),
        ),
      );

      const result = await pushChanges(session, database);

      expect(result.pushed).toBe(0);
      expect(result.conflicts).toEqual([{ tableName: "accounts", id: "acc-1" }]);
      const row = await database.accounts.get("acc-1");
      expect(row?._enc).toEqual({ iv: "iv", data: "from-server-newer" });
      expect(row?.seq).toBe(99);
    });

    it("removes the local row when the rejection's current server state is a tombstone", async () => {
      await seedAccountRow("acc-1", 1000, 5);
      fetchMock.mockImplementationOnce(() =>
        Promise.resolve(
          jsonResponse({
            accepted: [],
            rejected: [
              {
                tableName: "accounts",
                id: "acc-1",
                current: {
                  tableName: "accounts",
                  id: "acc-1",
                  structural: {},
                  encData: null,
                  createdAt: 1000,
                  updatedAt: 9000,
                  deletedAt: 9000,
                  seq: 99,
                },
              },
            ],
            total: 1,
          }),
        ),
      );

      await pushChanges(session, database);

      expect(await database.accounts.get("acc-1")).toBeUndefined();
    });

    it("removes a stale deletion-log entry for a record whose creation collided (no current state to apply)", async () => {
      await database.deletionLog.add({
        tableName: "accounts",
        recordId: "acc-1",
        deletedAt: 1000,
        baseSeq: 0,
      });
      fetchMock.mockImplementationOnce(() =>
        Promise.resolve(
          jsonResponse({
            accepted: [],
            rejected: [{ tableName: "accounts", id: "acc-1", current: null }],
            total: 1,
          }),
        ),
      );

      await pushChanges(session, database);

      expect(await database.deletionLog.count()).toBe(0);
    });
  });

  it("batches large pushes to the server's own limit", async () => {
    for (let i = 0; i < 3; i++) {
      await database.deletionLog.add({
        tableName: "accounts",
        recordId: `acc-${i}`,
        deletedAt: 1000 + i,
        baseSeq: 0,
      });
    }
    fetchMock.mockImplementation((_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { records: { id: string }[] };
      return Promise.resolve(
        jsonResponse({
          accepted: body.records.map((r) => ({ tableName: "accounts", id: r.id, seq: 1 })),
          rejected: [],
          total: body.records.length,
        }),
      );
    });

    const result = await pushChanges(session, database);

    expect(result.pushed).toBe(3);
  });
});

describe("pullChanges", () => {
  it("requests records since the stored seq cursor", async () => {
    await database.syncConfig.put({ key: "lastPulledSeq", value: "42" });
    mockPull([], 42);

    await pullChanges(session, database);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://sync.example.com/sync/pull?since=42",
      expect.anything(),
    );
  });

  it("upserts a new record into the correct local table", async () => {
    mockPull(
      [
        {
          tableName: "accounts",
          id: "acc-1",
          structural: {},
          encData: { iv: "iv", data: "d1" },
          createdAt: 1000,
          updatedAt: 1000,
          deletedAt: null,
          seq: 5,
        },
      ],
      5,
    );

    const result = await pullChanges(session, database);

    expect(result.pulled).toBe(1);
    const row = await database.accounts.get("acc-1");
    expect(row).toMatchObject({ _enc: { iv: "iv", data: "d1" }, seq: 5 });
  });

  it("removes the local row for a tombstone record", async () => {
    await seedAccountRow("acc-1", 1000, 5);
    mockPull(
      [
        {
          tableName: "accounts",
          id: "acc-1",
          structural: {},
          encData: null,
          createdAt: 1000,
          updatedAt: 9000,
          deletedAt: 9000,
          seq: 6,
        },
      ],
      6,
    );

    const result = await pullChanges(session, database);

    expect(result.deleted).toBe(1);
    expect(await database.accounts.get("acc-1")).toBeUndefined();
  });

  it("preserves structural fields (e.g. accountId, kind) when merging", async () => {
    mockPull(
      [
        {
          tableName: "transactions",
          id: "tx-1",
          structural: { accountId: "acc-1", kind: "expense", date: "2026-01-01" },
          encData: { iv: "iv", data: "d" },
          createdAt: 1000,
          updatedAt: 1000,
          deletedAt: null,
          seq: 1,
        },
      ],
      1,
    );

    await pullChanges(session, database);

    const row = await database.transactions.get("tx-1");
    expect(row).toMatchObject({ accountId: "acc-1", kind: "expense", date: "2026-01-01" });
  });

  it("advances the pull cursor to the server's own reported serverSeq", async () => {
    mockPull([], 12345);

    await pullChanges(session, database);

    const entry = await database.syncConfig.get("lastPulledSeq");
    expect(entry?.value).toBe("12345");
  });

  it("throws with the server's error message on failure", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "Session invalide." }, false, 401));

    await expect(pullChanges(session, database)).rejects.toThrow(/session invalide/i);
  });
});

describe("syncNow", () => {
  it("pushes before pulling", async () => {
    await seedAccountRow("acc-1", 1000);
    const callOrder: string[] = [];
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("/sync/push")) {
        callOrder.push("push");
        return Promise.resolve(
          jsonResponse({
            accepted: [{ tableName: "accounts", id: "acc-1", seq: 1 }],
            rejected: [],
            total: 1,
          }),
        );
      }
      callOrder.push("pull");
      return Promise.resolve(jsonResponse({ records: [], serverSeq: 1 }));
    });

    await syncNow(session, database);

    expect(callOrder).toEqual(["push", "pull"]);
  });

  it("records a successful status with the push/pull counts and conflict count", async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        url.includes("/sync/push")
          ? jsonResponse({ accepted: [], rejected: [], total: 0 })
          : jsonResponse({ records: [], serverSeq: 2000 }),
      ),
    );

    await syncNow(session, database);

    const status = await getLastSyncStatus(database);
    expect(status).toMatchObject({ success: true, pushed: 0, pulled: 0, deleted: 0, conflicts: 0 });
  });

  it("records the conflict count when some pushed records were rejected", async () => {
    await seedAccountRow("acc-1", 1000, 5);
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        url.includes("/sync/push")
          ? jsonResponse({
              accepted: [],
              rejected: [
                {
                  tableName: "accounts",
                  id: "acc-1",
                  current: {
                    tableName: "accounts",
                    id: "acc-1",
                    structural: {},
                    encData: { iv: "iv", data: "server-version" },
                    createdAt: 1000,
                    updatedAt: 9000,
                    deletedAt: null,
                    seq: 99,
                  },
                },
              ],
              total: 1,
            })
          : jsonResponse({ records: [], serverSeq: 99 }),
      ),
    );

    await syncNow(session, database);

    const status = await getLastSyncStatus(database);
    expect(status).toMatchObject({ success: true, conflicts: 1 });
  });

  it("records a failed status with the error message, and still throws", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "Session invalide." }, false, 401));

    await expect(syncNow(session, database)).rejects.toThrow();

    const status = await getLastSyncStatus(database);
    expect(status).toMatchObject({
      success: false,
      error: expect.stringMatching(/session invalide/i),
    });
  });

  it("overwrites the previous status with each new attempt", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "Panne serveur." }, false, 500));
    await expect(syncNow(session, database)).rejects.toThrow();

    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        url.includes("/sync/push")
          ? jsonResponse({ accepted: [], rejected: [], total: 0 })
          : jsonResponse({ records: [], serverSeq: 2000 }),
      ),
    );
    await syncNow(session, database);

    const status = await getLastSyncStatus(database);
    expect(status?.success).toBe(true);
  });
});

describe("getLastSyncStatus", () => {
  it("returns undefined when no sync has ever been attempted", async () => {
    expect(await getLastSyncStatus(database)).toBeUndefined();
  });
});
