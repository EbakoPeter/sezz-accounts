import { describe, it, expect, beforeEach } from "vitest";
import { useTestEncryptionSession } from "@/test/testDek";
import { createTestDatabase } from "@/test/testDatabase";
import type { SezzAccountsDatabase } from "@/db/schema";
import { ensureDebtBudgetLine, computeDebtBudgetAllocation } from "./debtBudgetLine";
import { createDebtsRepository, type DebtsRepository } from "./debtsRepository";
import {
  createDebtPaymentsRepository,
  type DebtPaymentsRepository,
} from "./debtPaymentsRepository";
import { createAccountsRepository, type AccountsRepository } from "./accountsRepository";
import { createBudgetCategoriesRepository } from "./budgetCategoriesRepository";
import {
  createBudgetSubcategoriesRepository,
  type BudgetSubcategoriesRepository,
} from "./budgetSubcategoriesRepository";
import { fromStorageRow } from "./encryptedRecord";
import type { BudgetSubcategory } from "@/types/models";

describe("ensureDebtBudgetLine", () => {
  useTestEncryptionSession();
  let database: SezzAccountsDatabase;

  beforeEach(() => {
    database = createTestDatabase();
  });

  it("skips a category it can't decrypt while searching for an existing 'Dettes' match, rather than failing entirely", async () => {
    // Simulates a category pulled in via sync from a device with a
    // mismatched DEK — exactly the scenario DecryptionError's own message
    // describes. This must not block creating the auto Dette line for
    // everyone else just because one unrelated category is unreadable.
    const { setActiveDek, clearActiveDek } = await import("@/lib/encryptionSession");
    const { generateDekBytes } = await import("@/lib/encryption");
    const { toStorageRow } = await import("./encryptedRecord");

    const originalDek = generateDekBytes();
    setActiveDek(originalDek);
    setActiveDek(generateDekBytes()); // a different device's key
    const mismatchedRow = await toStorageRow(
      { id: "other-device-cat", name: "Une autre catégorie", createdAt: 1, updatedAt: 1 },
      ["name"] as const,
    );
    await database.budgetCategories.add(mismatchedRow);
    setActiveDek(originalDek);

    await expect(ensureDebtBudgetLine(database)).resolves.not.toThrow();

    const categoryRows = await database.budgetCategories.toArray();
    const categories = await Promise.all(
      categoryRows
        .filter((r) => r.id !== "other-device-cat")
        .map((r) => fromStorageRow<{ name: string }>(r)),
    );
    expect(categories).toContainEqual(expect.objectContaining({ name: "Dettes" }));
    clearActiveDek();
    setActiveDek(originalDek);
  });

  it("creates a 'Dettes' category and a 'Dette' subcategory when neither exists", async () => {
    await ensureDebtBudgetLine(database);

    const categoryRows = await database.budgetCategories.toArray();
    const categories = await Promise.all(categoryRows.map((r) => fromStorageRow(r)));
    expect(categories).toContainEqual(expect.objectContaining({ name: "Dettes" }));

    const subcategoryRows = await database.budgetSubcategories.toArray();
    expect(subcategoryRows.some((r) => r.autoAllocateFromDebts === true)).toBe(true);
  });

  it("does nothing on a second call — idempotent", async () => {
    await ensureDebtBudgetLine(database);
    await ensureDebtBudgetLine(database);

    const subcategoryRows = await database.budgetSubcategories.toArray();
    expect(subcategoryRows.filter((r) => r.autoAllocateFromDebts === true)).toHaveLength(1);
  });

  it("reuses an existing 'Dettes' category by name rather than creating a duplicate", async () => {
    const categories = createBudgetCategoriesRepository(database);
    const existing = await categories.create({ name: "Dettes" });

    await ensureDebtBudgetLine(database);

    const categoryRows = await database.budgetCategories.toArray();
    expect(categoryRows).toHaveLength(1);
    const subcategoryRows = await database.budgetSubcategories.toArray();
    const debtLine = subcategoryRows.find((r) => r.autoAllocateFromDebts === true);
    expect(debtLine?.categoryId).toBe(existing.id);
  });

  it("never throws and never duplicates the category/line when two calls overlap on a fresh database", async () => {
    // The same race roleTemplatesRepository.ts and forecastAccount.ts
    // were both found to have: two overlapping calls both see "no
    // auto-allocated line yet" and both try to create one. Plausible here
    // specifically because this runs once per debt created, including
    // many in quick succession during an initial sync pull.
    await Promise.all([ensureDebtBudgetLine(database), ensureDebtBudgetLine(database)]);

    const categoryRows = await database.budgetCategories.toArray();
    expect(categoryRows).toHaveLength(1);
    const subcategoryRows = await database.budgetSubcategories.toArray();
    expect(subcategoryRows.filter((r) => r.autoAllocateFromDebts === true)).toHaveLength(1);
  });
});

