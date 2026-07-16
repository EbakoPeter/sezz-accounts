import { afterEach, describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { RecommendationsPanel } from "./RecommendationsPanel";
import { db } from "@/db/schema";
import { renderAuthenticated } from "@/test/renderAuthenticated";

afterEach(async () => {
  await db.users.clear();
  await db.debtPayments.clear();
  await db.debts.clear();
  await db.transactions.clear();
  await db.accounts.clear();
});

describe("RecommendationsPanel", () => {
  it("shows the all-clear message when there is nothing to flag", async () => {
    await renderAuthenticated(<RecommendationsPanel />);
    expect(await screen.findByText(/aucune alerte/i)).toBeInTheDocument();
  });

  it("renders a warning card for a negative account balance", async () => {
    const now = new Date();
    const isoMonth = String(now.getMonth() + 1).padStart(2, "0");
    await db.accounts.add({
      id: "acc-1",
      name: "Compte Test",
      initialBalance: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as never);
    await db.transactions.add({
      id: "tx-1",
      accountId: "acc-1",
      kind: "expense",
      date: `${now.getFullYear()}-${isoMonth}-05`,
      label: "Grosse dépense",
      amount: 100000,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as never);

    await renderAuthenticated(<RecommendationsPanel />);
    const card = (await screen.findAllByText(/solde négatif/i))[0]!;
    expect(card.closest(".rec-card")).toHaveAttribute("data-severity", "warning");
  });
});
