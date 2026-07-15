import type { SezzAccountsDatabase } from "./schema";
import { db as defaultDb } from "./schema";
import type { Debt, NewDebt, DebtUpdate } from "@/types/models";
import { generateId } from "@/lib/id";
import { assertPositiveAmount } from "@/lib/money";
import { ValidationError, NotFoundError } from "@/lib/errors";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function assertValidDate(date: string, fieldLabel = "La date"): void {
  if (!ISO_DATE_RE.test(date) || Number.isNaN(Date.parse(date))) {
    throw new ValidationError(`${fieldLabel} doit être au format AAAA-MM-JJ.`);
  }
}

function assertValidCounterparty(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new ValidationError("Le nom du tiers est obligatoire.");
  }
  return trimmed;
}

export function createDebtsRepository(database: SezzAccountsDatabase = defaultDb) {
  async function assertAccountExists(accountId: string): Promise<void> {
    const account = await database.accounts.get(accountId);
    if (!account) throw new NotFoundError("Compte", accountId);
  }

  async function nextReference(): Promise<string> {
    const all = await database.debts.toArray();
    let max = 0;
    for (const debt of all) {
      const match = /^D(\d+)$/.exec(debt.reference);
      if (match) max = Math.max(max, Number(match[1]));
    }
    return `D${String(max + 1).padStart(2, "0")}`;
  }

  return {
    async create(input: NewDebt): Promise<Debt> {
      await assertAccountExists(input.accountId);
      const counterparty = assertValidCounterparty(input.counterparty);
      assertValidDate(input.date);
      assertPositiveAmount(input.amount);
      if (input.dueDate !== undefined) {
        assertValidDate(input.dueDate, "L'échéance");
        if (input.dueDate < input.date) {
          throw new ValidationError(
            "L'échéance ne peut pas être antérieure à la date de la dette.",
          );
        }
      }

      const now = Date.now();
      const debt: Debt = {
        id: generateId(),
        reference: await nextReference(),
        kind: input.kind,
        counterparty,
        accountId: input.accountId,
        amount: input.amount,
        date: input.date,
        ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        createdAt: now,
        updatedAt: now,
      };
      await database.debts.add(debt);
      return debt;
    },

    async list(filter: { accountId?: string; kind?: Debt["kind"] } = {}): Promise<Debt[]> {
      let rows = filter.accountId
        ? await database.debts.where("accountId").equals(filter.accountId).toArray()
        : await database.debts.toArray();
      if (filter.kind) rows = rows.filter((d) => d.kind === filter.kind);
      return rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    },

    async getById(id: string): Promise<Debt | undefined> {
      return database.debts.get(id);
    },

    async update(id: string, patch: DebtUpdate): Promise<Debt> {
      const existing = await database.debts.get(id);
      if (!existing) throw new NotFoundError("Dette", id);

      const next: Debt = { ...existing, updatedAt: Date.now() };
      if (patch.accountId !== undefined) {
        await assertAccountExists(patch.accountId);
        next.accountId = patch.accountId;
      }
      if (patch.counterparty !== undefined) {
        next.counterparty = assertValidCounterparty(patch.counterparty);
      }
      if (patch.date !== undefined) {
        assertValidDate(patch.date);
        next.date = patch.date;
      }
      if (patch.amount !== undefined) {
        assertPositiveAmount(patch.amount);
        next.amount = patch.amount;
      }
      if (patch.dueDate !== undefined) {
        assertValidDate(patch.dueDate, "L'échéance");
        next.dueDate = patch.dueDate;
      }
      if (patch.description !== undefined) {
        next.description = patch.description;
      }
      if (next.dueDate !== undefined && next.dueDate < next.date) {
        throw new ValidationError("L'échéance ne peut pas être antérieure à la date de la dette.");
      }

      await database.debts.put(next);
      return next;
    },

    /** Deletes a debt. Refuses if payments still exist against it, unless
     * `force` is passed — in which case those payments are deleted too. A
     * payment can never meaningfully exist without the debt it repays, so
     * (unlike budget subcategories) this cascades by deletion, not unlinking. */
    async remove(id: string, options: { force?: boolean } = {}): Promise<void> {
      const existing = await database.debts.get(id);
      if (!existing) throw new NotFoundError("Dette", id);

      const paymentCount = await database.debtPayments.where("debtId").equals(id).count();
      if (paymentCount > 0 && !options.force) {
        throw new ValidationError(
          `Impossible de supprimer la dette ${existing.reference} : ${paymentCount} remboursement(s) y sont encore rattaché(s).`,
        );
      }

      await database.transaction("rw", database.debts, database.debtPayments, async () => {
        if (paymentCount > 0) {
          await database.debtPayments.where("debtId").equals(id).delete();
        }
        await database.debts.delete(id);
      });
    },
  };
}

export type DebtsRepository = ReturnType<typeof createDebtsRepository>;
