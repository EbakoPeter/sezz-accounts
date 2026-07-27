import { describe, it, expect, beforeEach } from "vitest";
import { useTestEncryptionSession } from "@/test/testDek";
import { createTestDatabase } from "@/test/testDatabase";
import type { SezzAccountsDatabase } from "@/db/schema";
import { createAccountsRepository } from "./accountsRepository";
import { createTransactionsRepository } from "./transactionsRepository";
import { createBudgetCategoriesRepository } from "./budgetCategoriesRepository";
import { createBudgetSubcategoriesRepository } from "./budgetSubcategoriesRepository";
import { createDebtsRepository } from "./debtsRepository";
import { createEngagementsRepository } from "./engagementsRepository";
import { getRecommendations } from "./recommendations";
import { encryptedFixture } from "@/test/encryptedFixture";
import { generateId } from "@/lib/id";
import type { Transaction } from "@/types/models";

describe("getRecommendations", () => {
  useTestEncryptionSession();
  let database: SezzAccountsDatabase;
  let accountId: string;

  beforeEach(async () => {
    database = createTestDatabase();
    const accounts = createAccountsRepository(database);
    accountId = (await accounts.create({ name: "Compte", initialBalance: 0 })).id;
  });

  /** Seeds an expense directly, bypassing transactions.create() — that
   * repository now requires every expense to settle an existing
   * engagement (see transactionsRepository.ts), which most of this
   * file's tests have no need to set up just to prove insight logic. */
  async function seedExpenseDirectly(overrides: {
    date: string;
    label: string;
    amount: number;
    accountId?: string;
  }) {
    const now = Date.now();
    await database.transactions.add(
      await encryptedFixture<Transaction, "label" | "amount" | "note">(
        {
          id: generateId(),
          accountId: overrides.accountId ?? accountId,
          kind: "expense",
          date: overrides.date,
          label: overrides.label,
          amount: overrides.amount,
          createdAt: now,
          updatedAt: now,
        },
        ["label", "amount", "note"],
      ),
    );
  }

  it("reports 'no alerts' when there is nothing to flag", async () => {
    const insights = await getRecommendations(2026, 6, database);
    expect(insights).toHaveLength(1);
    expect(insights[0]?.id).toBe("all-clear");
    expect(insights[0]?.severity).toBe("success");
  });

  it("flags a warning when expenses exceed income (negative savings rate)", async () => {
    const transactions = createTransactionsRepository(database);
    await transactions.create({
      accountId,
      kind: "income",
      date: "2026-06-01",
      label: "A",
      amount: 1000,
    });
    await seedExpenseDirectly({ date: "2026-06-02", label: "B", amount: 1500 });

    const insights = await getRecommendations(2026, 6, database);
    const savings = insights.find((i) => i.id === "savings-rate");
    expect(savings?.severity).toBe("warning");
  });

  it("reports 'info' for a modest positive savings rate below the target", async () => {
    const transactions = createTransactionsRepository(database);
    await transactions.create({
      accountId,
      kind: "income",
      date: "2026-06-01",
      label: "A",
      amount: 1000,
    });
    await seedExpenseDirectly({ date: "2026-06-02", label: "B", amount: 900 });

    const insights = await getRecommendations(2026, 6, database);
    const savings = insights.find((i) => i.id === "savings-rate");
    expect(savings?.severity).toBe("info");
  });

  it("reports 'success' for a savings rate at or above the target", async () => {
    const transactions = createTransactionsRepository(database);
    await transactions.create({
      accountId,
      kind: "income",
      date: "2026-06-01",
      label: "A",
      amount: 1000,
    });
    await seedExpenseDirectly({ date: "2026-06-02", label: "B", amount: 500 });

    const insights = await getRecommendations(2026, 6, database);
    const savings = insights.find((i) => i.id === "savings-rate");
    expect(savings?.severity).toBe("success");
  });

  it("does not report a savings rate when there is no income at all", async () => {
    await seedExpenseDirectly({ date: "2026-06-02", label: "B", amount: 500 });

    const insights = await getRecommendations(2026, 6, database);
    expect(insights.find((i) => i.id === "savings-rate")).toBeUndefined();
  });

  it("flags a warning when spending rose more than 15% versus the previous month", async () => {
    await seedExpenseDirectly({ date: "2026-05-01", label: "Mai", amount: 1000 });
    await seedExpenseDirectly({ date: "2026-06-01", label: "Juin", amount: 1200 });

    const insights = await getRecommendations(2026, 6, database);
    expect(insights.find((i) => i.id === "spending-trend")?.severity).toBe("warning");
  });

  it("does not flag a spending increase within 15%", async () => {
    await seedExpenseDirectly({ date: "2026-05-01", label: "Mai", amount: 1000 });
    await seedExpenseDirectly({ date: "2026-06-01", label: "Juin", amount: 1050 });

    const insights = await getRecommendations(2026, 6, database);
    expect(insights.find((i) => i.id === "spending-trend")).toBeUndefined();
  });

  it("handles the January -> previous December year boundary for the spending trend", async () => {
    await seedExpenseDirectly({ date: "2025-12-01", label: "Déc", amount: 1000 });
    await seedExpenseDirectly({ date: "2026-01-01", label: "Jan", amount: 2000 });

    const insights = await getRecommendations(2026, 1, database);
    expect(insights.find((i) => i.id === "spending-trend")?.severity).toBe("warning");
  });

  it("flags a budget overrun with the subcategory name in the message", async () => {
    const categories = createBudgetCategoriesRepository(database);
    const subcategories = createBudgetSubcategoriesRepository(database);
    const category = await categories.create({ name: "Vie Courante" });
    const sub = await subcategories.create({
      categoryId: category.id,
      name: "Transport",
      monthlyAllocation: 10000,
    });
    // Seeded directly rather than via transactions.create(): that repository
    // now blocks an expense exceeding its budget line's availability (see
    // transactionsRepository.ts's assertWithinBudget), so this exact
    // scenario can no longer arise through normal use on this device. It
    // remains reachable in practice — synced in from another device, or an
    // allocation lowered after the transaction was already recorded — which
    // is exactly the residual case this warning still exists to catch.
    const now = Date.now();
    await database.transactions.add(
      await encryptedFixture<Transaction, "label" | "amount" | "note">(
        {
          id: generateId(),
          accountId,
          kind: "expense",
          date: "2026-06-05",
          label: "Essence",
          amount: 15000,
          subcategoryId: sub.id,
          createdAt: now,
          updatedAt: now,
        },
        ["label", "amount", "note"],
      ),
    );

    const insights = await getRecommendations(2026, 6, database);
    const overrun = insights.find((i) => i.id === `budget-overrun-${sub.id}`);
    expect(overrun?.severity).toBe("warning");
    expect(overrun?.message).toContain("Transport");
  });

  it("does not flag a subcategory that is not provisioned (allocation 0)", async () => {
    const categories = createBudgetCategoriesRepository(database);
    const subcategories = createBudgetSubcategoriesRepository(database);
    const transactions = createTransactionsRepository(database);
    const engagements = createEngagementsRepository(database);
    const category = await categories.create({ name: "Imprévu" });
    const sub = await subcategories.create({
      categoryId: category.id,
      name: "Divers",
      monthlyAllocation: 0,
    });
    const engagementId = (
      await engagements.create({
        subcategoryId: sub.id,
        amount: 5000,
        label: "X",
        date: "2026-06-05",
      })
    ).id;
    await transactions.create({
      accountId,
      kind: "expense",
      date: "2026-06-05",
      label: "X",
      amount: 5000,
      engagementId,
    });

    const insights = await getRecommendations(2026, 6, database);
    expect(insights.find((i) => i.id === `budget-overrun-${sub.id}`)).toBeUndefined();
  });

  it("flags a negative account balance", async () => {
    await seedExpenseDirectly({ date: "2026-06-01", label: "X", amount: 500 });

    const insights = await getRecommendations(2026, 6, database);
    expect(insights.find((i) => i.id === `negative-balance-${accountId}`)?.severity).toBe(
      "warning",
    );
  });

  it("flags an overdue debt", async () => {
    const debts = createDebtsRepository(database);
    await debts.create({
      kind: "debt",
      counterparty: "Banque",
      accountId,
      amount: 1000,
      date: "2020-01-01",
      dueDate: "2020-02-01",
    });

    const insights = await getRecommendations(2026, 6, database);
    expect(insights.some((i) => i.id.startsWith("overdue-debt-"))).toBe(true);
  });

  it("does not flag a debt that has no due date", async () => {
    const debts = createDebtsRepository(database);
    await debts.create({
      kind: "debt",
      counterparty: "Banque",
      accountId,
      amount: 1000,
      date: "2020-01-01",
    });

    const insights = await getRecommendations(2026, 6, database);
    expect(insights.some((i) => i.id.startsWith("overdue-debt-"))).toBe(false);
  });

  it("can return multiple simultaneous insights", async () => {
    await seedExpenseDirectly({ date: "2026-06-01", label: "X", amount: 5000 });
    const debts = createDebtsRepository(database);
    await debts.create({
      kind: "debt",
      counterparty: "Banque",
      accountId,
      amount: 1000, // this itself is a +1000 inflow on the account (see accountFlows)
      date: "2020-01-01",
      dueDate: "2020-02-01",
    });

    const insights = await getRecommendations(2026, 6, database);
    expect(insights.length).toBeGreaterThanOrEqual(2);
    expect(insights.some((i) => i.id.startsWith("negative-balance-"))).toBe(true);
    expect(insights.some((i) => i.id.startsWith("overdue-debt-"))).toBe(true);
  });
});
