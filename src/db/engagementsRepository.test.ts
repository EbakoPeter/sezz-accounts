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
import { createEngagementsRepository, type EngagementsRepository } from "./engagementsRepository";
import { ValidationError, NotFoundError } from "@/lib/errors";

describe("EngagementsRepository", () => {
  useTestEncryptionSession();
  let database: SezzAccountsDatabase;
  let categories: BudgetCategoriesRepository;
  let subcategories: BudgetSubcategoriesRepository;
  let engagements: EngagementsRepository;
  let subcategoryId: string;

  beforeEach(async () => {
    database = createTestDatabase();
    categories = createBudgetCategoriesRepository(database);
    subcategories = createBudgetSubcategoriesRepository(database);
    engagements = createEngagementsRepository(database);
    const categoryId = (await categories.create({ name: "Vie Courante" })).id;
    subcategoryId = (
      await subcategories.create({ categoryId, name: "Scolarité", monthlyAllocation: 50000 })
    ).id;
  });

  describe("create", () => {
    it("creates an engagement with status 'engaged' by default", async () => {
      const engagement = await engagements.create({
        subcategoryId,
        amount: 30000,
        label: "Frais de scolarité",
        date: "2026-01-15",
      });
      expect(engagement.status).toBe("engaged");
      expect(engagement.amount).toBe(30000);
      expect(engagement.subcategoryId).toBe(subcategoryId);
    });

    it("rejects an unknown subcategory", async () => {
      await expect(
        engagements.create({
          subcategoryId: "ghost",
          amount: 1000,
          label: "X",
          date: "2026-01-01",
        }),
      ).rejects.toThrow(NotFoundError);
    });

    it("rejects a non-positive amount", async () => {
      await expect(
        engagements.create({ subcategoryId, amount: 0, label: "X", date: "2026-01-01" }),
      ).rejects.toThrow(ValidationError);
    });

    it("rejects an empty label", async () => {
      await expect(
        engagements.create({ subcategoryId, amount: 1000, label: "   ", date: "2026-01-01" }),
      ).rejects.toThrow(ValidationError);
    });

    it("rejects an invalid date", async () => {
      await expect(
        engagements.create({ subcategoryId, amount: 1000, label: "X", date: "not-a-date" }),
      ).rejects.toThrow(ValidationError);
    });
  });

  describe("list", () => {
    it("filters by subcategory", async () => {
      const otherSubcategoryId = (
        await subcategories.create({
          categoryId: (await categories.create({ name: "Autre" })).id,
          name: "Autre Sous",
          monthlyAllocation: 1000,
        })
      ).id;
      await engagements.create({
        subcategoryId,
        amount: 1000,
        label: "A",
        date: "2026-01-01",
      });
      await engagements.create({
        subcategoryId: otherSubcategoryId,
        amount: 2000,
        label: "B",
        date: "2026-01-01",
      });

      const list = await engagements.list({ subcategoryId });
      expect(list).toHaveLength(1);
      expect(list[0]?.label).toBe("A");
    });

    it("filters by year and month", async () => {
      await engagements.create({
        subcategoryId,
        amount: 1000,
        label: "Janvier",
        date: "2026-01-15",
      });
      await engagements.create({
        subcategoryId,
        amount: 2000,
        label: "Février",
        date: "2026-02-15",
      });

      const list = await engagements.list({ year: 2026, month: 1 });
      expect(list).toHaveLength(1);
      expect(list[0]?.label).toBe("Janvier");
    });

    it("sorts by date, most recent first", async () => {
      await engagements.create({
        subcategoryId,
        amount: 1000,
        label: "Ancien",
        date: "2026-01-01",
      });
      await engagements.create({
        subcategoryId,
        amount: 1000,
        label: "Récent",
        date: "2026-01-15",
      });

      const list = await engagements.list();
      expect(list.map((e) => e.label)).toEqual(["Récent", "Ancien"]);
    });
  });

  describe("update", () => {
    it("never changes status via update, even if a caller bypasses the type system", async () => {
      const engagement = await engagements.create({
        subcategoryId,
        amount: 1000,
        label: "X",
        date: "2026-01-01",
      });
      expect(engagement.status).toBe("engaged");

      // status is deliberately not part of EngagementUpdate -- this
      // simulates a caller that bypasses TypeScript entirely (plain JS,
      // an `any`-typed value, a stray extra property), confirming the
      // repository itself ignores it rather than relying on the type
      // system as the only thing preventing this
      const updated = await engagements.update(engagement.id, {
        label: "Y",
        status: "realized",
      } as unknown as Parameters<typeof engagements.update>[1]);

      expect(updated.label).toBe("Y");
      expect(updated.status).toBe("engaged");
    });

    it("updates the amount and label", async () => {
      const engagement = await engagements.create({
        subcategoryId,
        amount: 1000,
        label: "Avant",
        date: "2026-01-01",
      });
      const updated = await engagements.update(engagement.id, { amount: 2000, label: "Après" });
      expect(updated.amount).toBe(2000);
      expect(updated.label).toBe("Après");
    });

    it("moves an engagement to a different subcategory", async () => {
      const otherSubcategoryId = (
        await subcategories.create({
          categoryId: (await categories.create({ name: "Autre" })).id,
          name: "Autre Sous",
          monthlyAllocation: 1000,
        })
      ).id;
      const engagement = await engagements.create({
        subcategoryId,
        amount: 1000,
        label: "X",
        date: "2026-01-01",
      });
      const updated = await engagements.update(engagement.id, {
        subcategoryId: otherSubcategoryId,
      });
      expect(updated.subcategoryId).toBe(otherSubcategoryId);
    });

    it("throws NotFoundError for an unknown id", async () => {
      await expect(engagements.update("nope", { amount: 1 })).rejects.toThrow(NotFoundError);
    });
  });

  describe("remove", () => {
    it("deletes the engagement", async () => {
      const engagement = await engagements.create({
        subcategoryId,
        amount: 1000,
        label: "X",
        date: "2026-01-01",
      });
      await engagements.remove(engagement.id);
      expect(await engagements.getById(engagement.id)).toBeUndefined();
    });

    it("logs the deletion for sync", async () => {
      const engagement = await engagements.create({
        subcategoryId,
        amount: 1000,
        label: "X",
        date: "2026-01-01",
      });
      await engagements.remove(engagement.id);

      const entries = await database.deletionLog.toArray();
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ tableName: "engagements", recordId: engagement.id });
    });

    it("throws NotFoundError for an unknown id", async () => {
      await expect(engagements.remove("nope")).rejects.toThrow(NotFoundError);
    });
  });
});
