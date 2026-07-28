import { describe, it, expect, beforeEach } from "vitest";
import { useTestEncryptionSession } from "@/test/testDek";
import { createTestDatabase } from "@/test/testDatabase";
import type { SezzAccountsDatabase } from "@/db/schema";
import {
  ensureForecastAccount,
  creditForecastAccount,
  FORECAST_ACCOUNT_NAME,
} from "./forecastAccount";
import { createAccountsRepository, type AccountsRepository } from "./accountsRepository";
import {
  createTransactionsRepository,
  type TransactionsRepository,
} from "./transactionsRepository";
import { ValidationError } from "@/lib/errors";

describe("ensureForecastAccount", () => {
  useTestEncryptionSession();
  let database: SezzAccountsDatabase;
  let accounts: AccountsRepository;

  beforeEach(() => {
    database = createTestDatabase();
    accounts = createAccountsRepository(database);
  });

  it("creates the forecast account with a zero opening balance when it doesn't exist", async () => {
    const id = await ensureForecastAccount(database);

    const created = await accounts.getById(id);
    expect(created).toMatchObject({ name: FORECAST_ACCOUNT_NAME, initialBalance: 0 });
  });

  it("is idempotent — calling it again returns the same account, not a duplicate", async () => {
    const firstId = await ensureForecastAccount(database);
    const secondId = await ensureForecastAccount(database);

    expect(secondId).toBe(firstId);
    const all = await accounts.list();
    expect(all.filter((a) => a.name === FORECAST_ACCOUNT_NAME)).toHaveLength(1);
  });

  it("reuses an account the person already created with the exact same name", async () => {
    const manual = await accounts.create({ name: FORECAST_ACCOUNT_NAME, initialBalance: 5000 });

    const id = await ensureForecastAccount(database);

    expect(id).toBe(manual.id);
    const all = await accounts.list();
    expect(all.filter((a) => a.name === FORECAST_ACCOUNT_NAME)).toHaveLength(1);
  });
});

describe("creditForecastAccount", () => {
  useTestEncryptionSession();
  let database: SezzAccountsDatabase;
  let accounts: AccountsRepository;
  let transactions: TransactionsRepository;

  beforeEach(() => {
    database = createTestDatabase();
    accounts = createAccountsRepository(database);
    transactions = createTransactionsRepository(database);
  });

  it("creates the forecast account automatically on first use", async () => {
    await creditForecastAccount(
      { source: "Salaire", amount: 150000, date: "2026-02-01" },
      database,
    );

    const all = await accounts.list();
    expect(all.some((a) => a.name === FORECAST_ACCOUNT_NAME)).toBe(true);
  });

  it("records an income transaction with the source as its label", async () => {
    await creditForecastAccount(
      { source: "Vente d'un bien", amount: 75000, date: "2026-03-10" },
      database,
    );

    const all = await transactions.list();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      kind: "income",
      label: "Vente d'un bien",
      amount: 75000,
      date: "2026-03-10",
    });
  });

  it("credits the same forecast account on repeated use, rather than creating a new one each time", async () => {
    await creditForecastAccount(
      { source: "Salaire", amount: 100000, date: "2026-01-01" },
      database,
    );
    await creditForecastAccount({ source: "Prime", amount: 20000, date: "2026-01-15" }, database);

    const all = await accounts.list();
    const forecastAccounts = all.filter((a) => a.name === FORECAST_ACCOUNT_NAME);
    expect(forecastAccounts).toHaveLength(1);

    const allTransactions = await transactions.list();
    expect(allTransactions.filter((t) => t.accountId === forecastAccounts[0]!.id)).toHaveLength(2);
  });

  it("rejects a non-positive amount, the same as any other transaction", async () => {
    await expect(
      creditForecastAccount({ source: "Salaire", amount: 0, date: "2026-01-01" }, database),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects an empty source", async () => {
    await expect(
      creditForecastAccount({ source: "   ", amount: 1000, date: "2026-01-01" }, database),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects an invalid date", async () => {
    await expect(
      creditForecastAccount({ source: "Salaire", amount: 1000, date: "not-a-date" }, database),
    ).rejects.toThrow(ValidationError);
  });
});