describe("computeDebtBudgetAllocation", () => {
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

  it("sums the planned monthly payment of every debt with a due date", async () => {
    await debts.create({
      kind: "debt",
      counterparty: "Banque",
      accountId,
      amount: 120000,
      date: "2026-01-01",
      dueDate: "2027-01-01", // 12 months -> 10000/month
    });
    await debts.create({
      kind: "debt",
      counterparty: "Ami",
      accountId,
      amount: 60000,
      date: "2026-01-01",
      dueDate: "2026-07-01", // 6 months -> 10000/month
    });

    expect(await computeDebtBudgetAllocation(database)).toBe(20000);
  });

  it("excludes a debt with no due date (nothing to derive a monthly figure from)", async () => {
    await debts.create({
      kind: "debt",
      counterparty: "Banque",
      accountId,
      amount: 120000,
      date: "2026-01-01",
    });

    expect(await computeDebtBudgetAllocation(database)).toBe(0);
  });

  it("excludes a créance — only actual debts count toward this line", async () => {
    await debts.create({
      kind: "receivable",
      counterparty: "Cousin",
      accountId,
      amount: 60000,
      date: "2026-01-01",
      dueDate: "2026-07-01",
    });

    expect(await computeDebtBudgetAllocation(database)).toBe(0);
  });

  it("excludes a debt that's already fully repaid", async () => {
    const debt = await debts.create({
      kind: "debt",
      counterparty: "Banque",
      accountId,
      amount: 60000,
      date: "2026-01-01",
      dueDate: "2026-07-01",
    });
    await payments.create({ debtId: debt.id, accountId, amount: 60000, date: "2026-02-01" });

    expect(await computeDebtBudgetAllocation(database)).toBe(0);
  });

  it("still counts a partially repaid debt at its own full planned payment (not reduced by what's already paid)", async () => {
    const debt = await debts.create({
      kind: "debt",
      counterparty: "Banque",
      accountId,
      amount: 120000,
      date: "2026-01-01",
      dueDate: "2027-01-01", // 10000/month
    });
    await payments.create({ debtId: debt.id, accountId, amount: 20000, date: "2026-02-01" });

    // still owed something, so its planned monthly figure still counts in
    // full -- the point of this line is "how much should be set aside
    // monthly", not "how much is technically left to pay this instant"
    expect(await computeDebtBudgetAllocation(database)).toBe(10000);
  });

  it("returns 0 with no debts at all", async () => {
    expect(await computeDebtBudgetAllocation(database)).toBe(0);
  });
});

describe("integration with debtsRepository", () => {
  useTestEncryptionSession();
  let database: SezzAccountsDatabase;
  let accounts: AccountsRepository;
  let debts: DebtsRepository;
  let subcategories: BudgetSubcategoriesRepository;
  let accountId: string;

  beforeEach(async () => {
    database = createTestDatabase();
    accounts = createAccountsRepository(database);
    debts = createDebtsRepository(database);
    subcategories = createBudgetSubcategoriesRepository(database);
    accountId = (await accounts.create({ name: "Compte", initialBalance: 0 })).id;
  });

  it("creates the debt budget line automatically the first time a debt is created", async () => {
    expect(await subcategories.list({})).toHaveLength(0);

    await debts.create({
      kind: "debt",
      counterparty: "Banque",
      accountId,
      amount: 60000,
      date: "2026-01-01",
      dueDate: "2026-07-01",
    });

    const all = await subcategories.list({});
    expect(all.some((s: BudgetSubcategory) => s.name === "Dette")).toBe(true);
  });

  it("does not create the line for a créance", async () => {
    await debts.create({
      kind: "receivable",
      counterparty: "Cousin",
      accountId,
      amount: 60000,
      date: "2026-01-01",
    });

    expect(await subcategories.list({})).toHaveLength(0);
  });

  it("creates the line when a créance is later changed to a debt", async () => {
    const debt = await debts.create({
      kind: "receivable",
      counterparty: "Cousin",
      accountId,
      amount: 60000,
      date: "2026-01-01",
      dueDate: "2026-07-01",
    });
    expect(await subcategories.list({})).toHaveLength(0);

    await debts.update(debt.id, { kind: "debt" });

    expect(await subcategories.list({})).toHaveLength(1);
  });
});
