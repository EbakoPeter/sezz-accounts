import { describe, it, expect, beforeEach } from "vitest";
import { useTestEncryptionSession } from "@/test/testDek";
import { createTestDatabase } from "@/test/testDatabase";
import type { SezzAccountsDatabase } from "@/db/schema";
import { createAccountsRepository, type AccountsRepository } from "./accountsRepository";
import {
  createTransactionsRepository,
  type TransactionsRepository,
} from "./transactionsRepository";
import {
  createBudgetCategoriesRepository,
  type BudgetCategoriesRepository,
} from "./budgetCategoriesRepository";
import {
  createBudgetSubcategoriesRepository,
  type BudgetSubcategoriesRepository,
} from "./budgetSubcategoriesRepository";
import { createEngagementsRepository, type EngagementsRepository } from "./engagementsRepository";
import { ValidationError, NotFoundError } from "@/lib/errors";

describe("TransactionsRepository", () => {
  useTestEncryptionSession();
  let database: SezzAccountsDatabase;
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

    it("derives the subcategory from its engagement, and stores an optional note", async () => {
      const categories = createBudgetCategoriesRepository(database);
      const subcategories = createBudgetSubcategoriesRepository(database);
      const engagements = createEngagementsRepository(database);
      const categoryId = (await categories.create({ name: "Vie Courante" })).id;
      const subcategoryId = (
        await subcategories.create({ categoryId, name: "Transport", monthlyAllocation: 20000 })
      ).id;
      const engagementId = (
        await engagements.create({
          subcategoryId,
          amount: 5000,
          label: "Carburant",
          date: "2026-01-01",
        })
      ).id;

      const tx = await transactions.create({
        accountId,
        kind: "expense",
        date: "2026-01-01",
        label: "Carburant",
        amount: 5000,
        engagementId,
        note: "Plein complet",
      });
      expect(tx.subcategoryId).toBe(subcategoryId);
      expect(tx.note).toBe("Plein complet");
    });
  });

  describe("list / filtering", () => {
    beforeEach(async () => {
      const categories = createBudgetCategoriesRepository(database);
      const subcategories = createBudgetSubcategoriesRepository(database);
      const engagements = createEngagementsRepository(database);
      const categoryId = (await categories.create({ name: "Vie Courante" })).id;
      const subcategoryId = (
        await subcategories.create({ categoryId, name: "Divers", monthlyAllocation: 100000 })
      ).id;
      const loyerEngagementId = (
        await engagements.create({
          subcategoryId,
          amount: 50000,
          label: "Loyer",
          date: "2026-01-10",
        })
      ).id;
      const coursesEngagementId = (
        await engagements.create({
          subcategoryId,
          amount: 20000,
          label: "Courses",
          date: "2026-02-01",
        })
      ).id;

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
        engagementId: loyerEngagementId,
      });
      await transactions.create({
        accountId,
        kind: "expense",
        date: "2026-02-01",
        label: "Courses",
        amount: 20000,
        engagementId: coursesEngagementId,
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
        kind: "income",
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
        kind: "income",
        date: "2026-01-01",
        label: "X",
        amount: 100,
      });
      await expect(transactions.update(tx.id, { amount: -5 })).rejects.toThrow(ValidationError);
    });

    it("throws NotFoundError for an unknown id", async () => {
      await expect(transactions.update("nope", { label: "X" })).rejects.toThrow(NotFoundError);
    });

    it("moves a transaction to a different account", async () => {
      const otherAccountId = (await accounts.create({ name: "Autre", initialBalance: 0 })).id;
      const tx = await transactions.create({
        accountId,
        kind: "income",
        date: "2026-01-01",
        label: "X",
        amount: 100,
      });

      const updated = await transactions.update(tx.id, { accountId: otherAccountId });

      expect(updated.accountId).toBe(otherAccountId);
    });

    it("rejects moving a transaction to a non-existent account", async () => {
      const tx = await transactions.create({
        accountId,
        kind: "income",
        date: "2026-01-01",
        label: "X",
        amount: 100,
      });
      await expect(transactions.update(tx.id, { accountId: "ghost" })).rejects.toThrow(
        NotFoundError,
      );
    });
  });

  describe("remove", () => {
    it("deletes the transaction", async () => {
      const tx = await transactions.create({
        accountId,
        kind: "income",
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
      const categories = createBudgetCategoriesRepository(database);
      const subcategories = createBudgetSubcategoriesRepository(database);
      const engagements = createEngagementsRepository(database);
      const categoryId = (await categories.create({ name: "Vie Courante" })).id;
      const subcategoryId = (
        await subcategories.create({ categoryId, name: "Divers", monthlyAllocation: 10000 })
      ).id;
      const engagementId = (
        await engagements.create({ subcategoryId, amount: 300, label: "Out", date: "2026-01-02" })
      ).id;

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
        engagementId,
      });
      expect(await transactions.netTotal({ accountId })).toBe(700);
    });

    it("returns 0 for an empty filter result", async () => {
      expect(await transactions.netTotal({ accountId: "ghost-account" })).toBe(0);
    });
  });

  describe("deletion log (for sync)", () => {
    it("logs a deletion", async () => {
      const tx = await transactions.create({
        accountId,
        kind: "income",
        date: "2026-01-01",
        label: "Test",
        amount: 100,
      });
      await transactions.remove(tx.id);

      const entries = await database.deletionLog.toArray();
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ tableName: "transactions", recordId: tx.id });
    });
  });

  describe("engagement settlement (every expense must settle an existing engagement)", () => {
    let categories: BudgetCategoriesRepository;
    let subcategories: BudgetSubcategoriesRepository;
    let engagements: EngagementsRepository;
    let subcategoryId: string;
    let engagementId: string;

    beforeEach(async () => {
      categories = createBudgetCategoriesRepository(database);
      subcategories = createBudgetSubcategoriesRepository(database);
      engagements = createEngagementsRepository(database);
      const categoryId = (await categories.create({ name: "Vie Courante" })).id;
      subcategoryId = (
        await subcategories.create({ categoryId, name: "Scolarité", monthlyAllocation: 50000 })
      ).id;
      engagementId = (
        await engagements.create({
          subcategoryId,
          amount: 30000,
          label: "Frais de scolarité",
          date: "2026-01-01",
        })
      ).id;
    });

    it("rejects an expense with no engagement at all, with an explanatory message", async () => {
      await expect(
        transactions.create({
          accountId,
          kind: "expense",
          date: "2026-01-01",
          label: "X",
          amount: 1000,
        }),
      ).rejects.toThrow(ValidationError);
      await expect(
        transactions.create({
          accountId,
          kind: "expense",
          date: "2026-01-01",
          label: "X",
          amount: 1000,
        }),
      ).rejects.toThrow(/rattachée à un engagement/i);
    });

    it("allows an expense exactly equal to the engaged amount", async () => {
      await expect(
        transactions.create({
          accountId,
          kind: "expense",
          date: "2026-01-01",
          label: "X",
          amount: 30000,
          engagementId,
        }),
      ).resolves.toBeDefined();
    });

    it("allows an expense for less than the engaged amount (e.g. the actual bill was lower)", async () => {
      await expect(
        transactions.create({
          accountId,
          kind: "expense",
          date: "2026-01-01",
          label: "X",
          amount: 20000,
          engagementId,
        }),
      ).resolves.toBeDefined();
    });

    it("rejects an expense exceeding the engaged amount, with an explanatory message", async () => {
      await expect(
        transactions.create({
          accountId,
          kind: "expense",
          date: "2026-01-01",
          label: "X",
          amount: 30001,
          engagementId,
        }),
      ).rejects.toThrow(ValidationError);
      await expect(
        transactions.create({
          accountId,
          kind: "expense",
          date: "2026-01-01",
          label: "X",
          amount: 30001,
          engagementId,
        }),
      ).rejects.toThrow(/dépasse ce qui a été engagé/i);
    });

    it("rejects settling a cancelled engagement", async () => {
      await engagements.update(engagementId, { status: "cancelled" });
      await expect(
        transactions.create({
          accountId,
          kind: "expense",
          date: "2026-01-01",
          label: "X",
          amount: 10000,
          engagementId,
        }),
      ).rejects.toThrow(/annulé/i);
    });

    it("rejects settling an engagement already settled by another transaction", async () => {
      await transactions.create({
        accountId,
        kind: "expense",
        date: "2026-01-01",
        label: "Première",
        amount: 10000,
        engagementId,
      });
      await expect(
        transactions.create({
          accountId,
          kind: "expense",
          date: "2026-01-02",
          label: "Seconde",
          amount: 5000,
          engagementId,
        }),
      ).rejects.toThrow(/déjà réalisé/i);
    });

    it("rejects a nonexistent engagement id", async () => {
      await expect(
        transactions.create({
          accountId,
          kind: "expense",
          date: "2026-01-01",
          label: "X",
          amount: 1000,
          engagementId: "does-not-exist",
        }),
      ).rejects.toThrow(NotFoundError);
    });

    it("automatically marks the engagement as réalisé once settled", async () => {
      await transactions.create({
        accountId,
        kind: "expense",
        date: "2026-01-01",
        label: "X",
        amount: 10000,
        engagementId,
      });
      expect((await engagements.getById(engagementId))?.status).toBe("realized");
    });

    it("derives the subcategory from the engagement automatically", async () => {
      const tx = await transactions.create({
        accountId,
        kind: "expense",
        date: "2026-01-01",
        label: "X",
        amount: 10000,
        engagementId,
      });
      expect(tx.subcategoryId).toBe(subcategoryId);
    });

    it("does not require an engagement for income", async () => {
      await expect(
        transactions.create({
          accountId,
          kind: "income",
          date: "2026-01-01",
          label: "Salaire",
          amount: 500000,
        }),
      ).resolves.toBeDefined();
    });

    describe("when editing", () => {
      it("re-validates the amount against the same engagement, without tripping over its own settlement", async () => {
        const tx = await transactions.create({
          accountId,
          kind: "expense",
          date: "2026-01-01",
          label: "X",
          amount: 30000,
          engagementId,
        });
        // if the transaction's own settlement were mistaken for "someone
        // else already settled it", even lowering its own amount would fail
        await expect(transactions.update(tx.id, { amount: 25000 })).resolves.toBeDefined();
      });

      it("still rejects increasing past the engaged amount", async () => {
        const tx = await transactions.create({
          accountId,
          kind: "expense",
          date: "2026-01-01",
          label: "X",
          amount: 20000,
          engagementId,
        });
        await expect(transactions.update(tx.id, { amount: 40000 })).rejects.toThrow(
          ValidationError,
        );
      });

      it("releases the old engagement and settles the new one, when moved to a different engagement", async () => {
        const otherEngagementId = (
          await engagements.create({
            subcategoryId,
            amount: 15000,
            label: "Autre dépense",
            date: "2026-01-05",
          })
        ).id;
        const tx = await transactions.create({
          accountId,
          kind: "expense",
          date: "2026-01-01",
          label: "X",
          amount: 20000,
          engagementId,
        });

        await transactions.update(tx.id, { engagementId: otherEngagementId, amount: 10000 });

        expect((await engagements.getById(engagementId))?.status).toBe("engaged");
        expect((await engagements.getById(otherEngagementId))?.status).toBe("realized");
      });

      it("releases the engagement back to engagé when the transaction becomes income", async () => {
        const tx = await transactions.create({
          accountId,
          kind: "expense",
          date: "2026-01-01",
          label: "X",
          amount: 20000,
          engagementId,
        });

        await transactions.update(tx.id, { kind: "income" });

        expect((await engagements.getById(engagementId))?.status).toBe("engaged");
      });

      it("requires an engagement when an income transaction becomes an expense", async () => {
        const tx = await transactions.create({
          accountId,
          kind: "income",
          date: "2026-01-01",
          label: "X",
          amount: 5000,
        });
        await expect(transactions.update(tx.id, { kind: "expense" })).rejects.toThrow(
          ValidationError,
        );
      });
    });

    describe("on deletion", () => {
      it("releases the engagement back to engagé when its settling transaction is deleted", async () => {
        const tx = await transactions.create({
          accountId,
          kind: "expense",
          date: "2026-01-01",
          label: "X",
          amount: 20000,
          engagementId,
        });

        await transactions.remove(tx.id);

        expect((await engagements.getById(engagementId))?.status).toBe("engaged");
      });
    });
  });
});
