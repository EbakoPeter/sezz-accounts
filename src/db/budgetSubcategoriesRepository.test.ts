import { describe, it, expect, beforeEach } from "vitest";
import { useTestEncryptionSession } from "@/test/testDek";
import { createTestDatabase } from "@/test/testDatabase";
import type { SezzAccountsDatabase } from "@/db/schema";
import {
  createBudgetCategoriesRepository,
  type BudgetCategoriesRepository,
} from "./budgetCategoriesRepository";
import {
  createBudgetSubcategoriesRepository,
  type BudgetSubcategoriesRepository,
} from "./budgetSubcategoriesRepository";
import { createAccountsRepository, type AccountsRepository } from "./accountsRepository";
import {
  createTransactionsRepository,
  type TransactionsRepository,
} from "./transactionsRepository";
import { ValidationError, NotFoundError } from "@/lib/errors";

describe("BudgetSubcategoriesRepository", () => {
  useTestEncryptionSession();
  let database: SezzAccountsDatabase;
  let categories: BudgetCategoriesRepository;
  let subcategories: BudgetSubcategoriesRepository;
  let accounts: AccountsRepository;
  let transactions: TransactionsRepository;
  let categoryId: string;

  beforeEach(async () => {
    database = createTestDatabase();
    categories = createBudgetCategoriesRepository(database);
    subcategories = createBudgetSubcategoriesRepository(database);
    accounts = createAccountsRepository(database);
    transactions = createTransactionsRepository(database);
    categoryId = (await categories.create({ name: "Vie Courante" })).id;
  });

  describe("create", () => {
    it("creates a subcategory under an existing category", async () => {
      const sub = await subcategories.create({
        categoryId,
        name: "Alimentation",
        monthlyAllocation: 40000,
      });
      expect(sub.id).toBeTruthy();
      expect(sub.monthlyAllocation).toBe(40000);
    });

    it("rejects a reference to a non-existent category", async () => {
      await expect(
        subcategories.create({ categoryId: "ghost", name: "X", monthlyAllocation: 0 }),
      ).rejects.toThrow(NotFoundError);
    });

    it("accepts a zero allocation (not yet provisioned)", async () => {
      const sub = await subcategories.create({ categoryId, name: "X", monthlyAllocation: 0 });
      expect(sub.monthlyAllocation).toBe(0);
    });

    it("rejects a negative allocation", async () => {
      await expect(
        subcategories.create({ categoryId, name: "X", monthlyAllocation: -1 }),
      ).rejects.toThrow(ValidationError);
    });

    it("rejects a duplicate name within the same category", async () => {
      await subcategories.create({ categoryId, name: "Transport", monthlyAllocation: 0 });
      await expect(
        subcategories.create({ categoryId, name: "transport", monthlyAllocation: 0 }),
      ).rejects.toThrow(/existe déjà/);
    });

    it("allows the same name in two different categories", async () => {
      const otherCategory = await categories.create({ name: "Autre" });
      await subcategories.create({ categoryId, name: "Divers", monthlyAllocation: 0 });
      await expect(
        subcategories.create({
          categoryId: otherCategory.id,
          name: "Divers",
          monthlyAllocation: 0,
        }),
      ).resolves.toBeTruthy();
    });
  });

  describe("list", () => {
    it("filters by category", async () => {
      const otherCategory = await categories.create({ name: "Autre" });
      await subcategories.create({ categoryId, name: "A", monthlyAllocation: 0 });
      await subcategories.create({ categoryId: otherCategory.id, name: "B", monthlyAllocation: 0 });

      const rows = await subcategories.list({ categoryId });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.name).toBe("A");
    });
  });

  describe("update", () => {
    it("renames and re-checks uniqueness within its own category", async () => {
      await subcategories.create({ categoryId, name: "Existant", monthlyAllocation: 0 });
      const sub = await subcategories.create({
        categoryId,
        name: "A renommer",
        monthlyAllocation: 0,
      });
      await expect(subcategories.update(sub.id, { name: "Existant" })).rejects.toThrow(
        /existe déjà/,
      );
      await expect(subcategories.update(sub.id, { name: "Nouveau nom" })).resolves.toBeTruthy();
    });

    it("updates the monthly allocation", async () => {
      const sub = await subcategories.create({ categoryId, name: "X", monthlyAllocation: 1000 });
      const updated = await subcategories.update(sub.id, { monthlyAllocation: 2000 });
      expect(updated.monthlyAllocation).toBe(2000);
    });
  });

  describe("remove", () => {
    it("refuses to delete a subcategory still referenced by transactions", async () => {
      const sub = await subcategories.create({
        categoryId,
        name: "Transport",
        monthlyAllocation: 0,
      });
      const account = await accounts.create({ name: "Compte", initialBalance: 0 });
      await transactions.create({
        accountId: account.id,
        kind: "expense",
        date: "2026-01-01",
        label: "Bus",
        amount: 500,
        subcategoryId: sub.id,
      });
      await expect(subcategories.remove(sub.id)).rejects.toThrow(ValidationError);
    });

    it("force-deletes: unlinks referencing transactions instead of deleting them", async () => {
      const sub = await subcategories.create({
        categoryId,
        name: "Transport",
        monthlyAllocation: 0,
      });
      const account = await accounts.create({ name: "Compte", initialBalance: 0 });
      const tx = await transactions.create({
        accountId: account.id,
        kind: "expense",
        date: "2026-01-01",
        label: "Bus",
        amount: 500,
        subcategoryId: sub.id,
      });

      await subcategories.remove(sub.id, { force: true });

      expect(await subcategories.getById(sub.id)).toBeUndefined();
      const survivingTx = await transactions.getById(tx.id);
      expect(survivingTx).toBeDefined();
      expect(survivingTx?.subcategoryId).toBeUndefined();
    });
  });
});
