import { describe, it, expect, beforeEach } from "vitest";
import { createTestDatabase } from "@/test/testDatabase";
import type { SezzAccountsDatabase } from "@/db/schema";
import {
  buildBackup,
  parseBackup,
  summarizeBackup,
  restoreBackup,
  InvalidBackupError,
} from "./backupEngine";

let database: SezzAccountsDatabase;

beforeEach(() => {
  database = createTestDatabase();
});

async function seedAccount(id: string) {
  await database.accounts.put({
    id,
    createdAt: 1000,
    updatedAt: 1000,
    _enc: { iv: "iv", data: `data-${id}` },
  });
}

describe("buildBackup", () => {
  it("includes every syncable table's rows", async () => {
    await seedAccount("acc-1");
    await database.transactions.put({
      id: "tx-1",
      accountId: "acc-1",
      kind: "expense",
      date: "2026-01-01",
      createdAt: 1000,
      updatedAt: 1000,
      _enc: { iv: "iv", data: "tx-data" },
    });

    const backup = await buildBackup(database);

    expect(backup.tables.accounts).toHaveLength(1);
    expect(backup.tables.transactions).toHaveLength(1);
    expect(backup.tables.accounts?.[0]).toMatchObject({ id: "acc-1" });
  });

  it("stamps a version and an export timestamp", async () => {
    const before = Date.now();
    const backup = await buildBackup(database);
    expect(backup.version).toBe(1);
    expect(backup.exportedAt).toBeGreaterThanOrEqual(before);
  });

  it("produces an empty-but-valid backup for a fresh database", async () => {
    const backup = await buildBackup(database);
    expect(backup.tables.accounts).toEqual([]);
  });
});

describe("parseBackup", () => {
  it("parses a valid backup file's JSON content", () => {
    const content = JSON.stringify({ version: 1, exportedAt: 1000, tables: { accounts: [] } });
    const backup = parseBackup(content);
    expect(backup.version).toBe(1);
  });

  it("rejects content that isn't valid JSON at all", () => {
    expect(() => parseBackup("this is not json{{{")).toThrow(InvalidBackupError);
  });

  it("rejects valid JSON that isn't shaped like a backup", () => {
    expect(() => parseBackup(JSON.stringify({ hello: "world" }))).toThrow(InvalidBackupError);
  });

  it("rejects a backup from an incompatible/future format version", () => {
    const content = JSON.stringify({ version: 999, exportedAt: 1000, tables: {} });
    expect(() => parseBackup(content)).toThrow(InvalidBackupError);
    expect(() => parseBackup(content)).toThrow(/incompatible/i);
  });

  it("rejects a backup with no tables object", () => {
    const content = JSON.stringify({ version: 1, exportedAt: 1000 });
    expect(() => parseBackup(content)).toThrow(InvalidBackupError);
  });
});

describe("summarizeBackup", () => {
  it("counts total records across every table", () => {
    const backup = {
      version: 1,
      exportedAt: 1000,
      tables: {
        accounts: [{ id: "a" }, { id: "b" }],
        transactions: [{ id: "c" }],
      },
    };
    const summary = summarizeBackup(backup);
    expect(summary.totalRecords).toBe(3);
    expect(summary.exportedAt).toBe(1000);
  });

  it("returns zero for a backup with no data in any table", () => {
    const summary = summarizeBackup({ version: 1, exportedAt: 1000, tables: {} });
    expect(summary.totalRecords).toBe(0);
  });
});

describe("restoreBackup", () => {
  it("round-trips: exporting then restoring reproduces the same data", async () => {
    await seedAccount("acc-1");
    const backup = await buildBackup(database);

    const fresh = createTestDatabase();
    const result = await restoreBackup(backup, fresh);

    expect(result.restored).toBe(1);
    const row = await fresh.accounts.get("acc-1");
    expect(row).toMatchObject({ id: "acc-1", _enc: { iv: "iv", data: "data-acc-1" } });
  });

  it("replaces (does not merge with) whatever was already in each table", async () => {
    await seedAccount("acc-existing");
    const backup = {
      version: 1,
      exportedAt: 2000,
      tables: {
        accounts: [
          {
            id: "acc-from-backup",
            createdAt: 1000,
            updatedAt: 1000,
            _enc: { iv: "iv", data: "d" },
          },
        ],
      },
    };

    await restoreBackup(backup, database);

    expect(await database.accounts.get("acc-existing")).toBeUndefined();
    expect(await database.accounts.get("acc-from-backup")).toBeDefined();
  });

  it("clears the local deletion log", async () => {
    await database.deletionLog.add({
      tableName: "accounts",
      recordId: "acc-1",
      deletedAt: 1000,
      baseSeq: 0,
    });
    const backup = await buildBackup(database);

    await restoreBackup(backup, database);

    expect(await database.deletionLog.count()).toBe(0);
  });

  it("resets the sync push/pull cursors", async () => {
    await database.syncConfig.put({ key: "lastPushedAt", value: "12345" });
    await database.syncConfig.put({ key: "lastPulledSeq", value: "999" });
    const backup = await buildBackup(database);

    await restoreBackup(backup, database);

    expect(await database.syncConfig.get("lastPushedAt")).toBeUndefined();
    expect(await database.syncConfig.get("lastPulledSeq")).toBeUndefined();
  });

  it("does not touch the configured sync server/account", async () => {
    await database.syncConfig.put({ key: "serverUrl", value: "https://sync.example.com" });
    await database.syncConfig.put({ key: "token", value: "a-real-token" });
    const backup = await buildBackup(database);

    await restoreBackup(backup, database);

    expect((await database.syncConfig.get("serverUrl"))?.value).toBe("https://sync.example.com");
    expect((await database.syncConfig.get("token"))?.value).toBe("a-real-token");
  });

  it("handles a table missing from the backup as empty, rather than throwing", async () => {
    await seedAccount("acc-1");
    const backup = { version: 1, exportedAt: 1000, tables: {} };

    await expect(restoreBackup(backup, database)).resolves.toMatchObject({ restored: 0 });
    expect(await database.accounts.count()).toBe(0);
  });

  it("rejects an invalid backup rather than partially applying it", async () => {
    await seedAccount("acc-kept");

    await expect(restoreBackup({ nonsense: true } as never, database)).rejects.toThrow(
      InvalidBackupError,
    );
    expect(await database.accounts.get("acc-kept")).toBeDefined();
  });
});
