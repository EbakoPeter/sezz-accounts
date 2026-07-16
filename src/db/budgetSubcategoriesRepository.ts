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

    /** Deletes a subcategory. Refuses if transactions still reference it,
     * unless `force` is passed — in which case those transactions are kept
     * but unlinked (`subcategoryId` cleared), never deleted. */
    async remove(id: string, options: { force?: boolean } = {}): Promise<void> {
      const row = await database.budgetSubcategories.get(id);
      if (!row) throw new NotFoundError("Sous-catégorie", id);
      const existing = await decryptSubcategory(row);

      const dependentTransactions = await database.transactions
        .where("subcategoryId")
        .equals(id)
        .toArray();
      if (dependentTransactions.length > 0 && !options.force) {
        throw new ValidationError(
          `Impossible de supprimer « ${existing.name} » : ${dependentTransactions.length} opération(s) y sont encore rattachée(s).`,
        );
      }

      await database.transaction(
        "rw",
        database.budgetSubcategories,
        database.transactions,
        async () => {
          for (const tx of dependentTransactions) {
            const { subcategoryId: _removed, ...rest } = tx;
            await database.transactions.put({ ...rest, updatedAt: Date.now() });
          }
          await database.budgetSubcategories.delete(id);
        },
      );
    },
  };
}

export type BudgetSubcategoriesRepository = ReturnType<typeof createBudgetSubcategoriesRepository>;
