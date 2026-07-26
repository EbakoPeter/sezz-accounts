import { describe, it, expect, beforeEach } from "vitest";
import { useTestEncryptionSession } from "@/test/testDek";
import { createTestDatabase } from "@/test/testDatabase";
import type { SezzAccountsDatabase } from "@/db/schema";
import { createAccountsRepository } from "@/db/accountsRepository";
import { createTransactionsRepository } from "@/db/transactionsRepository";
import { generateOperationsReportPdf } from "./operationsReport";

describe("generateOperationsReportPdf", () => {
  useTestEncryptionSession();
  let database: SezzAccountsDatabase;
  let accountId: string;

  beforeEach(async () => {
    database = createTestDatabase();
    const accounts = createAccountsRepository(database);
    accountId = (await accounts.create({ name: "Compte", initialBalance: 0 })).id;
  });

  it("produces a valid PDF document with no transactions", async () => {
    const doc = await generateOperationsReportPdf(database, "2030-01-01", "2030-01-31");
    const output = doc.output();
    expect(output.startsWith("%PDF")).toBe(true);
  });

  it("produces a larger document as more transactions are included", async () => {
    const transactions = createTransactionsRepository(database);
    const empty = await generateOperationsReportPdf(database, "2030-06-01", "2030-06-30");
    for (let i = 0; i < 20; i++) {
      await transactions.create({
        accountId,
        kind: "expense",
        date: `2030-01-${String((i % 27) + 1).padStart(2, "0")}`,
        label: `Dépense ${i}`,
        amount: 1000 + i,
      });
    }
    const withData = await generateOperationsReportPdf(database, "2030-01-01", "2030-01-31");
    expect(withData.output().length).toBeGreaterThan(empty.output().length);
  });

  it("excludes transactions outside the requested range", async () => {
    const transactions = createTransactionsRepository(database);
    await transactions.create({
      accountId,
      kind: "expense",
      date: "2030-02-01",
      label: "Hors période",
      amount: 999999,
    });

    const withOutOfRange = await generateOperationsReportPdf(database, "2030-01-01", "2030-01-31");
    const empty = await generateOperationsReportPdf(database, "2030-03-01", "2030-03-31");
    // both should be effectively the same size: the out-of-range
    // transaction contributes nothing to the January report
    expect(Math.abs(withOutOfRange.output().length - empty.output().length)).toBeLessThan(50);
  });
});
