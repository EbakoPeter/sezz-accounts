import type { LivreDeComptesDatabase } from "./schema";
import { db as defaultDb } from "./schema";
import type { Account, NewAccount, AccountUpdate } from "@/types/models";
import { generateId } from "@/lib/id";
import { assertNonNegativeAmount } from "@/lib/money";
import { ValidationError, NotFoundError } from "@/lib/errors";

function assertValidName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new ValidationError("Le nom du compte est obligatoire.");
  }
  return trimmed;
}

/**
 * Factory rather than a singleton class: tests inject an isolated in-memory
 * database instance, while the app uses the shared `db` singleton by default.
 */
export function createAccountsRepository(database: LivreDeComptesDatabase = defaultDb) {
  async function assertNameIsUnique(name: string, excludeId?: string): Promise<void> {
    const existing = await database.accounts.where("name").equalsIgnoreCase(name).first();
    if (existing && existing.id !== excludeId) {
      throw new ValidationError(`Un compte nommé « ${name} » existe déjà.`);
    }
  }

  return {
    async create(input: NewAccount): Promise<Account> {
      const name = assertValidName(input.name);
      assertNonNegativeAmount(input.initialBalance, "Le solde initial");
      await assertNameIsUnique(name);

      const now = Date.now();
      const account: Account = {
        id: generateId(),
        name,
        initialBalance: input.initialBalance,
        createdAt: now,
        updatedAt: now,
      };
      await database.accounts.add(account);
      return account;
    },

    async list(): Promise<Account[]> {
      return database.accounts.orderBy("name").toArray();
    },

    async getById(id: string): Promise<Account | undefined> {
      return database.accounts.get(id);
    },

    async update(id: string, patch: AccountUpdate): Promise<Account> {
      const existing = await database.accounts.get(id);
      if (!existing) throw new NotFoundError("Compte", id);

      const next: Account = { ...existing, updatedAt: Date.now() };
      if (patch.name !== undefined) {
        next.name = assertValidName(patch.name);
        await assertNameIsUnique(next.name, id);
      }
      if (patch.initialBalance !== undefined) {
        assertNonNegativeAmount(patch.initialBalance, "Le solde initial");
        next.initialBalance = patch.initialBalance;
      }

      await database.accounts.put(next);
      return next;
    },

    /**
     * Deletes an account. Refuses if any transaction still references it,
     * to protect referential integrity — this is the exact class of bug the
     * previous (string-keyed) version of this app was exposed to. Pass
     * `{ force: true }` to delete the account and all its transactions
     * together, as an explicit, intentional action.
     */
    async remove(id: string, options: { force?: boolean } = {}): Promise<void> {
      const existing = await database.accounts.get(id);
      if (!existing) throw new NotFoundError("Compte", id);

      const dependentCount = await database.transactions.where("accountId").equals(id).count();
      if (dependentCount > 0 && !options.force) {
        throw new ValidationError(
          `Impossible de supprimer « ${existing.name} » : ${dependentCount} opération(s) y sont encore rattachée(s).`,
        );
      }

      await database.transaction("rw", database.accounts, database.transactions, async () => {
        if (dependentCount > 0) {
          await database.transactions.where("accountId").equals(id).delete();
        }
        await database.accounts.delete(id);
      });
    },

    /** Current balance = opening balance + income − expenses. Always derived,
     * never stored, so it can never drift out of sync with the transactions. */
    async getBalance(id: string): Promise<number> {
      const account = await database.accounts.get(id);
      if (!account) throw new NotFoundError("Compte", id);

      const rows = await database.transactions.where("accountId").equals(id).toArray();
      const net = rows.reduce(
        (sum, tx) => sum + (tx.kind === "income" ? tx.amount : -tx.amount),
        0,
      );
      return account.initialBalance + net;
    },
  };
}

export type AccountsRepository = ReturnType<typeof createAccountsRepository>;
