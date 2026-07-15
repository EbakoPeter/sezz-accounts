import { describe, it, expect, beforeEach } from "vitest";
import { createTestDatabase } from "@/test/testDatabase";
import type { LivreDeComptesDatabase } from "@/db/schema";
import { createAccountsRepository, type AccountsRepository } from "./accountsRepository";
import {
  createTransactionsRepository,
  type TransactionsRepository,
} from "./transactionsRepository";
import { ValidationError, NotFoundError } from "@/lib/errors";

describe("AccountsRepository", () => {
  let database: LivreDeComptesDatabase;
  let accounts: AccountsRepository;
  let transactions: TransactionsRepository;

  beforeEach(() => {
    database = createTestDatabase();
    accounts = createAccountsRepository(database);
    transactions = createTransactionsRepository(database);
  });

  describe("create", () => {
    it("creates an account with a generated id and timestamps", async () => {
      const account = await accounts.create({ name: "Compte Principal", initialBalance: 10000 });
      expect(account.id).toBeTruthy();
      expect(account.name).toBe("Compte Principal");
      expect(account.initialBalance).toBe(10000);
      expect(account.createdAt).toBeGreaterThan(0);
    });

    it("trims whitespace from the name", async () => {
      const account = await accounts.create({ name: "  Caisse  ", initialBalance: 0 });
      expect(account.name).toBe("Caisse");
    });

    it("rejects an empty name", async () => {
      await expect(accounts.create({ name: "   ", initialBalance: 0 })).rejects.toThrow(
        ValidationError,
      );
    });

    it("rejects a duplicate name (case-insensitive)", async () => {
      await accounts.create({ name: "Compte Épargne", initialBalance: 0 });
      await expect(accounts.create({ name: "compte épargne", initialBalance: 0 })).rejects.toThrow(
        /existe déjà/,
      );
    });

    it("rejects a negative initial balance", async () => {
      await expect(accounts.create({ name: "X", initialBalance: -1 })).rejects.toThrow(
        ValidationError,
      );
    });

    it("accepts a zero initial balance", async () => {
      const account = await accounts.create({ name: "X", initialBalance: 0 });
      expect(account.initialBalance).toBe(0);
    });
  });

  describe("list", () => {
    it("returns accounts sorted by name", async () => {
      await accounts.create({ name: "Zèbre", initialBalance: 0 });
      await accounts.create({ name: "Alpha", initialBalance: 0 });
      const list = await accounts.list();
      expect(list.map((a) => a.name)).toEqual(["Alpha", "Zèbre"]);
    });

    it("returns an empty array when there are no accounts", async () => {
      expect(await accounts.list()).toEqual([]);
    });
  });

  describe("update", () => {
    it("updates the name and bumps updatedAt", async () => {
      const account = await accounts.create({ name: "Ancien nom", initialBalance: 0 });
      await new Promise((r) => setTimeout(r, 2));
      const updated = await accounts.update(account.id, { name: "Nouveau nom" });
      expect(updated.name).toBe("Nouveau nom");
      expect(updated.updatedAt).toBeGreaterThan(account.updatedAt);
    });

    it("throws NotFoundError for an unknown id", async () => {
      await expect(accounts.update("does-not-exist", { name: "X" })).rejects.toThrow(NotFoundError);
    });

    it("still enforces uniqueness on rename, excluding itself", async () => {
      const a = await accounts.create({ name: "A", initialBalance: 0 });
      await accounts.create({ name: "B", initialBalance: 0 });
      await expect(accounts.update(a.id, { name: "B" })).rejects.toThrow(/existe déjà/);
      // renaming to its own current name must not falsely trigger the uniqueness check
      await expect(accounts.update(a.id, { name: "A" })).resolves.toBeTruthy();
    });
  });

  describe("remove", () => {
    it("deletes an account with no transactions", async () => {
      const account = await accounts.create({ name: "Jetable", initialBalance: 0 });
      await accounts.remove(account.id);
      expect(await accounts.getById(account.id)).toBeUndefined();
    });

    it("refuses to delete an account that still has transactions", async () => {
      const account = await accounts.create({ name: "Utilisé", initialBalance: 0 });
      await transactions.create({
        accountId: account.id,
        kind: "income",
        date: "2026-01-01",
        label: "Salaire",
        amount: 1000,
      });
      await expect(accounts.remove(account.id)).rejects.toThrow(ValidationError);
      expect(await accounts.getById(account.id)).toBeDefined();
    });

    it("cascades when force:true is passed, deleting dependent transactions too", async () => {
      const account = await accounts.create({ name: "Utilisé", initialBalance: 0 });
      await transactions.create({
        accountId: account.id,
        kind: "income",
        date: "2026-01-01",
        label: "Salaire",
        amount: 1000,
      });
      await accounts.remove(account.id, { force: true });
      expect(await accounts.getById(account.id)).toBeUndefined();
      expect(await transactions.list({ accountId: account.id })).toEqual([]);
    });
  });

  describe("getBalance", () => {
    it("equals the opening balance when there are no transactions", async () => {
      const account = await accounts.create({ name: "Vide", initialBalance: 5000 });
      expect(await accounts.getBalance(account.id)).toBe(5000);
    });

    it("adds income and subtracts expenses", async () => {
      const account = await accounts.create({ name: "Actif", initialBalance: 1000 });
      await transactions.create({
        accountId: account.id,
        kind: "income",
        date: "2026-01-01",
        label: "Salaire",
        amount: 5000,
      });
      await transactions.create({
        accountId: account.id,
        kind: "expense",
        date: "2026-01-02",
        label: "Courses",
        amount: 2000,
      });
      expect(await accounts.getBalance(account.id)).toBe(1000 + 5000 - 2000);
    });

    it("is unaffected by transactions on a different account", async () => {
      const a = await accounts.create({ name: "A", initialBalance: 0 });
      const b = await accounts.create({ name: "B", initialBalance: 0 });
      await transactions.create({
        accountId: b.id,
        kind: "income",
        date: "2026-01-01",
        label: "Revenu B",
        amount: 99999,
      });
      expect(await accounts.getBalance(a.id)).toBe(0);
    });

    it("throws NotFoundError for an unknown account", async () => {
      await expect(accounts.getBalance("nope")).rejects.toThrow(NotFoundError);
    });
  });

  describe("renaming does not require touching transactions (the normalization guarantee)", () => {
    it("keeps transactions correctly attributed after a rename", async () => {
      const account = await accounts.create({ name: "Avant", initialBalance: 0 });
      await transactions.create({
        accountId: account.id,
        kind: "expense",
        date: "2026-01-01",
        label: "Test",
        amount: 100,
      });
      await accounts.update(account.id, { name: "Après" });

      const rows = await transactions.list({ accountId: account.id });
      expect(rows).toHaveLength(1);
      expect(await accounts.getBalance(account.id)).toBe(-100);
    });
  });
});
