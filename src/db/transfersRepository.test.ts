import { describe, it, expect, beforeEach } from "vitest";
import { useTestEncryptionSession } from "@/test/testDek";
import { createTestDatabase } from "@/test/testDatabase";
import type { SezzAccountsDatabase } from "@/db/schema";
import { createAccountsRepository, type AccountsRepository } from "./accountsRepository";
import { createTransfersRepository, type TransfersRepository } from "./transfersRepository";
import { ValidationError, NotFoundError } from "@/lib/errors";

describe("TransfersRepository", () => {
  useTestEncryptionSession();
  let database: SezzAccountsDatabase;
  let accounts: AccountsRepository;
  let transfers: TransfersRepository;
  let fromAccountId: string;
  let toAccountId: string;

  beforeEach(async () => {
    database = createTestDatabase();
    accounts = createAccountsRepository(database);
    transfers = createTransfersRepository(database);
    fromAccountId = (await accounts.create({ name: "Compte Source", initialBalance: 100000 })).id;
    toAccountId = (await accounts.create({ name: "Compte Destination", initialBalance: 0 })).id;
  });

  describe("create", () => {
    it("creates a transfer between two existing accounts", async () => {
      const transfer = await transfers.create({
        fromAccountId,
        toAccountId,
        amount: 5000,
        date: "2026-01-01",
      });
      expect(transfer.fromAccountId).toBe(fromAccountId);
      expect(transfer.toAccountId).toBe(toAccountId);
      expect(transfer.amount).toBe(5000);
    });

    it("accepts an optional label and note", async () => {
      const transfer = await transfers.create({
        fromAccountId,
        toAccountId,
        amount: 5000,
        date: "2026-01-01",
        label: "Épargne du mois",
        note: "Virement automatique",
      });
      expect(transfer.label).toBe("Épargne du mois");
      expect(transfer.note).toBe("Virement automatique");
    });

    it("rejects a transfer to the same account", async () => {
      await expect(
        transfers.create({
          fromAccountId,
          toAccountId: fromAccountId,
          amount: 1000,
          date: "2026-01-01",
        }),
      ).rejects.toThrow(ValidationError);
    });

    it("rejects a non-existent source account", async () => {
      await expect(
        transfers.create({
          fromAccountId: "ghost",
          toAccountId,
          amount: 1000,
          date: "2026-01-01",
        }),
      ).rejects.toThrow(NotFoundError);
    });

    it("rejects a non-existent destination account", async () => {
      await expect(
        transfers.create({
          fromAccountId,
          toAccountId: "ghost",
          amount: 1000,
          date: "2026-01-01",
        }),
      ).rejects.toThrow(NotFoundError);
    });

    it("rejects a non-positive amount", async () => {
      await expect(
        transfers.create({ fromAccountId, toAccountId, amount: 0, date: "2026-01-01" }),
      ).rejects.toThrow(ValidationError);
      await expect(
        transfers.create({ fromAccountId, toAccountId, amount: -100, date: "2026-01-01" }),
      ).rejects.toThrow(ValidationError);
    });

    it("rejects an invalid date", async () => {
      await expect(
        transfers.create({ fromAccountId, toAccountId, amount: 1000, date: "not-a-date" }),
      ).rejects.toThrow(ValidationError);
    });
  });

  describe("list", () => {
    it("returns transfers sorted by date, most recent first", async () => {
      await transfers.create({ fromAccountId, toAccountId, amount: 1000, date: "2026-01-01" });
      await transfers.create({ fromAccountId, toAccountId, amount: 2000, date: "2026-03-01" });
      await transfers.create({ fromAccountId, toAccountId, amount: 3000, date: "2026-02-01" });

      const all = await transfers.list();
      expect(all.map((t) => t.amount)).toEqual([2000, 3000, 1000]);
    });

    it("filters by accountId, matching either side of the transfer", async () => {
      const otherAccountId = (await accounts.create({ name: "Autre", initialBalance: 0 })).id;
      await transfers.create({ fromAccountId, toAccountId, amount: 1000, date: "2026-01-01" });
      await transfers.create({
        fromAccountId: toAccountId,
        toAccountId: otherAccountId,
        amount: 2000,
        date: "2026-01-02",
      });

      const forFromAccount = await transfers.list({ accountId: fromAccountId });
      expect(forFromAccount).toHaveLength(1);

      const forToAccount = await transfers.list({ accountId: toAccountId });
      expect(forToAccount).toHaveLength(2); // it's the destination of one, source of the other

      const forOtherAccount = await transfers.list({ accountId: otherAccountId });
      expect(forOtherAccount).toHaveLength(1);
    });
  });

  describe("getById", () => {
    it("returns the transfer", async () => {
      const created = await transfers.create({
        fromAccountId,
        toAccountId,
        amount: 1000,
        date: "2026-01-01",
      });
      const found = await transfers.getById(created.id);
      expect(found).toEqual(created);
    });

    it("returns undefined for an unknown id", async () => {
      expect(await transfers.getById("ghost")).toBeUndefined();
    });
  });

  describe("update", () => {
    it("updates the amount, date, label, and note", async () => {
      const created = await transfers.create({
        fromAccountId,
        toAccountId,
        amount: 1000,
        date: "2026-01-01",
      });
      const updated = await transfers.update(created.id, {
        amount: 2000,
        date: "2026-02-01",
        label: "Renommé",
        note: "Ajouté après coup",
      });
      expect(updated.amount).toBe(2000);
      expect(updated.date).toBe("2026-02-01");
      expect(updated.label).toBe("Renommé");
      expect(updated.note).toBe("Ajouté après coup");
    });

    it("moves the transfer to different accounts", async () => {
      const otherAccountId = (await accounts.create({ name: "Autre", initialBalance: 0 })).id;
      const created = await transfers.create({
        fromAccountId,
        toAccountId,
        amount: 1000,
        date: "2026-01-01",
      });
      const updated = await transfers.update(created.id, { toAccountId: otherAccountId });
      expect(updated.toAccountId).toBe(otherAccountId);
    });

    it("rejects an update that would make source and destination the same account", async () => {
      const created = await transfers.create({
        fromAccountId,
        toAccountId,
        amount: 1000,
        date: "2026-01-01",
      });
      await expect(transfers.update(created.id, { toAccountId: fromAccountId })).rejects.toThrow(
        ValidationError,
      );
    });

    it("rejects moving to a non-existent account", async () => {
      const created = await transfers.create({
        fromAccountId,
        toAccountId,
        amount: 1000,
        date: "2026-01-01",
      });
      await expect(transfers.update(created.id, { fromAccountId: "ghost" })).rejects.toThrow(
        NotFoundError,
      );
    });

    it("throws NotFoundError for an unknown id", async () => {
      await expect(transfers.update("ghost", { amount: 100 })).rejects.toThrow(NotFoundError);
    });
  });

  describe("remove", () => {
    it("deletes the transfer", async () => {
      const created = await transfers.create({
        fromAccountId,
        toAccountId,
        amount: 1000,
        date: "2026-01-01",
      });
      await transfers.remove(created.id);
      expect(await transfers.getById(created.id)).toBeUndefined();
    });

    it("throws NotFoundError for an unknown id", async () => {
      await expect(transfers.remove("ghost")).rejects.toThrow(NotFoundError);
    });

    it("logs the deletion for sync", async () => {
      const created = await transfers.create({
        fromAccountId,
        toAccountId,
        amount: 1000,
        date: "2026-01-01",
      });
      await transfers.remove(created.id);

      const entries = await database.deletionLog.toArray();
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ tableName: "transfers", recordId: created.id });
    });
  });
});
