import type { SezzAccountsDatabase } from "./schema";
import { db as defaultDb } from "./schema";
import type { Account, NewAccount, AccountUpdate } from "@/types/models";
import { generateId } from "@/lib/id";
import { assertNonNegativeAmount } from "@/lib/money";
import { ValidationError, NotFoundError } from "@/lib/errors";
import { getAccountFlows, netOf } from "./accountFlows";

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
export function createAccountsRepository(database: SezzAccountsDatabase = defaultDb) {
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
     * Deletes an account. Refuses if any transaction or debt still
     * references it, to protect referential integrity — this is the exact
     * class of bug the previous (string-keyed) version of this app was
     * exposed to. Pass `{ force: true }` to delete the account and
     * everything attached to it (transactions, debts, and those debts'
     * payments) together, as an explicit, intentional action.
     */
    async remove(id: string, options: { force?: boolean } = {}): Promise<void> {
      const existing = await database.accounts.get(id);
      if (!existing) throw new NotFoundError("Compte", id);

      const [dependentTransactionsCount, dependentDebts] = await Promise.all([
        database.transactions.where("accountId").equals(id).count(),
        database.debts.where("accountId").equals(id).toArray(),
      ]);
      const totalDependents = dependentTransactionsCount + dependentDebts.length;
      if (totalDependents > 0 && !options.force) {
        throw new ValidationError(
          `Impossible de supprimer « ${existing.name} » : ${totalDependents} élément(s) (opérations et/ou dettes) y sont encore rattaché(s).`,
        );
      }

      await database.transaction(
        "rw",
        database.accounts,
        database.transactions,
        database.debts,
        database.debtPayments,
        async () => {
          if (dependentTransactionsCount > 0) {
            await database.transactions.where("accountId").equals(id).delete();
          }
          for (const debt of dependentDebts) {
            await database.debtPayments.where("debtId").equals(debt.id).delete();
          }
          if (dependentDebts.length > 0) {
            await database.debts.where("accountId").equals(id).delete();
          }
          await database.accounts.delete(id);
        },
      );
    },

    /** Current balance = opening balance + every inflow − every outflow
     * across transactions, debts, and debt payments (see accountFlows.ts).
     * Always derived, never stored, so it can never drift out of sync. */
    async getBalance(id: string): Promise<number> {
      const account = await database.accounts.get(id);
      if (!account) throw new NotFoundError("Compte", id);

      const flows = await getAccountFlows(database);
      return account.initialBalance + netOf(flows.get(id));
    },
  };
}

export type AccountsRepository = ReturnType<typeof createAccountsRepository>;
