import { describe, it, expect, beforeEach } from "vitest";
import { createTestDatabase } from "@/test/testDatabase";
import type { LivreDeComptesDatabase } from "@/db/schema";
import { createAccountsRepository, type AccountsRepository } from "./accountsRepository";
import {
  createTransactionsRepository,
  type TransactionsRepository,
} from "./transactionsRepository";
import { ValidationError, NotFoundError } from "@/lib/errors";

describe("TransactionsRepository", () => {
  let database: LivreDeComptesDatabase;
  let accounts: AccountsRepository;
  let transactions: TransactionsRepository;
  let accountId: string;

  beforeEach(async () => {
    database = createTestDatabase();
    accounts = createAccountsRepository(database);
    transactions = createTransactionsRepository(database);
    const account = await accounts.create({ name: "Compte Test", initialBalance: 0 });
    accountId = account.id;
  });

  describe("create", () => {
    it("creates a transaction referencing an existing account", async () => {
      const tx = await transactions.create({
        accountId,
        kind: "income",
        date: "2026-03-01",
        label: "Salaire",
        amount: 300000,
      });
      expect(tx.id).toBeTruthy();
      expect(tx.accountId).toBe(accountId);
    });

    it("rejects a reference to a non-existent account", async () => {
      await expect(
        transactions.create({
          accountId: "ghost",
          kind: "income",
          date: "2026-01-01",
          label: "X",
          amount: 100,
        }),
      ).rejects.toThrow(NotFoundError);
    });

    it("rejects a non-positive amount", async () => {
      await expect(
        transactions.create({
          accountId,
          kind: "expense",
          date: "2026-01-01",
          label: "X",
          amount: 0,
        }),
      ).rejects.toThrow(ValidationError);
    });

    it("rejects a malformed date", async () => {
      await expect(
        transactions.create({
          accountId,
          kind: "expense",
          date: "01/01/2026",
          label: "X",
          amount: 100,
        }),
      ).rejects.toThrow(/date/);
    });

    it("rejects an empty label", async () => {
      await expect(
        transactions.create({
          accountId,
          kind: "expense",
          date: "2026-01-01",
          label: "   ",
          amount: 100,
        }),
      ).rejects.toThrow(ValidationError);
    });

    it("stores an optional category and note when provided", async () => {
      const tx = await transactions.create({
        accountId,
        kind: "expense",
        date: "2026-01-01",
        label: "Carburant",
        amount: 5000,
        categoryId: "cat-transport",
        note: "Plein complet",
      });
      expect(tx.categoryId).toBe("cat-transport");
      expect(tx.note).toBe("Plein complet");
    });
  });

  describe("list / filtering", () => {
    beforeEach(async () => {
      await transactions.create({
        accountId,
        kind: "income",
        date: "2026-01-05",
        label: "Salaire janvier",
        amount: 300000,
      });
      await transactions.create({
        accountId,
        kind: "expense",
        date: "2026-01-10",
        label: "Loyer",
        amount: 50000,
      });
      await transactions.create({
        accountId,
        kind: "expense",
        date: "2026-02-01",
        label: "Courses",
        amount: 20000,
      });
    });

    it("returns all transactions sorted by date descending", async () => {
      const rows = await transactions.list();
      expect(rows.map((r) => r.date)).toEqual(["2026-02-01", "2026-01-10", "2026-01-05"]);
    });

    it("filters by kind", async () => {
      const rows = await transactions.list({ kind: "expense" });
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.kind === "expense")).toBe(true);
    });

    it("filters by date range (inclusive)", async () => {
      const rows = await transactions.list({ from: "2026-01-06", to: "2026-02-01" });
      expect(rows.map((r) => r.label)).toEqual(["Courses", "Loyer"]);
    });

    it("filters by accountId", async () => {
      const otherAccount = await accounts.create({ name: "Autre", initialBalance: 0 });
      await transactions.create({
        accountId: otherAccount.id,
        kind: "income",
        date: "2026-01-01",
        label: "Autre revenu",
        amount: 1,
      });
      const rows = await transactions.list({ accountId });
      expect(rows.every((r) => r.accountId === accountId)).toBe(true);
      expect(rows).toHaveLength(3);
    });
  });

  describe("update", () => {
    it("updates fields and bumps updatedAt", async () => {
      const tx = await transactions.create({
        accountId,
        kind: "expense",
        date: "2026-01-01",
        label: "Avant",
        amount: 100,
      });
      await new Promise((r) => setTimeout(r, 2));
      const updated = await transactions.update(tx.id, { label: "Après", amount: 200 });
      expect(updated.label).toBe("Après");
      expect(updated.amount).toBe(200);
      expect(updated.updatedAt).toBeGreaterThan(tx.updatedAt);
    });

    it("validates the patched amount", async () => {
      const tx = await transactions.create({
        accountId,
        kind: "expense",
        date: "2026-01-01",
        label: "X",
        amount: 100,
      });
      await expect(transactions.update(tx.id, { amount: -5 })).rejects.toThrow(ValidationError);
    });

    it("throws NotFoundError for an unknown id", async () => {
      await expect(transactions.update("nope", { label: "X" })).rejects.toThrow(NotFoundError);
    });
  });

  describe("remove", () => {
    it("deletes the transaction", async () => {
      const tx = await transactions.create({
        accountId,
        kind: "expense",
        date: "2026-01-01",
        label: "X",
        amount: 100,
      });
      await transactions.remove(tx.id);
      expect(await transactions.getById(tx.id)).toBeUndefined();
    });

    it("throws NotFoundError when the transaction does not exist", async () => {
      await expect(transactions.remove("nope")).rejects.toThrow(NotFoundError);
    });
  });

  describe("netTotal", () => {
    it("computes income minus expenses for a filter", async () => {
      await transactions.create({
        accountId,
        kind: "income",
        date: "2026-01-01",
        label: "In",
        amount: 1000,
      });
      await transactions.create({
        accountId,
        kind: "expense",
        date: "2026-01-02",
        label: "Out",
        amount: 300,
      });
      expect(await transactions.netTotal({ accountId })).toBe(700);
    });

    it("returns 0 for an empty filter result", async () => {
      expect(await transactions.netTotal({ accountId: "ghost-account" })).toBe(0);
    });
  });
});
