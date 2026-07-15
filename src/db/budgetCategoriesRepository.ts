import type { SezzAccountsDatabase } from "./schema";
import { db as defaultDb } from "./schema";
import type { BudgetCategory, NewBudgetCategory, BudgetCategoryUpdate } from "@/types/models";
import { generateId } from "@/lib/id";
import { ValidationError, NotFoundError } from "@/lib/errors";

function assertValidName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new ValidationError("Le nom de la catégorie est obligatoire.");
  }
  return trimmed;
}

export function createBudgetCategoriesRepository(database: SezzAccountsDatabase = defaultDb) {
  async function assertNameIsUnique(name: string, excludeId?: string): Promise<void> {
    const existing = await database.budgetCategories.where("name").equalsIgnoreCase(name).first();
    if (existing && existing.id !== excludeId) {
      throw new ValidationError(`Une catégorie nommée « ${name} » existe déjà.`);
    }
  }

  return {
    async create(input: NewBudgetCategory): Promise<BudgetCategory> {
      const name = assertValidName(input.name);
      await assertNameIsUnique(name);

      const now = Date.now();
      const category: BudgetCategory = { id: generateId(), name, createdAt: now, updatedAt: now };
      await database.budgetCategories.add(category);
      return category;
    },

    async list(): Promise<BudgetCategory[]> {
      return database.budgetCategories.orderBy("name").toArray();
    },

    async getById(id: string): Promise<BudgetCategory | undefined> {
      return database.budgetCategories.get(id);
    },

    async update(id: string, patch: BudgetCategoryUpdate): Promise<BudgetCategory> {
      const existing = await database.budgetCategories.get(id);
      if (!existing) throw new NotFoundError("Catégorie", id);

      const next: BudgetCategory = { ...existing, updatedAt: Date.now() };
      if (patch.name !== undefined) {
        next.name = assertValidName(patch.name);
        await assertNameIsUnique(next.name, id);
      }
      await database.budgetCategories.put(next);
      return next;
    },

    /**
     * Deletes a category. Refuses if it still has subcategories, unless
     * `force` is passed — in which case its subcategories are deleted too,
     * but any transaction that referenced one of them is only *unlinked*
     * (its `subcategoryId` is cleared), never deleted. A budget line
     * disappearing must never erase real transaction history.
     */
    async remove(id: string, options: { force?: boolean } = {}): Promise<void> {
      const existing = await database.budgetCategories.get(id);
      if (!existing) throw new NotFoundError("Catégorie", id);

      const subcategories = await database.budgetSubcategories
        .where("categoryId")
        .equals(id)
        .toArray();
      if (subcategories.length > 0 && !options.force) {
        throw new ValidationError(
          `Impossible de supprimer « ${existing.name} » : ${subcategories.length} sous-catégorie(s) en dépendent encore.`,
        );
      }

      await database.transaction(
        "rw",
        database.budgetCategories,
        database.budgetSubcategories,
        database.transactions,
        async () => {
          for (const sub of subcategories) {
            const dependentTransactions = await database.transactions
              .where("subcategoryId")
              .equals(sub.id)
              .toArray();
            for (const tx of dependentTransactions) {
              const { subcategoryId: _removed, ...rest } = tx;
              await database.transactions.put({ ...rest, updatedAt: Date.now() });
            }
          }
          await database.budgetSubcategories.where("categoryId").equals(id).delete();
          await database.budgetCategories.delete(id);
        },
      );
    },
  };
}

export type BudgetCategoriesRepository = ReturnType<typeof createBudgetCategoriesRepository>;
