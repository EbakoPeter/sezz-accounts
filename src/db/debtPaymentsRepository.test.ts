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
import { ValidationError, NotFoundError } from "@/lib/errors";

describe("DebtPaymentsRepository", () => {
  useTestEncryptionSession();
  let database: SezzAccountsDatabase;
  let debts: DebtsRepository;
  let payments: DebtPaymentsRepository;
  let accountId: string;
  let debtId: string;

  beforeEach(async () => {
    database = createTestDatabase();
    const accounts = createAccountsRepository(database);
    debts = createDebtsRepository(database);
    payments = createDebtPaymentsRepository(database);
    accountId = (await accounts.create({ name: "Compte", initialBalance: 0 })).id;
    debtId = (
      await debts.create({
        kind: "debt",
        counterparty: "Banque",
        accountId,
        amount: 100000,
        date: "2026-01-01",
      })
    ).id;
  });

  describe("create", () => {
    it("creates a payment against an existing debt and account", async () => {
      const payment = await payments.create({
        debtId,
        accountId,
        amount: 25000,
        date: "2026-02-01",
      });
      expect(payment.id).toBeTruthy();
      expect(payment.amount).toBe(25000);
    });

    it("rejects a reference to a non-existent debt", async () => {
      await expect(
        payments.create({ debtId: "ghost", accountId, amount: 1000, date: "2026-01-01" }),
      ).rejects.toThrow(NotFoundError);
    });

    it("rejects a reference to a non-existent account", async () => {
      await expect(
        payments.create({ debtId, accountId: "ghost", amount: 1000, date: "2026-01-01" }),
      ).rejects.toThrow(NotFoundError);
    });

    it("rejects a non-positive amount", async () => {
      await expect(
        payments.create({ debtId, accountId, amount: -5, date: "2026-01-01" }),
      ).rejects.toThrow(ValidationError);
    });

    it("does NOT block an amount exceeding the debt's remaining balance (soft rule, left to the UI)", async () => {
      await expect(
        payments.create({ debtId, accountId, amount: 999999999, date: "2026-01-01" }),
      ).resolves.toBeTruthy();
    });
  });

  describe("list", () => {
    it("filters by debtId", async () => {
      const otherDebt = await debts.create({
        kind: "debt",
        counterparty: "Autre",
        accountId,
        amount: 500,
        date: "2026-01-01",
      });
      await payments.create({ debtId, accountId, amount: 100, date: "2026-01-01" });
      await payments.create({ debtId: otherDebt.id, accountId, amount: 50, date: "2026-01-01" });

      const rows = await payments.list({ debtId });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.amount).toBe(100);
    });

    it("sorts by date descending", async () => {
      await payments.create({ debtId, accountId, amount: 100, date: "2026-01-05" });
      await payments.create({ debtId, accountId, amount: 200, date: "2026-02-01" });
      const rows = await payments.list({ debtId });
      expect(rows.map((r) => r.date)).toEqual(["2026-02-01", "2026-01-05"]);
    });
  });

  describe("update", () => {
    it("updates the amount", async () => {
      const payment = await payments.create({ debtId, accountId, amount: 100, date: "2026-01-01" });
      const updated = await payments.update(payment.id, { amount: 200 });
      expect(updated.amount).toBe(200);
    });

    it("throws NotFoundError for an unknown id", async () => {
      await expect(payments.update("nope", { amount: 1 })).rejects.toThrow(NotFoundError);
    });
  });

  describe("remove", () => {
    it("deletes the payment", async () => {
      const payment = await payments.create({ debtId, accountId, amount: 100, date: "2026-01-01" });
      await payments.remove(payment.id);
      expect(await payments.getById(payment.id)).toBeUndefined();
    });
  });
});
