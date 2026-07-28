import { afterEach, describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import { HomePanel } from "./HomePanel";
import { db } from "@/db/schema";
import { clearActiveDek } from "@/lib/encryptionSession";
import { encryptedFixture } from "@/test/encryptedFixture";
import { createTestUser, renderWithSession, renderAuthenticated } from "@/test/renderAuthenticated";
import type { Transaction, BudgetCategory, BudgetSubcategory } from "@/types/models";

afterEach(async () => {
  await db.users.clear();
  await db.roleTemplates.clear();
  await db.accounts.clear();
  await db.transactions.clear();
  await db.budgetCategories.clear();
  await db.budgetSubcategories.clear();
  clearActiveDek();
});

function currentMonthDate(day: string) {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${day}`;
}

describe("HomePanel", () => {
  it("shows the cumulative balance across all accounts", async () => {
    const session = await createTestUser("admin");
    await db.accounts.add(
      await encryptedFixture(
        { id: "acc-1", name: "Compte A", initialBalance: 50000, createdAt: 1, updatedAt: 1 },
        ["name", "initialBalance"] as const,
      ),
    );
    await db.accounts.add(
      await encryptedFixture(
        { id: "acc-2", name: "Compte B", initialBalance: 30000, createdAt: 1, updatedAt: 1 },
        ["name", "initialBalance"] as const,
      ),
    );

    renderWithSession(<HomePanel />, session);

    const situation = (await screen.findByText(/situation financière/i)).closest("section")!;
    await within(situation).findByText(/80 000 FCFA/);
    expect(within(situation).getByText(/2 compte/)).toBeInTheDocument();
  });

  it("shows the income/expense pie chart for the current month", async () => {
    const session = await createTestUser("admin");
    await db.accounts.add(
      await encryptedFixture(
        { id: "acc-1", name: "Compte", initialBalance: 0, createdAt: 1, updatedAt: 1 },
        ["name", "initialBalance"] as const,
      ),
    );
    await db.transactions.add(
      await encryptedFixture<Transaction, "label" | "amount" | "note">(
        {
          id: "tx-1",
          accountId: "acc-1",
          kind: "income",
          date: currentMonthDate("05"),
          label: "Salaire",
          amount: 200000,
          createdAt: 1,
          updatedAt: 1,
        },
        ["label", "amount", "note"],
      ),
    );

    renderWithSession(<HomePanel />, session);

    const pieSection = (await screen.findByText(/entrées et sorties du mois/i)).closest("section")!;
    await within(pieSection).findByRole("img");
    expect(within(pieSection).getByText(/200 000 FCFA/)).toBeInTheDocument();
  });

  it("shows a plain message instead of a chart when there is no activity this month", async () => {
    await renderAuthenticated(<HomePanel />);

    const pieSection = (await screen.findByText(/entrées et sorties du mois/i)).closest("section")!;
    await within(pieSection).findByText(/aucune opération ce mois-ci/i);
    expect(within(pieSection).queryByRole("img")).not.toBeInTheDocument();
  });

  it("shows a bar per provisioned budget line, with its category as a prefix", async () => {
    const session = await createTestUser("admin");
    await db.budgetCategories.add(
      await encryptedFixture<BudgetCategory, "name">(
        { id: "cat-1", name: "Vie Courante", createdAt: 1, updatedAt: 1 },
        ["name"],
      ),
    );
    await db.budgetSubcategories.add(
      await encryptedFixture<BudgetSubcategory, "name" | "monthlyAllocation">(
        {
          id: "sub-1",
          categoryId: "cat-1",
          name: "Alimentation",
          monthlyAllocation: 50000,
          createdAt: 1,
          updatedAt: 1,
        },
        ["name", "monthlyAllocation"],
      ),
    );

    renderWithSession(<HomePanel />, session);

    const budgetSection = (await screen.findByText(/exécution du budget/i)).closest("section")!;
    await within(budgetSection).findByText(/Vie Courante — Alimentation/);
  });

  it("shows the year's operations chart", async () => {
    await renderAuthenticated(<HomePanel />);

    const opsSection = (await screen.findByText(/opérations sur l'année/i)).closest("section")!;
    await within(opsSection).findByRole("img", { name: /revenus et dépenses par mois/i });
  });

  it("shows recommendations, capped at 3", async () => {
    await renderAuthenticated(<HomePanel />);

    await screen.findByText(/^recommandations$/i);
    const recSection = screen.getByText(/^recommandations$/i).closest("section")!;
    await within(recSection).findByText(/aucune alerte/i); // wait for the async insights to settle
    const cards = recSection.querySelectorAll(".rec-card");
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.length).toBeLessThanOrEqual(3);
  });

  it("hides report-derived sections for a user without viewReports, but still shows the balance", async () => {
    const session = await createTestUser("viewer", { viewReports: false });
    renderWithSession(<HomePanel />, session);

    await screen.findByText(/situation financière/i);
    expect(screen.queryByText(/entrées et sorties du mois/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/exécution du budget/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^recommandations$/i)).not.toBeInTheDocument();
  });
});
