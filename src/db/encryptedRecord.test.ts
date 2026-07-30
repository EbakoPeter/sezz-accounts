import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  toStorageRow,
  fromStorageRow,
  fromStorageRows,
  fromStorageRowOrUndefined,
  DecryptionError,
} from "./encryptedRecord";
import { setActiveDek, clearActiveDek } from "@/lib/encryptionSession";
import { generateDekBytes } from "@/lib/encryption";

interface Fixture {
  id: string;
  createdAt: number;
  updatedAt: number;
  name: string;
  amount: number;
}

const SENSITIVE_FIELDS = ["name", "amount"] as const;

beforeEach(() => {
  setActiveDek(generateDekBytes());
});

afterEach(() => {
  clearActiveDek();
});

describe("toStorageRow / fromStorageRow round-trip", () => {
  it("recovers the original record", async () => {
    const record: Fixture = { id: "1", createdAt: 1, updatedAt: 1, name: "Test", amount: 500 };
    const row = await toStorageRow(record, SENSITIVE_FIELDS);
    const recovered = await fromStorageRow<Fixture>(row);
    expect(recovered).toEqual(record);
  });

  it("keeps structural fields readable on the row itself, unencrypted", async () => {
    const record: Fixture = { id: "1", createdAt: 1, updatedAt: 1, name: "Test", amount: 500 };
    const row = await toStorageRow(record, SENSITIVE_FIELDS);
    expect(row.id).toBe("1");
    expect(row.createdAt).toBe(1);
    expect("name" in row).toBe(false);
    expect("amount" in row).toBe(false);
  });
});

describe("fromStorageRow with a mismatched key", () => {
  it("throws DecryptionError, not the raw Web Crypto error", async () => {
    const record: Fixture = { id: "1", createdAt: 1, updatedAt: 1, name: "Test", amount: 500 };
    const row = await toStorageRow(record, SENSITIVE_FIELDS);

    // simulates receiving this row from another device/session whose DEK
    // this one never had — exactly the multi-device-sync scenario
    // DecryptionError's own message describes.
    setActiveDek(generateDekBytes());

    await expect(fromStorageRow<Fixture>(row)).rejects.toThrow(DecryptionError);
  });
});

describe("fromStorageRows resilience", () => {
  it("returns every record when all decrypt successfully", async () => {
    const records: Fixture[] = [
      { id: "1", createdAt: 1, updatedAt: 1, name: "A", amount: 100 },
      { id: "2", createdAt: 2, updatedAt: 2, name: "B", amount: 200 },
    ];
    const rows = await Promise.all(records.map((r) => toStorageRow(r, SENSITIVE_FIELDS)));

    const recovered = await fromStorageRows<Fixture>(rows);

    expect(recovered).toHaveLength(2);
  });

  it("excludes only the undecryptable record, returning the rest — does not fail the whole batch", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // encrypted under the DEK active right now (set in beforeEach), then
    // restore it explicitly after creating the mismatched row below, since
    // that's what will be active when we read both rows back.
    const originalDek = generateDekBytes();
    setActiveDek(originalDek);
    const goodRow = await toStorageRow<Fixture, "name" | "amount">(
      { id: "1", createdAt: 1, updatedAt: 1, name: "A", amount: 100 },
      SENSITIVE_FIELDS,
    );

    // encrypted under a DIFFERENT key, simulating a record pulled in via
    // sync from a device with a different DEK
    setActiveDek(generateDekBytes());
    const mismatchedRow = await toStorageRow<Fixture, "name" | "amount">(
      { id: "2", createdAt: 2, updatedAt: 2, name: "B", amount: 200 },
      SENSITIVE_FIELDS,
    );
    setActiveDek(originalDek);

    const recovered = await fromStorageRows<Fixture>([goodRow, mismatchedRow]);

    expect(recovered).toHaveLength(1);
    expect(recovered[0]?.id).toBe("1");
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });
});

describe("fromStorageRowOrUndefined", () => {
  it("returns the decrypted record when it decrypts successfully", async () => {
    const record: Fixture = { id: "1", createdAt: 1, updatedAt: 1, name: "Test", amount: 500 };
    const row = await toStorageRow(record, SENSITIVE_FIELDS);

    const recovered = await fromStorageRowOrUndefined<Fixture>(row);

    expect(recovered).toEqual(record);
  });

  it("returns undefined instead of throwing when the record was encrypted under a different key", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const record: Fixture = { id: "1", createdAt: 1, updatedAt: 1, name: "Test", amount: 500 };
    const row = await toStorageRow(record, SENSITIVE_FIELDS);

    // same mismatched-key scenario as fromStorageRow's own test above —
    // this is the one that must NOT throw, unlike that one
    setActiveDek(generateDekBytes());

    const recovered = await fromStorageRowOrUndefined<Fixture>(row);

    expect(recovered).toBeUndefined();
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it("returns undefined when given undefined, matching a plain 'not found' getById() result", async () => {
    const recovered = await fromStorageRowOrUndefined<Fixture>(undefined);
    expect(recovered).toBeUndefined();
  });

  it("still propagates an error that genuinely isn't a decryption failure", async () => {
    const record: Fixture = { id: "1", createdAt: 1, updatedAt: 1, name: "Test", amount: 500 };
    const row = await toStorageRow(record, SENSITIVE_FIELDS);
    clearActiveDek(); // requireActiveDek() throws its own, different error

    await expect(fromStorageRowOrUndefined<Fixture>(row)).rejects.toThrow(/session chiffrée/i);
  });
});
