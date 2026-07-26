import { describe, it, expect, beforeEach } from "vitest";
import { useTestEncryptionSession } from "@/test/testDek";
import { createTestDatabase } from "@/test/testDatabase";
import type { SezzAccountsDatabase } from "@/db/schema";
import { createAccountsRepository, type AccountsRepository } from "@/db/accountsRepository";
import {
  createTransactionsRepository,
  type TransactionsRepository,
} from "@/db/transactionsRepository";
import { createTransfersRepository, type TransfersRepository } from "@/db/transfersRepository";
import { createDebtsRepository, type DebtsRepository } from "@/db/debtsRepository";
import {
  createDebtPaymentsRepository,
  type DebtPaymentsRepository,
} from "@/db/debtPaymentsRepository";
import { getCashFlowOverTime } from "./cashFlow";

describe("getCashFlowOverTime", () => {
  useTestEncryptionSession();
  let database: SezzAccountsDatabase;
  let accounts: AccountsRepository;
  let transactions: TransactionsRepository;
  let transfers: TransfersRepository;
  let debts: DebtsRepository;
  let payments: DebtPaymentsRepository;

  beforeEach(() => {
    database = createTestDatabase();
    accounts = createAccountsRepository(database);
    transactions = createTransactionsRepository(database);
    transfers = createTransfersRepository(database);
    debts = createDebtsRepository(database);
    payments = createDebtPaymentsRepository(database);
  });

  it("returns one point per month in the range, in chronological order", async () => {
    const points = await getCashFlowOverTime(database, "2030-01", "2030-03");
    expect(points.map((p) => p.date)).toEqual(["2030-01-31", "2030-02-28", "2030-03-31"]);
  });

  it("returns a single point when from and to are the same month", async () => {
    const points = await getCashFlowOverTime(database, "2030-01", "2030-01");
    expect(points).toHaveLength(1);
  });

  it("handles a range spanning a year boundary", async () => {
    const points = await getCashFlowOverTime(database, "2025-12", "2026-02");
    expect(points.map((p) => p.date)).toEqual(["2025-12-31", "2026-01-31", "2026-02-28"]);
  });

  it("shows the initial balance at every point when nothing else happened", async () => {
    const account = await accounts.create({ name: "Compte", initialBalance: 10000 });
    const points = await getCashFlowOverTime(database, "2030-01", "2030-02");
    expect(points[0]?.byAccount.get(account.id)).toBe(10000);
    expect(points[1]?.byAccount.get(account.id)).toBe(10000);
  });

  it("only counts a transaction in months on or after its own date", async () => {
    const account = await accounts.create({ name: "Compte", initialBalance: 0 });
    await transactions.create({
      accountId: account.id,
      kind: "income",
      date: "2030-02-15",
      label: "Salaire",
      amount: 5000,
    });

    const points = await getCashFlowOverTime(database, "2030-01", "2030-03");
    expect(points[0]?.byAccount.get(account.id)).toBe(0); // January: before
    expect(points[1]?.byAccount.get(account.id)).toBe(5000); // February: same month
    expect(points[2]?.byAccount.get(account.id)).toBe(5000); // March: still counted (cumulative)
  });

  it("subtracts expenses the same way", async () => {
    const account = await accounts.create({ name: "Compte", initialBalance: 10000 });
    await transactions.create({
      accountId: account.id,
      kind: "expense",
      date: "2030-01-10",
      label: "Loyer",
      amount: 3000,
    });

    const points = await getCashFlowOverTime(database, "2030-01", "2030-01");
    expect(points[0]?.byAccount.get(account.id)).toBe(7000);
  });

  it("reflects a transfer on both accounts from the month it happened", async () => {
    const from = await accounts.create({ name: "Source", initialBalance: 20000 });
    const to = await accounts.create({ name: "Destination", initialBalance: 0 });
    await transfers.create({
      fromAccountId: from.id,
      toAccountId: to.id,
      amount: 5000,
      date: "2030-01-15",
    });

    const points = await getCashFlowOverTime(database, "2030-01", "2030-01");
    expect(points[0]?.byAccount.get(from.id)).toBe(15000);
    expect(points[0]?.byAccount.get(to.id)).toBe(5000);
  });

  it("reflects a debt (borrowed) as an inflow and a receivable (lent) as an outflow", async () => {
    const account = await accounts.create({ name: "Compte", initialBalance: 0 });
    await debts.create({
      kind: "debt",
      counterparty: "Banque",
      accountId: account.id,
      amount: 10000,
      date: "2030-01-05",
    });
    await debts.create({
      kind: "receivable",
      counterparty: "Ami",
      accountId: account.id,
      amount: 4000,
      date: "2030-01-06",
    });

    const points = await getCashFlowOverTime(database, "2030-01", "2030-01");
    expect(points[0]?.byAccount.get(account.id)).toBe(6000); // +10000 - 4000
  });

  it("reflects a debt payment as the opposite direction of its debt", async () => {
    const account = await accounts.create({ name: "Compte", initialBalance: 0 });
    const debt = await debts.create({
      kind: "debt",
      counterparty: "Banque",
      accountId: account.id,
      amount: 10000,
      date: "2030-01-01",
    });
    await payments.create({
      debtId: debt.id,
      accountId: account.id,
      amount: 3000,
      date: "2030-01-20",
    });

    const points = await getCashFlowOverTime(database, "2030-01", "2030-01");
    expect(points[0]?.byAccount.get(account.id)).toBe(7000); // +10000 - 3000
  });

  it("excludes an account from a range entirely before it was created", async () => {
    // accounts.create() always stamps createdAt as "now" (2026 in this
    // test environment) — a cutoff of 2020 is unambiguously before that
    const account = await accounts.create({ name: "Compte", initialBalance: 5000 });
    const points = await getCashFlowOverTime(database, "2020-01", "2020-01");
    expect(points[0]?.byAccount.has(account.id)).toBe(false);
    expect(points[0]?.total).toBe(0);
  });

  it("sums every account into the total for each point", async () => {
    await accounts.create({ name: "A", initialBalance: 5000 });
    await accounts.create({ name: "B", initialBalance: 3000 });
    const points = await getCashFlowOverTime(database, "2030-01", "2030-01");
    expect(points[0]?.total).toBe(8000);
  });
});
