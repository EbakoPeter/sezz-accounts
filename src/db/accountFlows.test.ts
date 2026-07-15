import { describe, it, expect, beforeEach } from "vitest";
import { createTestDatabase } from "@/test/testDatabase";
import type { SezzAccountsDatabase } from "@/db/schema";
import { createAccountsRepository } from "./accountsRepository";
import { createTransactionsRepository } from "./transactionsRepository";
import { getAccountFlows, netOf } from "./accountFlows";

describe("getAccountFlows", () => {
  let database: SezzAccountsDatabase;
  let accountId: string;

  beforeEach(async () => {
    database = createTestDatabase();
    const accounts = createAccountsRepository(database);
    accountId = (await accounts.create({ name: "Compte", initialBalance: 0 })).id;
  });

  it("returns an empty map when nothing has happened yet", async () => {
    const flows = await getAccountFlows(database);
    expect(flows.size).toBe(0);
  });

  it("counts transaction income as inflow and expense as outflow", async () => {
    const transactions = createTransactionsRepository(database);
    await transactions.create({
      accountId,
      kind: "income",
      date: "2026-01-01",
      label: "Salaire",
      amount: 1000,
    });
    await transactions.create({
      accountId,
      kind: "expense",
      date: "2026-01-02",
      label: "Loyer",
      amount: 300,
    });

    const flows = await getAccountFlows(database);
    expect(flows.get(accountId)).toEqual({ inflow: 1000, outflow: 300 });
    expect(netOf(flows.get(accountId))).toBe(700);
  });

  it("counts a 'debt' as an inflow (money borrowed arrives in the account)", async () => {
    await database.debts.add({
      id: "d1",
      reference: "D01",
      kind: "debt",
      counterparty: "Banque",
      accountId,
      amount: 5000,
      date: "2026-01-01",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const flows = await getAccountFlows(database);
    expect(flows.get(accountId)).toEqual({ inflow: 5000, outflow: 0 });
  });

  it("counts a 'receivable' as an outflow (money lent out leaves the account)", async () => {
    await database.debts.add({
      id: "d1",
      reference: "D01",
      kind: "receivable",
      counterparty: "Ami",
      accountId,
      amount: 2000,
      date: "2026-01-01",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const flows = await getAccountFlows(database);
    expect(flows.get(accountId)).toEqual({ inflow: 0, outflow: 2000 });
  });

  it("counts a payment on a 'debt' as an outflow (paying back what you owe)", async () => {
    await database.debts.add({
      id: "d1",
      reference: "D01",
      kind: "debt",
      counterparty: "Banque",
      accountId,
      amount: 5000,
      date: "2026-01-01",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await database.debtPayments.add({
      id: "p1",
      debtId: "d1",
      accountId,
      amount: 1000,
      date: "2026-02-01",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const flows = await getAccountFlows(database);
    expect(flows.get(accountId)).toEqual({ inflow: 5000, outflow: 1000 });
    expect(netOf(flows.get(accountId))).toBe(4000);
  });

  it("counts a payment on a 'receivable' as an inflow (receiving what you're owed)", async () => {
    await database.debts.add({
      id: "d1",
      reference: "D01",
      kind: "receivable",
      counterparty: "Ami",
      accountId,
      amount: 2000,
      date: "2026-01-01",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await database.debtPayments.add({
      id: "p1",
      debtId: "d1",
      accountId,
      amount: 500,
      date: "2026-02-01",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const flows = await getAccountFlows(database);
    expect(flows.get(accountId)).toEqual({ inflow: 500, outflow: 2000 });
  });

  it("ignores a payment referencing a debt that no longer exists rather than throwing", async () => {
    await database.debtPayments.add({
      id: "orphan-payment",
      debtId: "no-such-debt",
      accountId,
      amount: 999,
      date: "2026-01-01",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    await expect(getAccountFlows(database)).resolves.toBeDefined();
    const flows = await getAccountFlows(database);
    expect(netOf(flows.get(accountId))).toBe(0);
  });

  it("keeps separate accounts' flows independent", async () => {
    const accounts = createAccountsRepository(database);
    const otherAccountId = (await accounts.create({ name: "Autre", initialBalance: 0 })).id;
    const transactions = createTransactionsRepository(database);
    await transactions.create({
      accountId: otherAccountId,
      kind: "income",
      date: "2026-01-01",
      label: "X",
      amount: 12345,
    });

    const flows = await getAccountFlows(database);
    expect(netOf(flows.get(accountId))).toBe(0);
    expect(netOf(flows.get(otherAccountId))).toBe(12345);
  });
});

describe("netOf", () => {
  it("returns 0 for an undefined flow", () => {
    expect(netOf(undefined)).toBe(0);
  });
});
