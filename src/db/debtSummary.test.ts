import { describe, it, expect, beforeEach } from "vitest";
import { useTestEncryptionSession } from "@/test/testDek";
import { createTestDatabase } from "@/test/testDatabase";
import type { SezzAccountsDatabase } from "@/db/schema";
import { createAccountsRepository } from "./accountsRepository";
import { createDebtsRepository, type DebtsRepository } from "./debtsRepository";
import {
  createDebtPaymentsRepository,
  type DebtPaymentsRepository,
} from "./debtPaymentsRepository";
import { getDebtSummary, getAllDebtSummaries, monthsBetween } from "./debtSummary";

describe("monthsBetween", () => {
  it("counts whole calendar months", () => {
    expect(monthsBetween("2026-01-01", "2026-07-01")).toBe(6);
  });

  it("returns at least 1 even for the same month", () => {
    expect(monthsBetween("2026-01-01", "2026-01-15")).toBe(1);
  });

  it("returns at least 1 even if to < from (never zero/negative)", () => {
    expect(monthsBetween("2026-06-01", "2026-01-01")).toBe(1);
  });

  it("handles a year boundary", () => {
    expect(monthsBetween("2025-11-01", "2026-02-01")).toBe(3);
  });
});

describe("getDebtSummary / getAllDebtSummaries", () => {
  useTestEncryptionSession();
  let database: SezzAccountsDatabase;
  let debts: DebtsRepository;
  let payments: DebtPaymentsRepository;
  let accountId: string;

  beforeEach(async () => {
    database = createTestDatabase();
    const accounts = createAccountsRepository(database);
    debts = createDebtsRepository(database);
    payments = createDebtPaymentsRepository(database);
    accountId = (await accounts.create({ name: "Compte", initialBalance: 0 })).id;
  });

  it("returns undefined for a non-existent debt", async () => {
    expect(await getDebtSummary("nope", database)).toBeUndefined();
  });

  it("computes plannedMonthlyPayment from amount and months until due date", async () => {
    const debt = await debts.create({
      kind: "debt",
      counterparty: "Banque",
      accountId,
      amount: 600000,
      date: "2026-01-01",
      dueDate: "2026-07-01",
    });
    const summary = await getDebtSummary(debt.id, database);
    expect(summary?.plannedMonthlyPayment).toBe(100000); // 600000 / 6
  });

  it("plannedMonthlyPayment is null when there is no due date", async () => {
    const debt = await debts.create({
      kind: "debt",
      counterparty: "Banque",
      accountId,
      amount: 600000,
      date: "2026-01-01",
    });
    const summary = await getDebtSummary(debt.id, database);
    expect(summary?.plannedMonthlyPayment).toBeNull();
  });

  it("status is 'ongoing' when unpaid and not overdue", async () => {
    const debt = await debts.create({
      kind: "debt",
      counterparty: "X",
      accountId,
      amount: 1000,
      date: "2026-01-01",
      dueDate: "2026-12-01",
    });
    const summary = await getDebtSummary(debt.id, database, "2026-06-01");
    expect(summary?.status).toBe("ongoing");
    expect(summary?.remaining).toBe(1000);
  });

  it("status is 'settled' once fully paid, even past the due date", async () => {
    const debt = await debts.create({
      kind: "debt",
      counterparty: "X",
      accountId,
      amount: 1000,
      date: "2026-01-01",
      dueDate: "2026-02-01",
    });
    await payments.create({ debtId: debt.id, accountId, amount: 1000, date: "2026-01-15" });
    const summary = await getDebtSummary(debt.id, database, "2026-12-31");
    expect(summary?.status).toBe("settled");
    expect(summary?.remaining).toBe(0);
  });

  it("status is 'overdue' when unpaid and past the due date", async () => {
    const debt = await debts.create({
      kind: "debt",
      counterparty: "X",
      accountId,
      amount: 1000,
      date: "2026-01-01",
      dueDate: "2026-02-01",
    });
    const summary = await getDebtSummary(debt.id, database, "2026-03-01");
    expect(summary?.status).toBe("overdue");
  });

  it("status is 'ongoing' (not 'overdue') when there is no due date at all", async () => {
    const debt = await debts.create({
      kind: "debt",
      counterparty: "X",
      accountId,
      amount: 1000,
      date: "2026-01-01",
    });
    const summary = await getDebtSummary(debt.id, database, "2030-01-01");
    expect(summary?.status).toBe("ongoing");
  });

  it("partial payments reduce remaining without changing status prematurely", async () => {
    const debt = await debts.create({
      kind: "debt",
      counterparty: "X",
      accountId,
      amount: 1000,
      date: "2026-01-01",
      dueDate: "2026-12-01",
    });
    await payments.create({ debtId: debt.id, accountId, amount: 400, date: "2026-02-01" });
    const summary = await getDebtSummary(debt.id, database, "2026-06-01");
    expect(summary?.totalPaid).toBe(400);
    expect(summary?.remaining).toBe(600);
    expect(summary?.status).toBe("ongoing");
  });

  it("getAllDebtSummaries returns every debt, sorted most recent first", async () => {
    await debts.create({
      kind: "debt",
      counterparty: "A",
      accountId,
      amount: 100,
      date: "2026-01-01",
    });
    await debts.create({
      kind: "receivable",
      counterparty: "B",
      accountId,
      amount: 200,
      date: "2026-03-01",
    });
    const summaries = await getAllDebtSummaries(database);
    expect(summaries).toHaveLength(2);
    expect(summaries[0]?.debt.counterparty).toBe("B");
  });

  it("gives the same result to concurrent callers as to a single caller", async () => {
    await debts.create({
      kind: "debt",
      counterparty: "A",
      accountId,
      amount: 5000,
      date: "2026-01-01",
    });

    // the actual scenario this exists for — DebtsPanel and
    // RecommendationsPanel each independently reading debts+payments
    const [a, b] = await Promise.all([
      getAllDebtSummaries(database, "2026-06-01"),
      getAllDebtSummaries(database, "2026-06-01"),
    ]);
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0]?.remaining).toBe(b[0]?.remaining);
  });

  it("never serves a stale result: a write between two calls is always reflected", async () => {
    const before = await getAllDebtSummaries(database);
    expect(before).toHaveLength(0);

    await debts.create({
      kind: "debt",
      counterparty: "A",
      accountId,
      amount: 5000,
      date: "2026-01-01",
    });

    const after = await getAllDebtSummaries(database);
    expect(after).toHaveLength(1);
  });

  it("does not share a result across two different 'today' values, since status depends on it", async () => {
    await debts.create({
      kind: "debt",
      counterparty: "A",
      accountId,
      amount: 5000,
      date: "2026-01-01",
      dueDate: "2026-02-01",
    });

    const [beforeDue, afterDue] = await Promise.all([
      getAllDebtSummaries(database, "2026-01-15"),
      getAllDebtSummaries(database, "2026-03-01"),
    ]);
    expect(beforeDue[0]?.status).toBe("ongoing");
    expect(afterDue[0]?.status).toBe("overdue");
  });
});
