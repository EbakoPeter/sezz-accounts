import type { SezzAccountsDatabase, TransferRow } from "./schema";
import { db as defaultDb } from "./schema";
import type { Transfer, NewTransfer, TransferUpdate } from "@/types/models";
import { generateId } from "@/lib/id";
import { assertPositiveAmount } from "@/lib/money";
import { ValidationError, NotFoundError } from "@/lib/errors";
import {
  toStorageRow,
  fromStorageRow,
  fromStorageRows,
  fromStorageRowOrUndefined,
} from "./encryptedRecord";
import { logDeletion } from "./deletionLog";

const SENSITIVE_TRANSFER_FIELDS = ["amount", "label", "note"] as const;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function assertValidDate(date: string): void {
  if (!ISO_DATE_RE.test(date) || Number.isNaN(Date.parse(date))) {
    throw new ValidationError("La date doit être au format AAAA-MM-JJ.");
  }
}

function assertDifferentAccounts(fromAccountId: string, toAccountId: string): void {
  if (fromAccountId === toAccountId) {
    throw new ValidationError("Le compte source et le compte destination doivent être différents.");
  }
}

export interface TransferFilter {
  /** Matches a transfer where this account is either the source or the
   * destination — the natural meaning of "transfers involving account X"
   * from that account's own point of view. */
  accountId?: string;
}

export function createTransfersRepository(database: SezzAccountsDatabase = defaultDb) {
  async function decryptTransfer(row: TransferRow): Promise<Transfer> {
    return fromStorageRow<Transfer>(row);
  }
  async function decryptTransfers(rows: TransferRow[]): Promise<Transfer[]> {
    return fromStorageRows<Transfer>(rows);
  }

  async function assertAccountExists(accountId: string): Promise<void> {
    const account = await database.accounts.get(accountId);
    if (!account) throw new NotFoundError("Compte", accountId);
  }

  return {
    async create(input: NewTransfer): Promise<Transfer> {
      assertDifferentAccounts(input.fromAccountId, input.toAccountId);
      await assertAccountExists(input.fromAccountId);
      await assertAccountExists(input.toAccountId);
      assertValidDate(input.date);
      assertPositiveAmount(input.amount);

      const now = Date.now();
      const transfer: Transfer = {
        id: generateId(),
        fromAccountId: input.fromAccountId,
        toAccountId: input.toAccountId,
        amount: input.amount,
        date: input.date,
        ...(input.label !== undefined ? { label: input.label } : {}),
        ...(input.note !== undefined ? { note: input.note } : {}),
        createdAt: now,
        updatedAt: now,
      };
      await database.transfers.add(await toStorageRow(transfer, SENSITIVE_TRANSFER_FIELDS));
      return transfer;
    },

    async list(filter: TransferFilter = {}): Promise<Transfer[]> {
      const rows = await database.transfers.toArray();
      const transfers = await decryptTransfers(rows);
      const filtered = filter.accountId
        ? transfers.filter(
            (t) => t.fromAccountId === filter.accountId || t.toAccountId === filter.accountId,
          )
        : transfers;
      return filtered.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    },

    async getById(id: string): Promise<Transfer | undefined> {
      const row = await database.transfers.get(id);
      return fromStorageRowOrUndefined<Transfer>(row);
    },

    async update(id: string, patch: TransferUpdate): Promise<Transfer> {
      const row = await database.transfers.get(id);
      if (!row) throw new NotFoundError("Transfert", id);
      const existing = await decryptTransfer(row);

      const next: Transfer = { ...existing, updatedAt: Date.now() };
      if (patch.fromAccountId !== undefined) {
        await assertAccountExists(patch.fromAccountId);
        next.fromAccountId = patch.fromAccountId;
      }
      if (patch.toAccountId !== undefined) {
        await assertAccountExists(patch.toAccountId);
        next.toAccountId = patch.toAccountId;
      }
      assertDifferentAccounts(next.fromAccountId, next.toAccountId);
      if (patch.date !== undefined) {
        assertValidDate(patch.date);
        next.date = patch.date;
      }
      if (patch.amount !== undefined) {
        assertPositiveAmount(patch.amount);
        next.amount = patch.amount;
      }
      if (patch.label !== undefined) {
        next.label = patch.label;
      }
      if (patch.note !== undefined) {
        next.note = patch.note;
      }

      await database.transfers.put(await toStorageRow(next, SENSITIVE_TRANSFER_FIELDS));
      return next;
    },

    async remove(id: string): Promise<void> {
      const existing = await database.transfers.get(id);
      if (!existing) throw new NotFoundError("Transfert", id);
      await database.transfers.delete(id);
      await logDeletion(database, "transfers", id, existing.seq ?? 0);
    },
  };
}

export type TransfersRepository = ReturnType<typeof createTransfersRepository>;
