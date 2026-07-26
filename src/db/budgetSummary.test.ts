import { describe, it, expect, beforeEach } from "vitest";
import { useTestEncryptionSession } from "@/test/testDek";
import { createTestDatabase } from "@/test/testDatabase";
import type { SezzAccountsDatabase } from "@/db/schema";
import { createBudgetCategoriesRepository } from "./budgetCategoriesRepository";
import { createBudgetSubcategoriesRepository } from "./budgetSubcategoriesRepository";
import { createAccountsRepository } from "./accountsRepository";
import { createTransactionsRepository } from "./transactionsRepository";
import { createEngagementsRepository } from "./engagementsRepository";
import { getBudgetSummary } from "./budgetSummary";

describe("getBudgetSummary", () => {
  useTestEncryptionSession();
  let database: SezzAccountsDatabase;
  let accountId: string;

  beforeEach(async () => {
    database = createTestDatabase();
    const accounts = createAccountsRepository(database);
    accountId = (await accounts.create({ name: "Compte", initialBalance: 0 })).id;
  });

  it("returns categories with zeroed actuals when there are no transactions", async () => {
    const categories = createBudgetCategoriesRepository(database);
    const subcategories = createBudgetSubcategoriesRepository(database);
    const category = await categories.create({ name: "Vie Courante" });
    await subcategories.create({
      categoryId: category.id,
      name: "Alimentation",
      monthlyAllocation: 40000,
    });

    const summary = await getBudgetSummary(2026, 1, database);
    expect(summary).toHaveLength(1);
    expect(summary[0]?.subcategories[0]).toMatchObject({
      name: "Alimentation",
      monthlyAllocation: 40000,
      actual: 0,
      remaining: 40000,
      percentUsed: 0,
    });
  });

  it("sums expenses into the matching subcategory for the given month only", async () => {
    const categories = createBudgetCategoriesRepository(database);
    const subcategories = createBudgetSubcategoriesRepository(database);
    const transactions = createTransactionsRepository(database);
    const category = await categories.create({ name: "Vie Courante" });
    const sub = await subcategories.create({
      categoryId: category.id,
      name: "Transport",
      monthlyAllocation: 25000,
    });

    await transactions.create({
      accountId,
      kind: "expense",
      date: "2026-01-05",
      label: "Essence",
      amount: 10000,
      subcategoryId: sub.id,
    });
    await transactions.create({
      accountId,
      kind: "expense",
      date: "2026-01-20",
      label: "Bus",
      amount: 3000,
      subcategoryId: sub.id,
    });
    // different month — must NOT be counted
    await transactions.create({
      accountId,
      kind: "expense",
      date: "2026-02-01",
      label: "Février",
      amount: 20000,
      subcategoryId: sub.id,
    });
    // income on the same subcategory id would be nonsensical but must not
    // be counted as an expense even if it somehow had one
    await transactions.create({
      accountId,
      kind: "income",
      date: "2026-01-10",
      label: "Remboursement",
      amount: 500,
    });

    const summary = await getBudgetSummary(2026, 1, database);
    const transportSummary = summary[0]?.subcategories.find((s) => s.name === "Transport");
    expect(transportSummary?.actual).toBe(13000);
    expect(transportSummary?.remaining).toBe(12000);
    expect(transportSummary?.percentUsed).toBeCloseTo(52, 0);
  });

  it("reports percentUsed as null when the allocation is zero (not provisioned)", async () => {
    const categories = createBudgetCategoriesRepository(database);
    const subcategories = createBudgetSubcategoriesRepository(database);
    const transactions = createTransactionsRepository(database);
    const category = await categories.create({ name: "Imprévu" });
    const sub = await subcategories.create({
      categoryId: category.id,
      name: "Divers",
      monthlyAllocation: 0,
    });
    await transactions.create({
      accountId,
      kind: "expense",
      date: "2026-01-01",
      label: "Surprise",
      amount: 5000,
      subcategoryId: sub.id,
    });

    const summary = await getBudgetSummary(2026, 1, database);
    const divers = summary[0]?.subcategories.find((s) => s.name === "Divers");
    expect(divers?.percentUsed).toBeNull();
    expect(divers?.actual).toBe(5000);
    expect(divers?.remaining).toBe(-5000);
  });

  it("rolls up subcategory totals into the category-level totals", async () => {
    const categories = createBudgetCategoriesRepository(database);
    const subcategories = createBudgetSubcategoriesRepository(database);
    const transactions = createTransactionsRepository(database);
    const category = await categories.create({ name: "Vie Courante" });
    const food = await subcategories.create({
      categoryId: category.id,
      name: "Alimentation",
      monthlyAllocation: 40000,
    });
    const transport = await subcategories.create({
      categoryId: category.id,
      name: "Transport",
      monthlyAllocation: 20000,
    });

    await transactions.create({
      accountId,
      kind: "expense",
      date: "2026-01-01",
      label: "A",
      amount: 15000,
      subcategoryId: food.id,
    });
    await transactions.create({
      accountId,
      kind: "expense",
      date: "2026-01-02",
      label: "B",
      amount: 5000,
      subcategoryId: transport.id,
    });

    const summary = await getBudgetSummary(2026, 1, database);
    expect(summary[0]).toMatchObject({
      totalAllocation: 60000,
      totalActual: 20000,
      totalRemaining: 40000,
    });
  });

  it("ignores transactions with no subcategory", async () => {
    const categories = createBudgetCategoriesRepository(database);
    const subcategories = createBudgetSubcategoriesRepository(database);
    const transactions = createTransactionsRepository(database);
    const category = await categories.create({ name: "Vie Courante" });
    await subcategories.create({
      categoryId: category.id,
      name: "Alimentation",
      monthlyAllocation: 40000,
    });

    await transactions.create({
      accountId,
      kind: "expense",
      date: "2026-01-01",
      label: "Non catégorisé",
      amount: 999999,
    });

    const summary = await getBudgetSummary(2026, 1, database);
    expect(summary[0]?.subcategories[0]?.actual).toBe(0);
  });

  it("returns an empty array when there are no categories", async () => {
    expect(await getBudgetSummary(2026, 1, database)).toEqual([]);
  });

  describe("engagements", () => {
    it("subtracts an engaged amount from remaining, alongside actual", async () => {
      const categories = createBudgetCategoriesRepository(database);
      const subcategories = createBudgetSubcategoriesRepository(database);
      const engagements = createEngagementsRepository(database);
      const category = await categories.create({ name: "Vie Courante" });
      const sub = await subcategories.create({
        categoryId: category.id,
        name: "Scolarité",
        monthlyAllocation: 50000,
      });
      await engagements.create({
        subcategoryId: sub.id,
        amount: 30000,
        label: "Frais de scolarité",
        date: "2026-01-15",
      });

      const summary = await getBudgetSummary(2026, 1, database);
      const scolarite = summary[0]?.subcategories.find((s) => s.name === "Scolarité");
      expect(scolarite?.engaged).toBe(30000);
      expect(scolarite?.actual).toBe(0);
      expect(scolarite?.remaining).toBe(20000);
    });

    it("does not let engaged amounts affect percentUsed (actual-only, by design)", async () => {
      const categories = createBudgetCategoriesRepository(database);
      const subcategories = createBudgetSubcategoriesRepository(database);
      const engagements = createEngagementsRepository(database);
      const category = await categories.create({ name: "Vie Courante" });
      const sub = await subcategories.create({
        categoryId: category.id,
        name: "Scolarité",
        monthlyAllocation: 50000,
      });
      await engagements.create({
        subcategoryId: sub.id,
        amount: 30000,
        label: "X",
        date: "2026-01-15",
      });

      const summary = await getBudgetSummary(2026, 1, database);
      const scolarite = summary[0]?.subcategories.find((s) => s.name === "Scolarité");
      expect(scolarite?.percentUsed).toBe(0);
    });

    it("ignores realized and cancelled engagements", async () => {
      const categories = createBudgetCategoriesRepository(database);
      const subcategories = createBudgetSubcategoriesRepository(database);
      const engagements = createEngagementsRepository(database);
      const category = await categories.create({ name: "Vie Courante" });
      const sub = await subcategories.create({
        categoryId: category.id,
        name: "Scolarité",
        monthlyAllocation: 50000,
      });
      const realized = await engagements.create({
        subcategoryId: sub.id,
        amount: 10000,
        label: "Réalisé",
        date: "2026-01-15",
      });
      await engagements.update(realized.id, { status: "realized" });
      const cancelled = await engagements.create({
        subcategoryId: sub.id,
        amount: 5000,
        label: "Annulé",
        date: "2026-01-15",
      });
      await engagements.update(cancelled.id, { status: "cancelled" });

      const summary = await getBudgetSummary(2026, 1, database);
      const scolarite = summary[0]?.subcategories.find((s) => s.name === "Scolarité");
      expect(scolarite?.engaged).toBe(0);
      expect(scolarite?.remaining).toBe(50000);
    });

    it("only counts engagements dated in the requested month", async () => {
      const categories = createBudgetCategoriesRepository(database);
      const subcategories = createBudgetSubcategoriesRepository(database);
      const engagements = createEngagementsRepository(database);
      const category = await categories.create({ name: "Vie Courante" });
      const sub = await subcategories.create({
        categoryId: category.id,
        name: "Scolarité",
        monthlyAllocation: 50000,
      });
      await engagements.create({
        subcategoryId: sub.id,
        amount: 10000,
        label: "Février",
        date: "2026-02-15",
      });

      const summary = await getBudgetSummary(2026, 1, database);
      const scolarite = summary[0]?.subcategories.find((s) => s.name === "Scolarité");
      expect(scolarite?.engaged).toBe(0);
    });

    it("rolls engaged amounts up into the category-level total", async () => {
      const categories = createBudgetCategoriesRepository(database);
      const subcategories = createBudgetSubcategoriesRepository(database);
      const engagements = createEngagementsRepository(database);
      const category = await categories.create({ name: "Vie Courante" });
      const food = await subcategories.create({
        categoryId: category.id,
        name: "Alimentation",
        monthlyAllocation: 40000,
      });
      const transport = await subcategories.create({
        categoryId: category.id,
        name: "Transport",
        monthlyAllocation: 20000,
      });
      await engagements.create({
        subcategoryId: food.id,
        amount: 5000,
        label: "A",
        date: "2026-01-01",
      });
      await engagements.create({
        subcategoryId: transport.id,
        amount: 3000,
        label: "B",
        date: "2026-01-01",
      });

      const summary = await getBudgetSummary(2026, 1, database);
      expect(summary[0]).toMatchObject({
        totalEngaged: 8000,
        totalRemaining: 52000,
      });
    });

    it("combines actual and engaged amounts in remaining", async () => {
      const categories = createBudgetCategoriesRepository(database);
      const subcategories = createBudgetSubcategoriesRepository(database);
      const transactions = createTransactionsRepository(database);
      const engagements = createEngagementsRepository(database);
      const category = await categories.create({ name: "Vie Courante" });
      const sub = await subcategories.create({
        categoryId: category.id,
        name: "Scolarité",
        monthlyAllocation: 50000,
      });
      await transactions.create({
        accountId,
        kind: "expense",
        date: "2026-01-05",
        label: "Déjà payé",
        amount: 15000,
        subcategoryId: sub.id,
      });
      await engagements.create({
        subcategoryId: sub.id,
        amount: 20000,
        label: "À venir",
        date: "2026-01-15",
      });

      const summary = await getBudgetSummary(2026, 1, database);
      const scolarite = summary[0]?.subcategories.find((s) => s.name === "Scolarité");
      expect(scolarite?.actual).toBe(15000);
      expect(scolarite?.engaged).toBe(20000);
      expect(scolarite?.remaining).toBe(15000);
    });
  });
});
