import type { SezzAccountsDatabase, EngagementRow } from "./schema";
import { db as defaultDb } from "./schema";
import type { Engagement, NewEngagement, EngagementUpdate } from "@/types/models";
import { generateId } from "@/lib/id";
import { assertPositiveAmount } from "@/lib/money";
import { ValidationError, NotFoundError } from "@/lib/errors";
import { toStorageRow, fromStorageRow, fromStorageRows } from "./encryptedRecord";
import { logDeletion } from "./deletionLog";

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

export interface EngagementFilter {
  subcategoryId?: string;
  /** Matches an engagement whose `date` falls in this calendar month —
   * the same "which month does this belong to" question budgetSummary
   * already answers for transactions. */
  year?: number;
  month?: number;
}

function monthMatches(isoDate: string, year: number, month: number): boolean {
  const [y, m] = isoDate.split("-");
  return Number(y) === year && Number(m) === month;
}

export function createEngagementsRepository(database: SezzAccountsDatabase = defaultDb) {
  async function decryptEngagement(row: EngagementRow): Promise<Engagement> {
    return fromStorageRow<Engagement>(row);
  }
  async function decryptEngagements(rows: EngagementRow[]): Promise<Engagement[]> {
    return fromStorageRows<Engagement>(rows);
  }

  async function assertSubcategoryExists(subcategoryId: string): Promise<void> {
    const sub = await database.budgetSubcategories.get(subcategoryId);
    if (!sub) throw new NotFoundError("Sous-catégorie budgétaire", subcategoryId);
  }

  return {
    async create(input: NewEngagement): Promise<Engagement> {
      await assertSubcategoryExists(input.subcategoryId);
      assertValidDate(input.date);
      assertPositiveAmount(input.amount);
      const label = assertValidLabel(input.label);

      const now = Date.now();
      const engagement: Engagement = {
        id: generateId(),
        subcategoryId: input.subcategoryId,
        amount: input.amount,
        label,
        date: input.date,
        status: "engaged",
        ...(input.note !== undefined ? { note: input.note } : {}),
        createdAt: now,
        updatedAt: now,
      };
      await database.engagements.add(await toStorageRow(engagement, SENSITIVE_ENGAGEMENT_FIELDS));
      return engagement;
    },

    async list(filter: EngagementFilter = {}): Promise<Engagement[]> {
      const rows = await database.engagements.toArray();
      const engagements = await decryptEngagements(rows);
      const filtered = engagements.filter((e) => {
        if (filter.subcategoryId && e.subcategoryId !== filter.subcategoryId) return false;
        if (filter.year !== undefined && filter.month !== undefined) {
          if (!monthMatches(e.date, filter.year, filter.month)) return false;
        }
        return true;
      });
      return filtered.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    },

    async getById(id: string): Promise<Engagement | undefined> {
      const row = await database.engagements.get(id);
      return row ? decryptEngagement(row) : undefined;
    },

    async update(id: string, patch: EngagementUpdate): Promise<Engagement> {
      const row = await database.engagements.get(id);
      if (!row) throw new NotFoundError("Engagement", id);
      const existing = await decryptEngagement(row);

      const next: Engagement = { ...existing, updatedAt: Date.now() };
      if (patch.subcategoryId !== undefined) {
        await assertSubcategoryExists(patch.subcategoryId);
        next.subcategoryId = patch.subcategoryId;
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
      if (patch.status !== undefined) {
        next.status = patch.status;
      }
      if (patch.note !== undefined) {
        next.note = patch.note;
      }

      await database.engagements.put(await toStorageRow(next, SENSITIVE_ENGAGEMENT_FIELDS));
      return next;
    },

    async remove(id: string): Promise<void> {
      const existing = await database.engagements.get(id);
      if (!existing) throw new NotFoundError("Engagement", id);
      await database.engagements.delete(id);
      await logDeletion(database, "engagements", id);
    },
  };
}

export type EngagementsRepository = ReturnType<typeof createEngagementsRepository>;
