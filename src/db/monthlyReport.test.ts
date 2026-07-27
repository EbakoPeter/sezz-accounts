import { describe, it, expect, beforeEach } from "vitest";
import { createTestDatabase } from "@/test/testDatabase";
import { useTestEncryptionSession } from "@/test/testDek";
import { encryptedFixture } from "@/test/encryptedFixture";
import type { SezzAccountsDatabase } from "@/db/schema";
import { createAccountsRepository } from "./accountsRepository";
import { createTransactionsRepository } from "./transactionsRepository";
import { getMonthlyReport } from "./monthlyReport";
import type { Debt, DebtPayment, Transaction } from "@/types/models";
import { generateId } from "@/lib/id";

describe("getMonthlyReport", () => {
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
   * tests have no need to set up. */
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

  it("returns 12 rows, January through December, in that order, even with no data", async () => {
    const rows = await getMonthlyReport(2026, database);
    expect(rows).toHaveLength(12);
    expect(rows.map((r) => r.month)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(rows.every((r) => r.income === 0 && r.expense === 0 && r.net === 0)).toBe(true);
  });

  it("sums income and expense into the correct month", async () => {
    const transactions = createTransactionsRepository(database);
    await transactions.create({
      accountId,
      kind: "income",
      date: "2026-03-05",
      label: "Salaire",
      amount: 300000,
    });
    await seedExpenseDirectly({ date: "2026-03-20", label: "Loyer", amount: 100000 });

    const rows = await getMonthlyReport(2026, database);
    const march = rows.find((r) => r.month === 3)!;
    expect(march.income).toBe(300000);
    expect(march.expense).toBe(100000);
    expect(march.net).toBe(200000);
  });

  it("excludes transactions from a different year", async () => {
    const transactions = createTransactionsRepository(database);
    await transactions.create({
      accountId,
      kind: "income",
      date: "2025-03-05",
      label: "Autre année",
      amount: 999999,
    });

    const rows = await getMonthlyReport(2026, database);
    expect(rows.every((r) => r.income === 0)).toBe(true);
  });

  it("accumulates cumulativeNet across months within the year", async () => {
    const transactions = createTransactionsRepository(database);
    await transactions.create({
      accountId,
      kind: "income",
      date: "2026-01-10",
      label: "A",
      amount: 1000,
    });
    await seedExpenseDirectly({ date: "2026-02-10", label: "B", amount: 300 });
    await transactions.create({
      accountId,
      kind: "income",
      date: "2026-03-10",
      label: "C",
      amount: 500,
    });

    const rows = await getMonthlyReport(2026, database);
    expect(rows.find((r) => r.month === 1)?.cumulativeNet).toBe(1000);
    expect(rows.find((r) => r.month === 2)?.cumulativeNet).toBe(700);
    expect(rows.find((r) => r.month === 3)?.cumulativeNet).toBe(1200);
    expect(rows.find((r) => r.month === 12)?.cumulativeNet).toBe(1200);
  });

  it("resets cumulativeNet at the start of a new year (no carryover across years)", async () => {
    const transactions = createTransactionsRepository(database);
    await transactions.create({
      accountId,
      kind: "income",
      date: "2025-12-31",
      label: "Fin d'année précédente",
      amount: 999999,
    });
    await transactions.create({
      accountId,
      kind: "income",
      date: "2026-01-05",
      label: "Début d'année",
      amount: 100,
    });

    const rows = await getMonthlyReport(2026, database);
    expect(rows.find((r) => r.month === 1)?.cumulativeNet).toBe(100);
  });

  it("does NOT count debts or debt payments as income/expense", async () => {
    const debt: Debt = {
      id: "d1",
      reference: "D01",
      kind: "debt",
      counterparty: "Banque",
      accountId,
      amount: 500000,
      date: "2026-01-01",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await database.debts.add(
      await encryptedFixture(debt, ["counterparty", "amount", "dueDate", "description"] as const),
    );
    const payment: DebtPayment = {
      id: "p1",
      debtId: "d1",
      accountId,
      amount: 50000,
      date: "2026-02-01",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await database.debtPayments.add(await encryptedFixture(payment, ["amount"] as const));

    const rows = await getMonthlyReport(2026, database);
    expect(rows.every((r) => r.income === 0 && r.expense === 0)).toBe(true);
  });

  it("ignores a malformed/empty date defensively rather than throwing", async () => {
    const tx: Transaction = {
      id: "bad-tx",
      accountId,
      kind: "income",
      date: "",
      label: "Corrompu",
      amount: 100,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await database.transactions.add(
      await encryptedFixture(tx, ["label", "amount", "note"] as const),
    );
    await expect(getMonthlyReport(2026, database)).resolves.toBeDefined();
  });
});
