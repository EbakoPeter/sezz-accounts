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
import { createEngagementsRepository } from "./engagementsRepository";
import { ValidationError, NotFoundError } from "@/lib/errors";

describe("BudgetCategoriesRepository", () => {
  useTestEncryptionSession();
  let database: SezzAccountsDatabase;
  let categories: BudgetCategoriesRepository;
  let subcategories: BudgetSubcategoriesRepository;
  let accounts: AccountsRepository;
  let transactions: TransactionsRepository;

  beforeEach(() => {
    database = createTestDatabase();
    categories = createBudgetCategoriesRepository(database);
    subcategories = createBudgetSubcategoriesRepository(database);
    accounts = createAccountsRepository(database);
    transactions = createTransactionsRepository(database);
  });

  describe("create", () => {
    it("creates a category", async () => {
      const category = await categories.create({ name: "Vie Courante" });
      expect(category.id).toBeTruthy();
      expect(category.name).toBe("Vie Courante");
    });

    it("rejects an empty name", async () => {
      await expect(categories.create({ name: "   " })).rejects.toThrow(ValidationError);
    });

    it("rejects a duplicate name (case-insensitive)", async () => {
      await categories.create({ name: "Logement" });
      await expect(categories.create({ name: "logement" })).rejects.toThrow(/existe déjà/);
    });
  });

  describe("update", () => {
    it("renames a category", async () => {
      const category = await categories.create({ name: "Ancien" });
      const updated = await categories.update(category.id, { name: "Nouveau" });
      expect(updated.name).toBe("Nouveau");
    });

    it("throws NotFoundError for an unknown id", async () => {
      await expect(categories.update("nope", { name: "X" })).rejects.toThrow(NotFoundError);
    });
  });

  describe("remove", () => {
    it("deletes a category with no subcategories", async () => {
      const category = await categories.create({ name: "Jetable" });
      await categories.remove(category.id);
      expect(await categories.getById(category.id)).toBeUndefined();
    });

    it("refuses to delete a category that still has subcategories", async () => {
      const category = await categories.create({ name: "Vie Courante" });
      await subcategories.create({
        categoryId: category.id,
        name: "Transport",
        monthlyAllocation: 0,
      });
      await expect(categories.remove(category.id)).rejects.toThrow(ValidationError);
    });

    it("force-deletes: removes subcategories and their engagements, but only unlinks (not deletes) settling transactions", async () => {
      const category = await categories.create({ name: "Vie Courante" });
      const sub = await subcategories.create({
        categoryId: category.id,
        name: "Transport",
        monthlyAllocation: 20000,
      });
      const engagements = createEngagementsRepository(database);
      const engagement = await engagements.create({
        subcategoryId: sub.id,
        amount: 5000,
        label: "Carburant",
        date: "2026-01-01",
      });
      const account = await accounts.create({ name: "Compte", initialBalance: 0 });
      const tx = await transactions.create({
        accountId: account.id,
        kind: "expense",
        date: "2026-01-01",
        label: "Carburant",
        amount: 5000,
        engagementId: engagement.id,
      });

      await categories.remove(category.id, { force: true });

      expect(await categories.getById(category.id)).toBeUndefined();
      expect(await subcategories.getById(sub.id)).toBeUndefined();
      expect(await engagements.getById(engagement.id)).toBeUndefined();
      const survivingTx = await transactions.getById(tx.id);
      expect(survivingTx).toBeDefined();
      expect(survivingTx?.subcategoryId).toBeUndefined();
      expect(survivingTx?.engagementId).toBeUndefined();
      expect(survivingTx?.label).toBe("Carburant");
    });
  });

  describe("deletion log (for sync)", () => {
    it("logs the category, its cascaded subcategories and engagements, but not merely-unlinked transactions", async () => {
      const category = await categories.create({ name: "Vie Courante" });
      const sub = await subcategories.create({
        categoryId: category.id,
        name: "Transport",
        monthlyAllocation: 20000,
      });
      const engagements = createEngagementsRepository(database);
      const engagement = await engagements.create({
        subcategoryId: sub.id,
        amount: 5000,
        label: "Carburant",
        date: "2026-01-01",
      });
      const account = await accounts.create({ name: "Compte", initialBalance: 0 });
      const tx = await transactions.create({
        accountId: account.id,
        kind: "expense",
        date: "2026-01-01",
        label: "Carburant",
        amount: 5000,
        engagementId: engagement.id,
      });

      await categories.remove(category.id, { force: true });

      const entries = await database.deletionLog.toArray();
      const byTable = Object.fromEntries(entries.map((e) => [e.tableName, e.recordId]));
      expect(byTable["budgetCategories"]).toBe(category.id);
      expect(byTable["budgetSubcategories"]).toBe(sub.id);
      expect(byTable["engagements"]).toBe(engagement.id);
      expect(byTable["transactions"]).toBeUndefined();
      void tx;
    });
  });
});
