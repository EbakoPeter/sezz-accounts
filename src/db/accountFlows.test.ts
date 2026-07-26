import { describe, it, expect, beforeEach } from "vitest";
import { createTestDatabase } from "@/test/testDatabase";
import { useTestEncryptionSession } from "@/test/testDek";
import { encryptedFixture } from "@/test/encryptedFixture";
import type { SezzAccountsDatabase } from "@/db/schema";
import { createAccountsRepository } from "./accountsRepository";
import { createTransactionsRepository } from "./transactionsRepository";
import { createTransfersRepository } from "./transfersRepository";
import { getAccountFlows, netOf } from "./accountFlows";
import type { Debt, DebtPayment } from "@/types/models";

const SENSITIVE_DEBT_FIELDS = ["counterparty", "amount", "dueDate", "description"] as const;
const SENSITIVE_PAYMENT_FIELDS = ["amount"] as const;

function debtFixture(overrides: Partial<Debt> & Pick<Debt, "id" | "kind" | "accountId">): Debt {
  return {
    reference: "D01",
    counterparty: "Tiers",
    date: "2026-01-01",
    amount: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function paymentFixture(
  overrides: Partial<DebtPayment> & Pick<DebtPayment, "id" | "debtId" | "accountId">,
): DebtPayment {
  return {
    date: "2026-01-01",
    amount: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe("getAccountFlows", () => {
  useTestEncryptionSession();
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
    await database.debts.add(
      await encryptedFixture(
        debtFixture({ id: "d1", kind: "debt", counterparty: "Banque", accountId, amount: 5000 }),
        SENSITIVE_DEBT_FIELDS,
      ),
    );

    const flows = await getAccountFlows(database);
    expect(flows.get(accountId)).toEqual({ inflow: 5000, outflow: 0 });
  });

  it("counts a 'receivable' as an outflow (money lent out leaves the account)", async () => {
    await database.debts.add(
      await encryptedFixture(
        debtFixture({ id: "d1", kind: "receivable", counterparty: "Ami", accountId, amount: 2000 }),
        SENSITIVE_DEBT_FIELDS,
      ),
    );

    const flows = await getAccountFlows(database);
    expect(flows.get(accountId)).toEqual({ inflow: 0, outflow: 2000 });
  });

  it("counts a payment on a 'debt' as an outflow (paying back what you owe)", async () => {
    await database.debts.add(
      await encryptedFixture(
        debtFixture({ id: "d1", kind: "debt", counterparty: "Banque", accountId, amount: 5000 }),
        SENSITIVE_DEBT_FIELDS,
      ),
    );
    await database.debtPayments.add(
      await encryptedFixture(
        paymentFixture({ id: "p1", debtId: "d1", accountId, amount: 1000, date: "2026-02-01" }),
        SENSITIVE_PAYMENT_FIELDS,
      ),
    );

    const flows = await getAccountFlows(database);
    expect(flows.get(accountId)).toEqual({ inflow: 5000, outflow: 1000 });
    expect(netOf(flows.get(accountId))).toBe(4000);
  });

  it("counts a payment on a 'receivable' as an inflow (receiving what you're owed)", async () => {
    await database.debts.add(
      await encryptedFixture(
        debtFixture({ id: "d1", kind: "receivable", counterparty: "Ami", accountId, amount: 2000 }),
        SENSITIVE_DEBT_FIELDS,
      ),
    );
    await database.debtPayments.add(
      await encryptedFixture(
        paymentFixture({ id: "p1", debtId: "d1", accountId, amount: 500, date: "2026-02-01" }),
        SENSITIVE_PAYMENT_FIELDS,
      ),
    );

    const flows = await getAccountFlows(database);
    expect(flows.get(accountId)).toEqual({ inflow: 500, outflow: 2000 });
  });

  it("ignores a payment referencing a debt that no longer exists rather than throwing", async () => {
    await database.debtPayments.add(
      await encryptedFixture(
        paymentFixture({ id: "orphan-payment", debtId: "no-such-debt", accountId, amount: 999 }),
        SENSITIVE_PAYMENT_FIELDS,
      ),
    );

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

  it("debits the source account and credits the destination for a transfer", async () => {
    const accounts = createAccountsRepository(database);
    const otherAccountId = (await accounts.create({ name: "Épargne", initialBalance: 0 })).id;
    const transfers = createTransfersRepository(database);
    await transfers.create({
      fromAccountId: accountId,
      toAccountId: otherAccountId,
      amount: 30000,
      date: "2026-01-01",
    });

    const flows = await getAccountFlows(database);
    expect(netOf(flows.get(accountId))).toBe(-30000);
    expect(netOf(flows.get(otherAccountId))).toBe(30000);
  });

  it("never counts a transfer as income or expense (the whole point of it being a separate entity)", async () => {
    const accounts = createAccountsRepository(database);
    const otherAccountId = (await accounts.create({ name: "Épargne", initialBalance: 0 })).id;
    const transfers = createTransfersRepository(database);
    await transfers.create({
      fromAccountId: accountId,
      toAccountId: otherAccountId,
      amount: 30000,
      date: "2026-01-01",
    });

    const flows = await getAccountFlows(database);
    // the transferred amount shows up as inflow on one side and outflow on
    // the other, but the total across both accounts nets to zero -- unlike
    // real income, nothing was actually earned by the household
    const totalNet = netOf(flows.get(accountId)) + netOf(flows.get(otherAccountId));
    expect(totalNet).toBe(0);
  });

  it("nets several transfers between the same two accounts correctly", async () => {
    const accounts = createAccountsRepository(database);
    const otherAccountId = (await accounts.create({ name: "Épargne", initialBalance: 0 })).id;
    const transfers = createTransfersRepository(database);
    await transfers.create({
      fromAccountId: accountId,
      toAccountId: otherAccountId,
      amount: 30000,
      date: "2026-01-01",
    });
    await transfers.create({
      fromAccountId: otherAccountId,
      toAccountId: accountId,
      amount: 10000,
      date: "2026-01-15",
    });

    const flows = await getAccountFlows(database);
    expect(netOf(flows.get(accountId))).toBe(-20000);
    expect(netOf(flows.get(otherAccountId))).toBe(20000);
  });

  it("gives the same result to concurrent callers as to a single caller", async () => {
    const transactions = createTransactionsRepository(database);
    await transactions.create({
      accountId,
      kind: "income",
      date: "2026-01-01",
      label: "Salaire",
      amount: 100000,
    });

    // several "hooks" asking for this at once (the actual scenario this
    // exists for — e.g. useAccountsWithBalances and useBudgetSummary
    // both reading transactions in the same render) must not see a
    // partial or different result from each other
    const [a, b, c] = await Promise.all([
      getAccountFlows(database),
      getAccountFlows(database),
      getAccountFlows(database),
    ]);
    expect(netOf(a.get(accountId))).toBe(100000);
    expect(netOf(b.get(accountId))).toBe(100000);
    expect(netOf(c.get(accountId))).toBe(100000);
  });

  it("never serves a stale result: a write between two calls is always reflected", async () => {
    const transactions = createTransactionsRepository(database);
    const before = await getAccountFlows(database);
    expect(netOf(before.get(accountId))).toBe(0);

    await transactions.create({
      accountId,
      kind: "income",
      date: "2026-01-01",
      label: "Salaire",
      amount: 50000,
    });

    const after = await getAccountFlows(database);
    expect(netOf(after.get(accountId))).toBe(50000);
  });
});

describe("netOf", () => {
  it("returns 0 for an undefined flow", () => {
    expect(netOf(undefined)).toBe(0);
  });
});
