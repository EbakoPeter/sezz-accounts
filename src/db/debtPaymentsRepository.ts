import type { SezzAccountsDatabase } from "./schema";
import { db as defaultDb } from "./schema";
import type { DebtPayment, NewDebtPayment, DebtPaymentUpdate } from "@/types/models";
import { generateId } from "@/lib/id";
import { assertPositiveAmount } from "@/lib/money";
import { ValidationError, NotFoundError } from "@/lib/errors";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function assertValidDate(date: string): void {
  if (!ISO_DATE_RE.test(date) || Number.isNaN(Date.parse(date))) {
    throw new ValidationError("La date doit être au format AAAA-MM-JJ.");
  }
}

export function createDebtPaymentsRepository(database: SezzAccountsDatabase = defaultDb) {
  async function assertDebtExists(debtId: string): Promise<void> {
    const debt = await database.debts.get(debtId);
    if (!debt) throw new NotFoundError("Dette", debtId);
  }
  async function assertAccountExists(accountId: string): Promise<void> {
    const account = await database.accounts.get(accountId);
    if (!account) throw new NotFoundError("Compte", accountId);
  }

  return {
    /** Deliberately does not block an amount that exceeds the debt's
     * remaining balance (overpayment) — that is a soft, situational
     * judgment call (e.g. paying ahead, or including accrued interest),
     * left to the UI to flag and confirm rather than a hard repository rule. */
    async create(input: NewDebtPayment): Promise<DebtPayment> {
      await assertDebtExists(input.debtId);
      await assertAccountExists(input.accountId);
      assertValidDate(input.date);
      assertPositiveAmount(input.amount);

      const now = Date.now();
      const payment: DebtPayment = {
        id: generateId(),
        debtId: input.debtId,
        accountId: input.accountId,
        amount: input.amount,
        date: input.date,
        createdAt: now,
        updatedAt: now,
      };
      await database.debtPayments.add(payment);
      return payment;
    },

    async list(filter: { debtId?: string; accountId?: string } = {}): Promise<DebtPayment[]> {
      let rows: DebtPayment[];
      if (filter.debtId) {
        rows = await database.debtPayments.where("debtId").equals(filter.debtId).toArray();
      } else if (filter.accountId) {
        rows = await database.debtPayments.where("accountId").equals(filter.accountId).toArray();
      } else {
        rows = await database.debtPayments.toArray();
      }
      return rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    },

    async getById(id: string): Promise<DebtPayment | undefined> {
      return database.debtPayments.get(id);
    },

    async update(id: string, patch: DebtPaymentUpdate): Promise<DebtPayment> {
      const existing = await database.debtPayments.get(id);
      if (!existing) throw new NotFoundError("Remboursement", id);

      const next: DebtPayment = { ...existing, updatedAt: Date.now() };
      if (patch.accountId !== undefined) {
        await assertAccountExists(patch.accountId);
        next.accountId = patch.accountId;
      }
      if (patch.date !== undefined) {
        assertValidDate(patch.date);
        next.date = patch.date;
      }
      if (patch.amount !== undefined) {
        assertPositiveAmount(patch.amount);
        next.amount = patch.amount;
      }
      await database.debtPayments.put(next);
      return next;
    },

    async remove(id: string): Promise<void> {
      const existing = await database.debtPayments.get(id);
      if (!existing) throw new NotFoundError("Remboursement", id);
      await database.debtPayments.delete(id);
    },
  };
}

export type DebtPaymentsRepository = ReturnType<typeof createDebtPaymentsRepository>;
