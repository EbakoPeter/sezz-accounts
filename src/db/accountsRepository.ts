import type { SezzAccountsDatabase, AccountRow } from "./schema";
import { db as defaultDb } from "./schema";
import type { Account, NewAccount, AccountUpdate } from "@/types/models";
import { generateId } from "@/lib/id";
import { assertNonNegativeAmount } from "@/lib/money";
import { ValidationError, NotFoundError } from "@/lib/errors";
import { getAccountFlows, netOf } from "./accountFlows";
import { toStorageRow, fromStorageRow, fromStorageRows } from "./encryptedRecord";
import { logDeletion } from "./deletionLog";

const SENSITIVE_ACCOUNT_FIELDS = ["name", "initialBalance"] as const;

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
  async function decryptAccount(row: AccountRow): Promise<Account> {
    return fromStorageRow<Account>(row);
  }
  async function decryptAccounts(rows: AccountRow[]): Promise<Account[]> {
    return fromStorageRows<Account>(rows);
  }

  // `name` is encrypted (not indexable), so uniqueness is checked by
  // decrypting every account and comparing in memory — perfectly fine at
  // the scale of a personal finance app's account list.
  async function assertNameIsUnique(name: string, excludeId?: string): Promise<void> {
    const all = await decryptAccounts(await database.accounts.toArray());
    const collision = all.find(
      (a) => a.id !== excludeId && a.name.toLowerCase() === name.toLowerCase(),
    );
    if (collision) {
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
      await database.accounts.add(await toStorageRow(account, SENSITIVE_ACCOUNT_FIELDS));
      return account;
    },

    async list(): Promise<Account[]> {
      const accounts = await decryptAccounts(await database.accounts.toArray());
      return accounts.sort((a, b) => a.name.localeCompare(b.name));
    },

    async getById(id: string): Promise<Account | undefined> {
      const row = await database.accounts.get(id);
      return row ? decryptAccount(row) : undefined;
    },

    async update(id: string, patch: AccountUpdate): Promise<Account> {
      const row = await database.accounts.get(id);
      if (!row) throw new NotFoundError("Compte", id);
      const existing = await decryptAccount(row);

      const next: Account = { ...existing, updatedAt: Date.now() };
      if (patch.name !== undefined) {
        next.name = assertValidName(patch.name);
        await assertNameIsUnique(next.name, id);
      }
      if (patch.initialBalance !== undefined) {
        assertNonNegativeAmount(patch.initialBalance, "Le solde initial");
        next.initialBalance = patch.initialBalance;
      }

      await database.accounts.put(await toStorageRow(next, SENSITIVE_ACCOUNT_FIELDS));
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
      const row = await database.accounts.get(id);
      if (!row) throw new NotFoundError("Compte", id);
      const existing = await decryptAccount(row);

      const [dependentTransactionIds, dependentDebts] = await Promise.all([
        database.transactions.where("accountId").equals(id).primaryKeys(),
        database.debts.where("accountId").equals(id).toArray(),
      ]);
      const totalDependents = dependentTransactionIds.length + dependentDebts.length;
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
        database.deletionLog,
        async () => {
          if (dependentTransactionIds.length > 0) {
            await database.transactions.where("accountId").equals(id).delete();
            for (const txId of dependentTransactionIds) {
              await logDeletion(database, "transactions", txId);
            }
          }
          for (const debt of dependentDebts) {
            const paymentIds = await database.debtPayments
              .where("debtId")
              .equals(debt.id)
              .primaryKeys();
            await database.debtPayments.where("debtId").equals(debt.id).delete();
            for (const paymentId of paymentIds) {
              await logDeletion(database, "debtPayments", paymentId);
            }
          }
          if (dependentDebts.length > 0) {
            await database.debts.where("accountId").equals(id).delete();
            for (const debt of dependentDebts) {
              await logDeletion(database, "debts", debt.id);
            }
          }
          await database.accounts.delete(id);
          await logDeletion(database, "accounts", id);
        },
      );
    },

    /** Current balance = opening balance + every inflow − every outflow
     * across transactions, debts, and debt payments (see accountFlows.ts).
     * Always derived, never stored, so it can never drift out of sync. */
    async getBalance(id: string): Promise<number> {
      const row = await database.accounts.get(id);
      if (!row) throw new NotFoundError("Compte", id);
      const account = await decryptAccount(row);

      const flows = await getAccountFlows(database);
      return account.initialBalance + netOf(flows.get(id));
    },
  };
}

export type AccountsRepository = ReturnType<typeof createAccountsRepository>;
