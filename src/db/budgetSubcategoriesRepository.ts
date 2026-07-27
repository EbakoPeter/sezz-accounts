import type { SezzAccountsDatabase, BudgetSubcategoryRow } from "./schema";
import { db as defaultDb } from "./schema";
import type {
  BudgetSubcategory,
  NewBudgetSubcategory,
  BudgetSubcategoryUpdate,
} from "@/types/models";
import { generateId } from "@/lib/id";
import { assertNonNegativeAmount } from "@/lib/money";
import { ValidationError, NotFoundError } from "@/lib/errors";
import { toStorageRow, fromStorageRow, fromStorageRows } from "./encryptedRecord";
import { logDeletion } from "./deletionLog";

const SENSITIVE_SUBCATEGORY_FIELDS = ["name", "monthlyAllocation"] as const;

function assertValidName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new ValidationError("Le nom de la sous-catégorie est obligatoire.");
  }
  return trimmed;
}

export function createBudgetSubcategoriesRepository(database: SezzAccountsDatabase = defaultDb) {
  async function decryptSubcategory(row: BudgetSubcategoryRow): Promise<BudgetSubcategory> {
    return fromStorageRow<BudgetSubcategory>(row);
  }
  async function decryptSubcategories(rows: BudgetSubcategoryRow[]): Promise<BudgetSubcategory[]> {
    return fromStorageRows<BudgetSubcategory>(rows);
  }

  async function assertCategoryExists(categoryId: string): Promise<void> {
    const category = await database.budgetCategories.get(categoryId);
    if (!category) throw new NotFoundError("Catégorie", categoryId);
  }

  async function assertNameIsUniqueWithinCategory(
    categoryId: string,
    name: string,
    excludeId?: string,
  ): Promise<void> {
    const siblings = await decryptSubcategories(
      await database.budgetSubcategories.where("categoryId").equals(categoryId).toArray(),
    );
    const collision = siblings.find(
      (s) => s.id !== excludeId && s.name.toLowerCase() === name.toLowerCase(),
    );
    if (collision) {
      throw new ValidationError(
        `Une sous-catégorie nommée « ${name} » existe déjà dans cette catégorie.`,
      );
    }
  }

  return {
    async create(input: NewBudgetSubcategory): Promise<BudgetSubcategory> {
      await assertCategoryExists(input.categoryId);
      const name = assertValidName(input.name);
      assertNonNegativeAmount(input.monthlyAllocation, "L'allocation mensuelle");
      await assertNameIsUniqueWithinCategory(input.categoryId, name);

      const now = Date.now();
      const subcategory: BudgetSubcategory = {
        id: generateId(),
        categoryId: input.categoryId,
        name,
        monthlyAllocation: input.monthlyAllocation,
        createdAt: now,
        updatedAt: now,
      };
      await database.budgetSubcategories.add(
        await toStorageRow(subcategory, SENSITIVE_SUBCATEGORY_FIELDS),
      );
      return subcategory;
    },

    async list(filter: { categoryId?: string } = {}): Promise<BudgetSubcategory[]> {
      const rows = filter.categoryId
        ? await database.budgetSubcategories.where("categoryId").equals(filter.categoryId).toArray()
        : await database.budgetSubcategories.toArray();
      const subcategories = await decryptSubcategories(rows);
      return subcategories.sort((a, b) => a.name.localeCompare(b.name));
    },

    async getById(id: string): Promise<BudgetSubcategory | undefined> {
      const row = await database.budgetSubcategories.get(id);
      return row ? decryptSubcategory(row) : undefined;
    },

    async update(id: string, patch: BudgetSubcategoryUpdate): Promise<BudgetSubcategory> {
      const row = await database.budgetSubcategories.get(id);
      if (!row) throw new NotFoundError("Sous-catégorie", id);
      const existing = await decryptSubcategory(row);

      const next: BudgetSubcategory = { ...existing, updatedAt: Date.now() };
      if (patch.name !== undefined) {
        next.name = assertValidName(patch.name);
        await assertNameIsUniqueWithinCategory(existing.categoryId, next.name, id);
      }
      if (patch.monthlyAllocation !== undefined) {
        assertNonNegativeAmount(patch.monthlyAllocation, "L'allocation mensuelle");
        next.monthlyAllocation = patch.monthlyAllocation;
      }
      await database.budgetSubcategories.put(
        await toStorageRow(next, SENSITIVE_SUBCATEGORY_FIELDS),
      );
      return next;
    },

    /** Deletes a subcategory. Refuses if engagements or transactions still
     * reference it, unless `force` is passed — in which case those
     * engagements are deleted (an engagement without its budget line no
     * longer means anything) and any transaction that had settled one of
     * them, or referenced this subcategory directly, is only *unlinked*
     * (subcategoryId/engagementId cleared), never deleted. */
    async remove(id: string, options: { force?: boolean } = {}): Promise<void> {
      const row = await database.budgetSubcategories.get(id);
      if (!row) throw new NotFoundError("Sous-catégorie", id);
      const existing = await decryptSubcategory(row);

      const dependentEngagements = await database.engagements
        .where("subcategoryId")
        .equals(id)
        .toArray();
      const directTransactionCountForGuard = await database.transactions
        .where("subcategoryId")
        .equals(id)
        .count();
      if (
        (dependentEngagements.length > 0 || directTransactionCountForGuard > 0) &&
        !options.force
      ) {
        const count = dependentEngagements.length + directTransactionCountForGuard;
        throw new ValidationError(
          `Impossible de supprimer « ${existing.name} » : ${count} engagement(s) ou opération(s) y sont encore rattaché(s).`,
        );
      }

      await database.transaction(
        "rw",
        database.budgetSubcategories,
        database.engagements,
        database.transactions,
        database.deletionLog,
        async () => {
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
          await database.engagements.where("subcategoryId").equals(id).delete();
          for (const engagement of dependentEngagements) {
            await logDeletion(database, "engagements", engagement.id);
          }
          // Re-queried now, after the loop above already unlinked anything
          // settling one of this subcategory's engagements — this only
          // catches a transaction that still has subcategoryId set
          // directly with no engagement behind it at all (legacy data
          // from before an engagement was mandatory for every expense).
          const remainingDirectTransactions = await database.transactions
            .where("subcategoryId")
            .equals(id)
            .toArray();
          for (const tx of remainingDirectTransactions) {
            const { subcategoryId: _removed, ...rest } = tx;
            await database.transactions.put({ ...rest, updatedAt: Date.now() });
          }
          await database.budgetSubcategories.delete(id);
          await logDeletion(database, "budgetSubcategories", id);
        },
      );
    },
  };
}

export type BudgetSubcategoriesRepository = ReturnType<typeof createBudgetSubcategoriesRepository>;
