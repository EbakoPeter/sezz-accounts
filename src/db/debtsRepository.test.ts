import { describe, it, expect, beforeEach } from "vitest";
import { useTestEncryptionSession } from "@/test/testDek";
import { createTestDatabase } from "@/test/testDatabase";
import type { SezzAccountsDatabase } from "@/db/schema";
import { createAccountsRepository, type AccountsRepository } from "./accountsRepository";
import { createDebtsRepository, type DebtsRepository } from "./debtsRepository";
import {
  createDebtPaymentsRepository,
  type DebtPaymentsRepository,
} from "./debtPaymentsRepository";
import { getAccountFlows, netOf } from "./accountFlows";
import { ValidationError, NotFoundError } from "@/lib/errors";

describe("DebtsRepository", () => {
  useTestEncryptionSession();
  let database: SezzAccountsDatabase;
  let accounts: AccountsRepository;
  let debts: DebtsRepository;
  let payments: DebtPaymentsRepository;
  let accountId: string;

  beforeEach(async () => {
    database = createTestDatabase();
    accounts = createAccountsRepository(database);
    debts = createDebtsRepository(database);
    payments = createDebtPaymentsRepository(database);
    accountId = (await accounts.create({ name: "Compte", initialBalance: 0 })).id;
  });

  describe("create", () => {
    it("creates a debt with an auto-assigned reference", async () => {
      const debt = await debts.create({
        kind: "debt",
        counterparty: "Banque XYZ",
        accountId,
        amount: 500000,
        date: "2026-01-01",
      });
      expect(debt.reference).toBe("D01");
      expect(debt.id).toBeTruthy();
    });

    it("increments the reference for each subsequent debt", async () => {
      const first = await debts.create({
        kind: "debt",
        counterparty: "A",
        accountId,
        amount: 100,
        date: "2026-01-01",
      });
      const second = await debts.create({
        kind: "receivable",
        counterparty: "B",
        accountId,
        amount: 200,
        date: "2026-01-01",
      });
      expect(first.reference).toBe("D01");
      expect(second.reference).toBe("D02");
    });

    it("rejects a reference to a non-existent account", async () => {
      await expect(
        debts.create({
          kind: "debt",
          counterparty: "X",
          accountId: "ghost",
          amount: 100,
          date: "2026-01-01",
        }),
      ).rejects.toThrow(NotFoundError);
    });

    it("rejects an empty counterparty", async () => {
      await expect(
        debts.create({
          kind: "debt",
          counterparty: "  ",
          accountId,
          amount: 100,
          date: "2026-01-01",
        }),
      ).rejects.toThrow(ValidationError);
    });

    it("rejects a non-positive amount", async () => {
      await expect(
        debts.create({ kind: "debt", counterparty: "X", accountId, amount: 0, date: "2026-01-01" }),
      ).rejects.toThrow(ValidationError);
    });

    it("rejects a due date before the debt date", async () => {
      await expect(
        debts.create({
          kind: "debt",
          counterparty: "X",
          accountId,
          amount: 100,
          date: "2026-01-10",
          dueDate: "2026-01-01",
        }),
      ).rejects.toThrow(/échéance/);
    });

    it("accepts a due date on or after the debt date", async () => {
      await expect(
        debts.create({
          kind: "debt",
          counterparty: "X",
          accountId,
          amount: 100,
          date: "2026-01-01",
          dueDate: "2026-01-01",
        }),
      ).resolves.toBeTruthy();
    });
  });

  describe("update", () => {
    it("updates fields without changing the reference", async () => {
      const debt = await debts.create({
        kind: "debt",
        counterparty: "Ancien",
        accountId,
        amount: 100,
        date: "2026-01-01",
      });
      const updated = await debts.update(debt.id, { counterparty: "Nouveau", amount: 200 });
      expect(updated.reference).toBe(debt.reference);
      expect(updated.counterparty).toBe("Nouveau");
      expect(updated.amount).toBe(200);
    });

    it("throws NotFoundError for an unknown id", async () => {
      await expect(debts.update("nope", { amount: 1 })).rejects.toThrow(NotFoundError);
    });

    it("changes the kind (debt <-> receivable)", async () => {
      const debt = await debts.create({
        kind: "debt",
        counterparty: "X",
        accountId,
        amount: 100,
        date: "2026-01-01",
      });
      const updated = await debts.update(debt.id, { kind: "receivable" });
      expect(updated.kind).toBe("receivable");
    });

    it("clears the due date when dueDate is explicitly null", async () => {
      const debt = await debts.create({
        kind: "debt",
        counterparty: "X",
        accountId,
        amount: 100,
        date: "2026-01-01",
        dueDate: "2026-06-01",
      });
      const updated = await debts.update(debt.id, { dueDate: null });
      expect(updated.dueDate).toBeUndefined();
    });

    it("leaves the due date untouched when omitted from the patch", async () => {
      const debt = await debts.create({
        kind: "debt",
        counterparty: "X",
        accountId,
        amount: 100,
        date: "2026-01-01",
        dueDate: "2026-06-01",
      });
      const updated = await debts.update(debt.id, { amount: 200 });
      expect(updated.dueDate).toBe("2026-06-01");
    });
  });

  describe("remove", () => {
    it("deletes a debt with no payments", async () => {
      const debt = await debts.create({
        kind: "debt",
        counterparty: "X",
        accountId,
        amount: 100,
        date: "2026-01-01",
      });
      await debts.remove(debt.id);
      expect(await debts.getById(debt.id)).toBeUndefined();
    });

    it("refuses to delete a debt that still has payments", async () => {
      const debt = await debts.create({
        kind: "debt",
        counterparty: "X",
        accountId,
        amount: 100,
        date: "2026-01-01",
      });
      await payments.create({ debtId: debt.id, accountId, amount: 50, date: "2026-02-01" });
      await expect(debts.remove(debt.id)).rejects.toThrow(ValidationError);
    });

    it("force-deletes: removes the debt AND its payments together", async () => {
      const debt = await debts.create({
        kind: "debt",
        counterparty: "X",
        accountId,
        amount: 100,
        date: "2026-01-01",
      });
      const payment = await payments.create({
        debtId: debt.id,
        accountId,
        amount: 50,
        date: "2026-02-01",
      });

      await debts.remove(debt.id, { force: true });

      expect(await debts.getById(debt.id)).toBeUndefined();
      expect(await payments.getById(payment.id)).toBeUndefined();
    });
  });

  describe("integration with account balance", () => {
    it("a 'debt' increases the account balance when incurred, decreases when repaid", async () => {
      const debt = await debts.create({
        kind: "debt",
        counterparty: "Banque",
        accountId,
        amount: 100000,
        date: "2026-01-01",
      });
      let flows = await getAccountFlows(database);
      expect(netOf(flows.get(accountId))).toBe(100000);

      await payments.create({ debtId: debt.id, accountId, amount: 30000, date: "2026-02-01" });
      flows = await getAccountFlows(database);
      expect(netOf(flows.get(accountId))).toBe(70000);
    });

    it("a 'receivable' decreases the account balance when lent, increases when repaid", async () => {
      const debt = await debts.create({
        kind: "receivable",
        counterparty: "Ami",
        accountId,
        amount: 40000,
        date: "2026-01-01",
      });
      let flows = await getAccountFlows(database);
      expect(netOf(flows.get(accountId))).toBe(-40000);

      await payments.create({ debtId: debt.id, accountId, amount: 40000, date: "2026-02-01" });
      flows = await getAccountFlows(database);
      expect(netOf(flows.get(accountId))).toBe(0);
    });
  });

  describe("deletion log (for sync)", () => {
    it("logs a plain deletion", async () => {
      const debt = await debts.create({
        kind: "debt",
        counterparty: "Banque",
        accountId,
        amount: 10000,
        date: "2026-01-01",
      });
      await debts.remove(debt.id);

      const entries = await database.deletionLog.toArray();
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ tableName: "debts", recordId: debt.id });
    });

    it("logs cascaded payment deletions when force-removing a debt", async () => {
      const debt = await debts.create({
        kind: "debt",
        counterparty: "Banque",
        accountId,
        amount: 10000,
        date: "2026-01-01",
      });
      const payment = await payments.create({
        debtId: debt.id,
        accountId,
        amount: 5000,
        date: "2026-02-01",
      });

      await debts.remove(debt.id, { force: true });

      const entries = await database.deletionLog.toArray();
      const byTable = Object.fromEntries(entries.map((e) => [e.tableName, e.recordId]));
      expect(byTable["debts"]).toBe(debt.id);
      expect(byTable["debtPayments"]).toBe(payment.id);
    });
  });
});
