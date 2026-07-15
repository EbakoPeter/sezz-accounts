import type { SezzAccountsDatabase } from "./schema";
import { db as defaultDb } from "./schema";
import type { Transaction, NewTransaction, TransactionUpdate } from "@/types/models";
import { generateId } from "@/lib/id";
import { assertPositiveAmount } from "@/lib/money";
import { ValidationError, NotFoundError } from "@/lib/errors";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function assertValidDate(date: string): void {
  if (!ISO_DATE_RE.test(date) || Number.isNaN(Date.parse(date))) {
    throw new ValidationError("La date doit être au format AAAA-MM-JJ.");
  }
}

function assertValidLabel(label: string): string {
  const trimmed = label.trim();
  if (trimmed.length === 0) {
    throw new ValidationError("Le libellé est obligatoire.");
  }
  return trimmed;
}

export interface TransactionFilter {
  accountId?: string;
  kind?: Transaction["kind"];
  /** Inclusive range, "YYYY-MM-DD". */
  from?: string;
  to?: string;
}

export function createTransactionsRepository(database: SezzAccountsDatabase = defaultDb) {
  async function assertAccountExists(accountId: string): Promise<void> {
    const account = await database.accounts.get(accountId);
    if (!account) throw new NotFoundError("Compte", accountId);
  }

  return {
    async create(input: NewTransaction): Promise<Transaction> {
      await assertAccountExists(input.accountId);
      assertValidDate(input.date);
      assertPositiveAmount(input.amount);
      const label = assertValidLabel(input.label);

      const now = Date.now();
      const transaction: Transaction = {
        id: generateId(),
        accountId: input.accountId,
        kind: input.kind,
        date: input.date,
        label,
        amount: input.amount,
        ...(input.subcategoryId !== undefined ? { subcategoryId: input.subcategoryId } : {}),
        ...(input.note !== undefined ? { note: input.note } : {}),
        createdAt: now,
        updatedAt: now,
      };
      await database.transactions.add(transaction);
      return transaction;
    },

    async list(filter: TransactionFilter = {}): Promise<Transaction[]> {
      let rows = filter.accountId
        ? await database.transactions.where("accountId").equals(filter.accountId).toArray()
        : await database.transactions.toArray();

      if (filter.kind) rows = rows.filter((tx) => tx.kind === filter.kind);
      if (filter.from) rows = rows.filter((tx) => tx.date >= filter.from!);
      if (filter.to) rows = rows.filter((tx) => tx.date <= filter.to!);

      return rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    },

    async getById(id: string): Promise<Transaction | undefined> {
      return database.transactions.get(id);
    },

    async update(id: string, patch: TransactionUpdate): Promise<Transaction> {
      const existing = await database.transactions.get(id);
      if (!existing) throw new NotFoundError("Opération", id);

      const next: Transaction = { ...existing, updatedAt: Date.now() };
      if (patch.date !== undefined) {
        assertValidDate(patch.date);
        next.date = patch.date;
      }
      if (patch.amount !== undefined) {
        assertPositiveAmount(patch.amount);
        next.amount = patch.amount;
      }
      if (patch.label !== undefined) {
        next.label = assertValidLabel(patch.label);
      }
      if (patch.subcategoryId !== undefined) {
        next.subcategoryId = patch.subcategoryId;
      }
      if (patch.note !== undefined) {
        next.note = patch.note;
      }

      await database.transactions.put(next);
      return next;
    },

    async remove(id: string): Promise<void> {
      const existing = await database.transactions.get(id);
      if (!existing) throw new NotFoundError("Opération", id);
      await database.transactions.delete(id);
    },

    /** Sum of income minus sum of expenses for the given filter — the
     * building block for account balances, monthly reports, etc. */
    async netTotal(filter: TransactionFilter = {}): Promise<number> {
      const rows = await this.list(filter);
      return rows.reduce((sum, tx) => sum + (tx.kind === "income" ? tx.amount : -tx.amount), 0);
    },
  };
}

export type TransactionsRepository = ReturnType<typeof createTransactionsRepository>;
