import { afterEach, describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { RecommendationsPanel } from "./RecommendationsPanel";
import { db } from "@/db/schema";
import { clearActiveDek } from "@/lib/encryptionSession";
import { encryptedFixture } from "@/test/encryptedFixture";
import { createTestUser, renderWithSession, renderAuthenticated } from "@/test/renderAuthenticated";
import type { Transaction } from "@/types/models";

afterEach(async () => {
  await db.users.clear();
  await db.debtPayments.clear();
  await db.debts.clear();
  await db.transactions.clear();
  await db.accounts.clear();
  clearActiveDek();
});

describe("RecommendationsPanel", () => {
  it("shows the all-clear message when there is nothing to flag", async () => {
    await renderAuthenticated(<RecommendationsPanel />);
    expect(await screen.findByText(/aucune alerte/i)).toBeInTheDocument();
  });

  it("renders a warning card for a negative account balance", async () => {
    const session = await createTestUser("admin");
    const now = new Date();
    const isoMonth = String(now.getMonth() + 1).padStart(2, "0");
    await db.accounts.add(
      await encryptedFixture(
        {
          id: "acc-1",
          name: "Compte Test",
          initialBalance: 0,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        ["name", "initialBalance"] as const,
      ),
    );
    await db.transactions.add(
      await encryptedFixture<Transaction, "label" | "amount" | "note">(
        {
          id: "tx-1",
          accountId: "acc-1",
          kind: "expense",
          date: `${now.getFullYear()}-${isoMonth}-05`,
          label: "Grosse dépense",
          amount: 100000,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        ["label", "amount", "note"],
      ),
    );

    renderWithSession(<RecommendationsPanel />, session);
    const card = (await screen.findAllByText(/solde négatif/i))[0]!;
    expect(card.closest(".rec-card")).toHaveAttribute("data-severity", "warning");
  });
});
