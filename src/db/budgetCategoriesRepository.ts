import type { SezzAccountsDatabase, BudgetCategoryRow } from "./schema";
import { db as defaultDb } from "./schema";
import type { BudgetCategory, NewBudgetCategory, BudgetCategoryUpdate } from "@/types/models";
import { generateId } from "@/lib/id";
import { ValidationError, NotFoundError } from "@/lib/errors";
import {
  toStorageRow,
  fromStorageRow,
  fromStorageRows,
  fromStorageRowOrUndefined,
} from "./encryptedRecord";
import { logDeletion } from "./deletionLog";

const SENSITIVE_CATEGORY_FIELDS = ["name"] as const;

function assertValidName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new ValidationError("Le nom de la catégorie est obligatoire.");
  }
  return trimmed;
}

export function createBudgetCategoriesRepository(database: SezzAccountsDatabase = defaultDb) {
  async function decryptCategory(row: BudgetCategoryRow): Promise<BudgetCategory> {
    return fromStorageRow<BudgetCategory>(row);
  }
  async function decryptCategories(rows: BudgetCategoryRow[]): Promise<BudgetCategory[]> {
    return fromStorageRows<BudgetCategory>(rows);
  }

  async function assertNameIsUnique(name: string, excludeId?: string): Promise<void> {
    const all = await decryptCategories(await database.budgetCategories.toArray());
    const collision = all.find(
      (c) => c.id !== excludeId && c.name.toLowerCase() === name.toLowerCase(),
    );
    if (collision) {
      throw new ValidationError(`Une catégorie nommée « ${name} » existe déjà.`);
    }
  }

  return {
    async create(input: NewBudgetCategory): Promise<BudgetCategory> {
      const name = assertValidName(input.name);
      await assertNameIsUnique(name);

      const now = Date.now();
      const category: BudgetCategory = { id: generateId(), name, createdAt: now, updatedAt: now };
      await database.budgetCategories.add(await toStorageRow(category, SENSITIVE_CATEGORY_FIELDS));
      return category;
    },

    async list(): Promise<BudgetCategory[]> {
      const categories = await decryptCategories(await database.budgetCategories.toArray());
      return categories.sort((a, b) => a.name.localeCompare(b.name));
    },

    async getById(id: string): Promise<BudgetCategory | undefined> {
      const row = await database.budgetCategories.get(id);
      return fromStorageRowOrUndefined<BudgetCategory>(row);
    },

    async update(id: string, patch: BudgetCategoryUpdate): Promise<BudgetCategory> {
      const row = await database.budgetCategories.get(id);
      if (!row) throw new NotFoundError("Catégorie", id);
      const existing = await decryptCategory(row);

      const next: BudgetCategory = { ...existing, updatedAt: Date.now() };
      if (patch.name !== undefined) {
        next.name = assertValidName(patch.name);
        await assertNameIsUnique(next.name, id);
      }
      await database.budgetCategories.put(await toStorageRow(next, SENSITIVE_CATEGORY_FIELDS));
      return next;
    },

    /**
     * Deletes a category. Refuses if it still has subcategories, unless
     * `force` is passed — in which case its subcategories are deleted too,
     * along with any Engagement that referenced one of them (an engagement
     * without its budget line no longer means anything). Any transaction
     * that had settled one of those engagements is only *unlinked* (its
     * subcategoryId and engagementId are cleared), never deleted — a
     * budget line disappearing must never erase real transaction history.
     */
    async remove(id: string, options: { force?: boolean } = {}): Promise<void> {
      const row = await database.budgetCategories.get(id);
      if (!row) throw new NotFoundError("Catégorie", id);
      const existing = await decryptCategory(row);

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
        database.engagements,
        database.transactions,
        database.deletionLog,
        async () => {
          for (const sub of subcategories) {
            const dependentEngagements = await database.engagements
              .where("subcategoryId")
              .equals(sub.id)
              .toArray();
            for (const engagement of dependentEngagements) {
              const settlingTransactions = await database.transactions
                .where("engagementId")
                .equals(engagement.id)
                .toArray();
              for (const tx of settlingTransactions) {
                const { subcategoryId: _sub, engagementId: _eng, ...rest } = tx;
                await database.transactions.put({ ...rest, updatedAt: Date.now() });
              }
            }
            await database.engagements.where("subcategoryId").equals(sub.id).delete();
            for (const engagement of dependentEngagements) {
              await logDeletion(database, "engagements", engagement.id, engagement.seq ?? 0);
            }

            // a transaction may also reference this subcategory directly
            // (income never does, but the field predates engagements
            // being mandatory, and old data may still carry it)
            const directTransactions = await database.transactions
              .where("subcategoryId")
              .equals(sub.id)
              .toArray();
            for (const tx of directTransactions) {
              const { subcategoryId: _removed, ...rest } = tx;
              await database.transactions.put({ ...rest, updatedAt: Date.now() });
            }
          }
          await database.budgetSubcategories.where("categoryId").equals(id).delete();
          for (const sub of subcategories) {
            await logDeletion(database, "budgetSubcategories", sub.id, sub.seq ?? 0);
          }
          await database.budgetCategories.delete(id);
          await logDeletion(database, "budgetCategories", id, row.seq ?? 0);
        },
      );
    },
  };
}

export type BudgetCategoriesRepository = ReturnType<typeof createBudgetCategoriesRepository>;
