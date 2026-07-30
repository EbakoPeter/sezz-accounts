import { describe, it, expect, beforeEach } from "vitest";
import { useTestEncryptionSession } from "@/test/testDek";
import { createTestDatabase } from "@/test/testDatabase";
import type { SezzAccountsDatabase } from "@/db/schema";
import { createAccountsRepository } from "@/db/accountsRepository";
import { generateOperationsReportPdf } from "./operationsReport";
import { encryptedFixture } from "@/test/encryptedFixture";
import { generateId } from "@/lib/id";
import type { Transaction } from "@/types/models";

describe("generateOperationsReportPdf", () => {
  useTestEncryptionSession();
  let database: SezzAccountsDatabase;
  let accountId: string;

  beforeEach(async () => {
    database = createTestDatabase();
    const accounts = createAccountsRepository(database);
    accountId = (await accounts.create({ name: "Compte", initialBalance: 0 })).id;
  });

  /** Seeds an expense directly, bypassing transactions.create() — that
   * repository now requires every expense to settle an existing
   * engagement (see transactionsRepository.ts), which this pure-reader's
   * tests have no need to set up just to prove report content. */
  async function seedExpenseDirectly(overrides: { date: string; label: string; amount: number }) {
    const now = Date.now();
    await database.transactions.add(
      await encryptedFixture<Transaction, "label" | "amount" | "note">(
        {
          id: generateId(),
          accountId,
          kind: "expense",
          date: overrides.date,
          label: overrides.label,
          amount: overrides.amount,
          createdAt: now,
          updatedAt: now,
        },
        ["label", "amount", "note"],
      ),
    );
  }

  it("produces a valid PDF document with no transactions", async () => {
    const doc = await generateOperationsReportPdf(database, "2030-01-01", "2030-01-31");
    const output = doc.output();
    expect(output.startsWith("%PDF")).toBe(true);
  });

  it("produces a larger document as more transactions are included", async () => {
    const empty = await generateOperationsReportPdf(database, "2030-06-01", "2030-06-30");
    for (let i = 0; i < 20; i++) {
      await seedExpenseDirectly({
        date: `2030-01-${String((i % 27) + 1).padStart(2, "0")}`,
        label: `Dépense ${i}`,
        amount: 1000 + i,
      });
    }
    const withData = await generateOperationsReportPdf(database, "2030-01-01", "2030-01-31");
    expect(withData.output().length).toBeGreaterThan(empty.output().length);
  });

  it("excludes transactions outside the requested range", async () => {
    await seedExpenseDirectly({ date: "2030-02-01", label: "Hors période", amount: 999999 });

    const withOutOfRange = await generateOperationsReportPdf(database, "2030-01-01", "2030-01-31");
    const empty = await generateOperationsReportPdf(database, "2030-03-01", "2030-03-31");
    // both should be effectively the same size: the out-of-range
    // transaction contributes nothing to the January report
    expect(Math.abs(withOutOfRange.output().length - empty.output().length)).toBeLessThan(50);
  });

  it("restricts the report to just one kind when the kind filter is given", async () => {
    await seedExpenseDirectly({ date: "2030-01-05", label: "Dépense filtrée", amount: 5000 });
    const now = Date.now();
    await database.transactions.add(
      await encryptedFixture<Transaction, "label" | "amount" | "note">(
        {
          id: generateId(),
          accountId,
          kind: "income",
          date: "2030-01-10",
          label: "Revenu filtré",
          amount: 8000,
          createdAt: now,
          updatedAt: now,
        },
        ["label", "amount", "note"],
      ),
    );

    const everything = await generateOperationsReportPdf(database, "2030-01-01", "2030-01-31");
    const incomeOnly = await generateOperationsReportPdf(
      database,
      "2030-01-01",
      "2030-01-31",
      "income",
    );
    const expenseOnly = await generateOperationsReportPdf(
      database,
      "2030-01-01",
      "2030-01-31",
      "expense",
    );

    // each filtered report only has one row's worth of content, so both
    // should be meaningfully smaller than the unfiltered one with both
    expect(incomeOnly.output().length).toBeLessThan(everything.output().length);
    expect(expenseOnly.output().length).toBeLessThan(everything.output().length);
  });
});
