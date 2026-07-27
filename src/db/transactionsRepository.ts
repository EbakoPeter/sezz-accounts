import type { SezzAccountsDatabase, TransactionRow } from "./schema";
import { db as defaultDb } from "./schema";
import type { Transaction, NewTransaction, TransactionUpdate, Engagement } from "@/types/models";
import { generateId } from "@/lib/id";
import { assertPositiveAmount, formatFcfa } from "@/lib/money";
import { ValidationError, NotFoundError } from "@/lib/errors";
import { toStorageRow, fromStorageRow, fromStorageRows } from "./encryptedRecord";
import { logDeletion } from "./deletionLog";

const SENSITIVE_TRANSACTION_FIELDS = ["label", "amount", "note"] as const;
const SENSITIVE_ENGAGEMENT_FIELDS = ["amount", "label", "note"] as const;

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
  async function decryptTransaction(row: TransactionRow): Promise<Transaction> {
    return fromStorageRow<Transaction>(row);
  }
  async function decryptTransactions(rows: TransactionRow[]): Promise<Transaction[]> {
    return fromStorageRows<Transaction>(rows);
  }

  async function assertAccountExists(accountId: string): Promise<void> {
    const account = await database.accounts.get(accountId);
    if (!account) throw new NotFoundError("Compte", accountId);
  }

  /** id of the transaction (if any) that currently settles this
   * engagement — an engagement is settled by at most one transaction at a
   * time, so the first match is the only one that matters. */
  async function findSettlingTransactionId(engagementId: string): Promise<string | undefined> {
    const rows = await database.transactions.where("engagementId").equals(engagementId).toArray();
    return rows[0]?.id;
  }

  async function getEngagementOrThrow(engagementId: string): Promise<Engagement> {
    const row = await database.engagements.get(engagementId);
    if (!row) throw new NotFoundError("Engagement", engagementId);
    return fromStorageRow<Engagement>(row);
  }

  async function setEngagementStatus(
    engagement: Engagement,
    status: Engagement["status"],
  ): Promise<void> {
    const next: Engagement = { ...engagement, status, updatedAt: Date.now() };
    await database.engagements.put(await toStorageRow(next, SENSITIVE_ENGAGEMENT_FIELDS));
  }

  /**
   * Every expense settles a specific Engagement — money can only be spent
   * against a line that was already, deliberately, reserved for it (see
   * Transaction.engagementId's own comment in src/types/models.ts for the
   * full reasoning). This is the one place that enforces it:
   *  - the engagement must exist;
   *  - it can't be cancelled — a cancelled engagement is money that was
   *    reserved and then explicitly un-reserved, not available to spend;
   *  - it can't already be settled by a *different* transaction — one
   *    engagement, one expense; excludeTransactionId lets an edit to the
   *    same transaction re-validate against its own engagement without
   *    tripping over itself;
   *  - the amount can't exceed what was engaged, though it can be less
   *    (e.g. the actual bill came in lower than planned) — never more,
   *    since that would mean spending money that was never reserved.
   * Returns the engagement so the caller doesn't have to re-fetch it.
   */
  async function assertSettlesEngagement(
    engagementId: string,
    amount: number,
    excludeTransactionId?: string,
  ): Promise<Engagement> {
    const engagement = await getEngagementOrThrow(engagementId);

    if (engagement.status === "cancelled") {
      throw new ValidationError(
        `Impossible d'enregistrer cette dépense : l'engagement « ${engagement.label} » a été annulé.`,
      );
    }
    if (engagement.status === "realized") {
      const settlingId = await findSettlingTransactionId(engagementId);
      if (settlingId !== excludeTransactionId) {
        throw new ValidationError(
          `Impossible d'enregistrer cette dépense : l'engagement « ${engagement.label} » ` +
            `est déjà réalisé par une autre opération.`,
        );
      }
    }
    if (amount > engagement.amount) {
      throw new ValidationError(
        `Le montant dépasse ce qui a été engagé pour « ${engagement.label} » : ` +
          `${formatFcfa(engagement.amount)} au maximum.`,
      );
    }
    return engagement;
  }

  return {
    async create(input: NewTransaction): Promise<Transaction> {
      await assertAccountExists(input.accountId);
      assertValidDate(input.date);
      assertPositiveAmount(input.amount);
      const label = assertValidLabel(input.label);

      let subcategoryId: string | undefined;
      if (input.kind === "expense") {
        if (!input.engagementId) {
          throw new ValidationError(
            "Une dépense doit être rattachée à un engagement existant. Créez d'abord un " +
              "engagement dans le budget prévisionnel.",
          );
        }
        const engagement = await assertSettlesEngagement(input.engagementId, input.amount);
        subcategoryId = engagement.subcategoryId;
      }

      const now = Date.now();
      const transaction: Transaction = {
        id: generateId(),
        accountId: input.accountId,
        kind: input.kind,
        date: input.date,
        label,
        amount: input.amount,
        ...(subcategoryId !== undefined ? { subcategoryId } : {}),
        ...(input.kind === "expense" ? { engagementId: input.engagementId! } : {}),
        ...(input.note !== undefined ? { note: input.note } : {}),
        createdAt: now,
        updatedAt: now,
      };
      await database.transactions.add(
        await toStorageRow(transaction, SENSITIVE_TRANSACTION_FIELDS),
      );

      if (input.kind === "expense") {
        // Recording the expense is what settles it — automatic, not a
        // separate manual step (see Transaction.engagementId's comment).
        const engagement = await getEngagementOrThrow(input.engagementId!);
        await setEngagementStatus(engagement, "realized");
      }

      return transaction;
    },

    async list(filter: TransactionFilter = {}): Promise<Transaction[]> {
      let rows = filter.accountId
        ? await database.transactions.where("accountId").equals(filter.accountId).toArray()
        : await database.transactions.toArray();

      if (filter.kind) rows = rows.filter((tx) => tx.kind === filter.kind);
      if (filter.from) rows = rows.filter((tx) => tx.date >= filter.from!);
      if (filter.to) rows = rows.filter((tx) => tx.date <= filter.to!);

      const transactions = await decryptTransactions(rows);
      return transactions.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    },

    async getById(id: string): Promise<Transaction | undefined> {
      const row = await database.transactions.get(id);
      return row ? decryptTransaction(row) : undefined;
    },

    async update(id: string, patch: TransactionUpdate): Promise<Transaction> {
      const row = await database.transactions.get(id);
      if (!row) throw new NotFoundError("Opération", id);
      const existing = await decryptTransaction(row);

      const next: Transaction = { ...existing, updatedAt: Date.now() };
      if (patch.accountId !== undefined) {
        await assertAccountExists(patch.accountId);
        next.accountId = patch.accountId;
      }
      if (patch.kind !== undefined) {
        next.kind = patch.kind;
      }
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
      if (patch.note !== undefined) {
        next.note = patch.note;
      }

      // Engagement transitions — figure out what changed before touching
      // anything, then apply every consequence together:
      //  - becoming (or staying) income: no engagement, ever;
      //  - staying on the same engagement: just re-validate the amount
      //    against it (excluding this transaction as its own settler);
      //  - moving to a different engagement (including "becoming an
      //    expense" from income, which has no prior engagement to move
      //    off of): release the old one back to "engagé", settle the new
      //    one.
      const oldEngagementId = existing.kind === "expense" ? existing.engagementId : undefined;
      const requestedEngagementId =
        patch.engagementId === null ? undefined : (patch.engagementId ?? oldEngagementId);

      if (next.kind === "income") {
        delete next.subcategoryId;
        delete next.engagementId;
      } else {
        if (!requestedEngagementId) {
          throw new ValidationError(
            "Une dépense doit être rattachée à un engagement existant. Créez d'abord un " +
              "engagement dans le budget prévisionnel.",
          );
        }
        const engagement = await assertSettlesEngagement(
          requestedEngagementId,
          next.amount,
          id, // this transaction is allowed to already be the settler
        );
        next.subcategoryId = engagement.subcategoryId;
        next.engagementId = requestedEngagementId;
      }

      await database.transactions.put(await toStorageRow(next, SENSITIVE_TRANSACTION_FIELDS));

      if (oldEngagementId && oldEngagementId !== next.engagementId) {
        // no longer settled by this transaction — release it
        const oldEngagement = await getEngagementOrThrow(oldEngagementId);
        await setEngagementStatus(oldEngagement, "engaged");
      }
      if (next.kind === "expense" && next.engagementId !== oldEngagementId) {
        const newEngagement = await getEngagementOrThrow(next.engagementId!);
        await setEngagementStatus(newEngagement, "realized");
      }

      return next;
    },

    async remove(id: string): Promise<void> {
      const existing = await database.transactions.get(id);
      if (!existing) throw new NotFoundError("Opération", id);
      const decrypted = await decryptTransaction(existing);
      await database.transactions.delete(id);
      await logDeletion(database, "transactions", id);

      if (decrypted.kind === "expense" && decrypted.engagementId) {
        // deleting the expense that settled this engagement un-settles
        // it — back to "engagé" rather than left stranded on "réalisé"
        // with nothing that actually paid it
        const engagement = await getEngagementOrThrow(decrypted.engagementId);
        await setEngagementStatus(engagement, "engaged");
      }
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
