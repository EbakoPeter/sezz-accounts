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

    it("stores an optional category and note when provided", async () => {
      const tx = await transactions.create({
        accountId,
        kind: "expense",
        date: "2026-01-01",
        label: "Carburant",
        amount: 5000,
        subcategoryId: "cat-transport",
        note: "Plein complet",
      });
      expect(tx.subcategoryId).toBe("cat-transport");
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

    it("moves a transaction to a different account", async () => {
      const otherAccountId = (await accounts.create({ name: "Autre", initialBalance: 0 })).id;
      const tx = await transactions.create({
        accountId,
        kind: "expense",
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
        kind: "expense",
        date: "2026-01-01",
        label: "X",
        amount: 100,
      });
      await expect(transactions.update(tx.id, { accountId: "ghost" })).rejects.toThrow(
        NotFoundError,
      );
    });

    it("changes the kind (income <-> expense)", async () => {
      const tx = await transactions.create({
        accountId,
        kind: "expense",
        date: "2026-01-01",
        label: "X",
        amount: 100,
      });
      const updated = await transactions.update(tx.id, { kind: "income" });
      expect(updated.kind).toBe("income");
    });

    it("clears the subcategory when subcategoryId is explicitly null", async () => {
      const tx = await transactions.create({
        accountId,
        kind: "expense",
        date: "2026-01-01",
        label: "X",
        amount: 100,
        subcategoryId: "sub-1",
      });

      const updated = await transactions.update(tx.id, { subcategoryId: null });

      expect(updated.subcategoryId).toBeUndefined();
    });

    it("leaves the subcategory untouched when subcategoryId is omitted from the patch", async () => {
      const tx = await transactions.create({
        accountId,
        kind: "expense",
        date: "2026-01-01",
        label: "X",
        amount: 100,
        subcategoryId: "sub-1",
      });

      const updated = await transactions.update(tx.id, { label: "Renamed" });

      expect(updated.subcategoryId).toBe("sub-1");
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

  describe("deletion log (for sync)", () => {
    it("logs a deletion", async () => {
      const tx = await transactions.create({
        accountId,
        kind: "expense",
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

  describe("budget availability check", () => {
    let categories: BudgetCategoriesRepository;
    let subcategories: BudgetSubcategoriesRepository;
    let engagements: EngagementsRepository;
    let subcategoryId: string;

    beforeEach(async () => {
      categories = createBudgetCategoriesRepository(database);
      subcategories = createBudgetSubcategoriesRepository(database);
      engagements = createEngagementsRepository(database);
      const categoryId = (await categories.create({ name: "Vie Courante" })).id;
      subcategoryId = (
        await subcategories.create({ categoryId, name: "Scolarité", monthlyAllocation: 50000 })
      ).id;
    });

    it("allows an expense within the available budget", async () => {
      await expect(
        transactions.create({
          accountId,
          kind: "expense",
          date: "2026-01-01",
          label: "X",
          amount: 30000,
          subcategoryId,
        }),
      ).resolves.toBeDefined();
    });

    it("rejects an expense that exceeds the allocation, with an explanatory message", async () => {
      await expect(
        transactions.create({
          accountId,
          kind: "expense",
          date: "2026-01-01",
          label: "X",
          amount: 60000,
          subcategoryId,
        }),
      ).rejects.toThrow(ValidationError);
      await expect(
        transactions.create({
          accountId,
          kind: "expense",
          date: "2026-01-01",
          label: "X",
          amount: 60000,
          subcategoryId,
        }),
      ).rejects.toThrow(/dépasse le budget disponible/i);
    });

    it("accounts for prior expenses on the same line and month", async () => {
      await transactions.create({
        accountId,
        kind: "expense",
        date: "2026-01-05",
        label: "Première",
        amount: 30000,
        subcategoryId,
      });
      // 30000 already spent, 50000 allocated -> only 20000 left
      await expect(
        transactions.create({
          accountId,
          kind: "expense",
          date: "2026-01-10",
          label: "Seconde",
          amount: 25000,
          subcategoryId,
        }),
      ).rejects.toThrow(ValidationError);
    });

    it("accounts for engaged amounts on the same line and month", async () => {
      await engagements.create({
        subcategoryId,
        amount: 40000,
        label: "Réservé",
        date: "2026-01-01",
      });
      // 40000 engaged, 50000 allocated -> only 10000 left
      await expect(
        transactions.create({
          accountId,
          kind: "expense",
          date: "2026-01-15",
          label: "X",
          amount: 20000,
          subcategoryId,
        }),
      ).rejects.toThrow(ValidationError);
    });

    it("does not count expenses from a different month", async () => {
      await transactions.create({
        accountId,
        kind: "expense",
        date: "2026-02-01",
        label: "Février",
        amount: 45000,
        subcategoryId,
      });
      await expect(
        transactions.create({
          accountId,
          kind: "expense",
          date: "2026-01-15",
          label: "Janvier",
          amount: 45000,
          subcategoryId,
        }),
      ).resolves.toBeDefined();
    });

    it("does not apply to income, even with a subcategory somehow set", async () => {
      await expect(
        transactions.create({
          accountId,
          kind: "income",
          date: "2026-01-01",
          label: "X",
          amount: 999999,
          subcategoryId,
        }),
      ).resolves.toBeDefined();
    });

    it("does not apply when no subcategory is chosen", async () => {
      await expect(
        transactions.create({
          accountId,
          kind: "expense",
          date: "2026-01-01",
          label: "Non catégorisé",
          amount: 999999,
        }),
      ).resolves.toBeDefined();
    });

    it("does not cap a subcategory with a zero allocation (not provisioned)", async () => {
      const unprovisionedId = (
        await subcategories.create({
          categoryId: (await categories.create({ name: "Imprévu" })).id,
          name: "Divers",
          monthlyAllocation: 0,
        })
      ).id;
      await expect(
        transactions.create({
          accountId,
          kind: "expense",
          date: "2026-01-01",
          label: "Surprise",
          amount: 999999,
          subcategoryId: unprovisionedId,
        }),
      ).resolves.toBeDefined();
    });

    describe("when editing", () => {
      it("excludes the transaction's own prior amount from the check", async () => {
        const tx = await transactions.create({
          accountId,
          kind: "expense",
          date: "2026-01-01",
          label: "X",
          amount: 45000,
          subcategoryId,
        });
        // if the transaction's own 45000 were double-counted, even
        // re-saving the same amount would appear to exceed the 50000
        // allocation (45000 existing + 45000 "new" = 90000)
        await expect(transactions.update(tx.id, { amount: 45000 })).resolves.toBeDefined();
      });

      it("still rejects increasing an expense past what's available", async () => {
        const tx = await transactions.create({
          accountId,
          kind: "expense",
          date: "2026-01-01",
          label: "X",
          amount: 30000,
          subcategoryId,
        });
        await expect(transactions.update(tx.id, { amount: 60000 })).rejects.toThrow(
          ValidationError,
        );
      });

      it("checks the new subcategory when moving an expense onto a tighter budget line", async () => {
        const tightId = (
          await subcategories.create({
            categoryId: (await categories.create({ name: "Serré" })).id,
            name: "Petit budget",
            monthlyAllocation: 5000,
          })
        ).id;
        const tx = await transactions.create({
          accountId,
          kind: "expense",
          date: "2026-01-01",
          label: "X",
          amount: 30000,
          subcategoryId,
        });
        await expect(transactions.update(tx.id, { subcategoryId: tightId })).rejects.toThrow(
          ValidationError,
        );
      });
    });
  });
});
