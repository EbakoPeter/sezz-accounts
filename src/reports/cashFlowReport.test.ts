import { describe, it, expect, beforeEach } from "vitest";
import { useTestEncryptionSession } from "@/test/testDek";
import { createTestDatabase } from "@/test/testDatabase";
import type { SezzAccountsDatabase } from "@/db/schema";
import { createAccountsRepository } from "@/db/accountsRepository";
import { generateCashFlowReportPdf } from "./cashFlowReport";

describe("generateCashFlowReportPdf", () => {
  useTestEncryptionSession();
  let database: SezzAccountsDatabase;

  beforeEach(() => {
    database = createTestDatabase();
  });

  it("produces a valid PDF document with no accounts", async () => {
    const doc = await generateCashFlowReportPdf(database, "2030-01", "2030-03");
    expect(doc.output().startsWith("%PDF")).toBe(true);
  });

  it("includes a column per account without throwing", async () => {
    const accounts = createAccountsRepository(database);
    await accounts.create({ name: "Courant", initialBalance: 100000 });
    await accounts.create({ name: "Épargne", initialBalance: 50000 });

    const doc = await generateCashFlowReportPdf(database, "2030-01", "2030-03");
    expect(doc.output().startsWith("%PDF")).toBe(true);
    expect(doc.output().length).toBeGreaterThan(500);
  });
});
