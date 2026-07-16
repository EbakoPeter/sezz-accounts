import type { SezzAccountsDatabase, DebtPaymentRow } from "./schema";
import { db as defaultDb } from "./schema";
import type { DebtPayment, NewDebtPayment, DebtPaymentUpdate } from "@/types/models";
import { generateId } from "@/lib/id";
import { assertPositiveAmount } from "@/lib/money";
import { ValidationError, NotFoundError } from "@/lib/errors";
import { toStorageRow, fromStorageRow, fromStorageRows } from "./encryptedRecord";

const SENSITIVE_PAYMENT_FIELDS = ["amount"] as const;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function assertValidDate(date: string): void {
  if (!ISO_DATE_RE.test(date) || Number.isNaN(Date.parse(date))) {
    throw new ValidationError("La date doit être au format AAAA-MM-JJ.");
  }
}

export function createDebtPaymentsRepository(database: SezzAccountsDatabase = defaultDb) {
  async function decryptPayment(row: DebtPaymentRow): Promise<DebtPayment> {
    return fromStorageRow<DebtPayment>(row);
  }
  async function decryptPayments(rows: DebtPaymentRow[]): Promise<DebtPayment[]> {
    return fromStorageRows<DebtPayment>(rows);
  }

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
      await database.debtPayments.add(await toStorageRow(payment, SENSITIVE_PAYMENT_FIELDS));
      return payment;
    },

    async list(filter: { debtId?: string; accountId?: string } = {}): Promise<DebtPayment[]> {
      let rows: DebtPaymentRow[];
      if (filter.debtId) {
        rows = await database.debtPayments.where("debtId").equals(filter.debtId).toArray();
      } else if (filter.accountId) {
        rows = await database.debtPayments.where("accountId").equals(filter.accountId).toArray();
      } else {
        rows = await database.debtPayments.toArray();
      }
      const payments = await decryptPayments(rows);
      return payments.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    },

    async getById(id: string): Promise<DebtPayment | undefined> {
      const row = await database.debtPayments.get(id);
      return row ? decryptPayment(row) : undefined;
    },

    async update(id: string, patch: DebtPaymentUpdate): Promise<DebtPayment> {
      const row = await database.debtPayments.get(id);
      if (!row) throw new NotFoundError("Remboursement", id);
      const existing = await decryptPayment(row);

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
      await database.debtPayments.put(await toStorageRow(next, SENSITIVE_PAYMENT_FIELDS));
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
