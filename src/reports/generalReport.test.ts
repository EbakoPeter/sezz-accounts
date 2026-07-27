import { describe, it, expect, beforeEach } from "vitest";
import { useTestEncryptionSession } from "@/test/testDek";
import { createTestDatabase } from "@/test/testDatabase";
import type { SezzAccountsDatabase } from "@/db/schema";
import { createAccountsRepository } from "@/db/accountsRepository";
import { createTransactionsRepository } from "@/db/transactionsRepository";
import { createBudgetCategoriesRepository } from "@/db/budgetCategoriesRepository";
import { createBudgetSubcategoriesRepository } from "@/db/budgetSubcategoriesRepository";
import { createEngagementsRepository } from "@/db/engagementsRepository";
import { createDebtsRepository } from "@/db/debtsRepository";
import { generateGeneralReportPdf } from "./generalReport";

describe("generateGeneralReportPdf", () => {
  useTestEncryptionSession();
  let database: SezzAccountsDatabase;

  beforeEach(() => {
    database = createTestDatabase();
  });

  it("produces a valid PDF document with no data at all", async () => {
    const doc = await generateGeneralReportPdf(database, 2030, 1);
    expect(doc.output().startsWith("%PDF")).toBe(true);
  });

  it("includes accounts, transactions, and budget data without throwing", async () => {
    const accounts = createAccountsRepository(database);
    const transactions = createTransactionsRepository(database);
    const categories = createBudgetCategoriesRepository(database);
    const subcategories = createBudgetSubcategoriesRepository(database);

    const account = await accounts.create({ name: "Compte", initialBalance: 50000 });
    await transactions.create({
      accountId: account.id,
      kind: "income",
      date: "2030-01-05",
      label: "Salaire",
      amount: 200000,
    });
    const category = await categories.create({ name: "Vie Courante" });
    await subcategories.create({
      categoryId: category.id,
      name: "Alimentation",
      monthlyAllocation: 40000,
    });

    const doc = await generateGeneralReportPdf(database, 2030, 1);
    expect(doc.output().startsWith("%PDF")).toBe(true);
    expect(doc.output().length).toBeGreaterThan(500);
  });

  it("includes the engagements and debts tables, growing the document as they're added", async () => {
    const accounts = createAccountsRepository(database);
    const categories = createBudgetCategoriesRepository(database);
    const subcategories = createBudgetSubcategoriesRepository(database);
    const engagements = createEngagementsRepository(database);
    const debts = createDebtsRepository(database);

    const account = await accounts.create({ name: "Compte", initialBalance: 50000 });
    const withoutExtras = await generateGeneralReportPdf(database, 2030, 1);

    const category = await categories.create({ name: "Vie Courante" });
    const sub = await subcategories.create({
      categoryId: category.id,
      name: "Scolarité",
      monthlyAllocation: 40000,
    });
    await engagements.create({
      subcategoryId: sub.id,
      amount: 15000,
      label: "Frais de scolarité",
      date: "2030-01-10",
    });
    await debts.create({
      kind: "debt",
      counterparty: "Banque",
      accountId: account.id,
      amount: 100000,
      date: "2030-01-01",
    });

    const withExtras = await generateGeneralReportPdf(database, 2030, 1);
    expect(withExtras.output().length).toBeGreaterThan(withoutExtras.output().length);
  });
});
