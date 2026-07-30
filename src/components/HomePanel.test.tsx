import { afterEach, describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HomePanel } from "./HomePanel";
import { db } from "@/db/schema";
import { clearActiveDek, getActiveDek } from "@/lib/encryptionSession";
import { encryptedFixture } from "@/test/encryptedFixture";
import { createTestUser, renderWithSession, renderAuthenticated } from "@/test/renderAuthenticated";
import { usersRepository } from "@/repositories";
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
  it("hides the financial situation by default", async () => {
    await renderAuthenticated(<HomePanel />);

    const situation = (await screen.findByText(/situation financière/i)).closest("section")!;
    expect(within(situation).getByText(/masquée par défaut/i)).toBeInTheDocument();
    expect(within(situation).queryByRole("img")).not.toBeInTheDocument();
    expect(within(situation).getByRole("button", { name: /^afficher$/i })).toBeInTheDocument();
  });

  it("rejects a wrong password and keeps the content hidden", async () => {
    const session = await createTestUser("admin");
    const user = userEvent.setup();
    renderWithSession(<HomePanel />, session);

    const situation = (await screen.findByText(/situation financière/i)).closest("section")!;
    await user.click(within(situation).getByRole("button", { name: /^afficher$/i }));
    await user.type(within(situation).getByLabelText(/votre mot de passe/i), "wrong");
    await user.click(within(situation).getByRole("button", { name: /^confirmer$/i }));

    expect(await within(situation).findByRole("alert")).toHaveTextContent(/incorrect/i);
    expect(within(situation).queryByRole("img")).not.toBeInTheDocument();
  });

  it("reveals the situation once the current user's own password is entered, and can be hidden again", async () => {
    const session = await createTestUser("admin");
    await db.accounts.add(
      await encryptedFixture(
        { id: "acc-1", name: "Compte A", initialBalance: 50000, createdAt: 1, updatedAt: 1 },
        ["name", "initialBalance"] as const,
      ),
    );
    const user = userEvent.setup();
    renderWithSession(<HomePanel />, session);

    const situation = (await screen.findByText(/situation financière/i)).closest("section")!;
    await user.click(within(situation).getByRole("button", { name: /^afficher$/i }));
    await user.type(within(situation).getByLabelText(/votre mot de passe/i), "test-password-123");
    await user.click(within(situation).getByRole("button", { name: /^confirmer$/i }));

    await within(situation).findByRole("img");
    expect(within(situation).getByText(/solde cumulé/i)).toHaveTextContent("50 000 FCFA");

    await user.click(within(situation).getByRole("button", { name: /masquer à nouveau/i }));

    expect(within(situation).queryByRole("img")).not.toBeInTheDocument();
    expect(within(situation).getByRole("button", { name: /^afficher$/i })).toBeInTheDocument();
  });

  it("temporarily blocks further attempts after 5 wrong passwords in a row", async () => {
    const session = await createTestUser("admin");
    const user = userEvent.setup();
    renderWithSession(<HomePanel />, session);

    const situation = (await screen.findByText(/situation financière/i)).closest("section")!;
    await user.click(within(situation).getByRole("button", { name: /^afficher$/i }));
    const input = await screen.findByLabelText(/votre mot de passe/i);
    const confirmButton = screen.getByRole("button", { name: /^confirmer$/i });

    for (let i = 0; i < 4; i++) {
      await user.clear(input);
      await user.type(input, "wrong");
      await user.click(confirmButton);
      await within(situation).findByRole("alert");
    }
    // the 5th wrong attempt crosses the threshold
    await user.clear(input);
    await user.type(input, "wrong");
    await user.click(confirmButton);

    expect(await within(situation).findByRole("alert")).toHaveTextContent(/trop de tentatives/i);
    expect(confirmButton).toBeDisabled();
  });

  it("rejects a different user's password, even an admin's — only the logged-in user's own works", async () => {
    // distinct, explicit passwords specifically to make this unambiguous,
    // rather than relying on createTestUser's shared convenience password
    // for both users
    const { user: adminUser } = await usersRepository.create({
      username: "the-admin",
      displayName: "The Admin",
      password: "admin-only-password",
      role: "admin",
    });
    const { user: viewerUser } = await usersRepository.create({
      username: "the-viewer",
      displayName: "The Viewer",
      password: "viewer-only-password",
      role: "viewer",
    });
    void adminUser;
    const dek = getActiveDek();
    if (!dek) throw new Error("Expected an active DEK after creating users.");
    const user = userEvent.setup();
    renderWithSession(<HomePanel />, { user: viewerUser, dek });

    const situation = (await screen.findByText(/situation financière/i)).closest("section")!;
    await user.click(within(situation).getByRole("button", { name: /^afficher$/i }));
    await user.type(within(situation).getByLabelText(/votre mot de passe/i), "admin-only-password");
    await user.click(within(situation).getByRole("button", { name: /^confirmer$/i }));

    expect(await within(situation).findByRole("alert")).toHaveTextContent(/incorrect/i);
    expect(within(situation).queryByRole("img")).not.toBeInTheDocument();

    // but the viewer's own password does work
    await user.clear(within(situation).getByLabelText(/votre mot de passe/i));
    await user.type(
      within(situation).getByLabelText(/votre mot de passe/i),
      "viewer-only-password",
    );
    await user.click(within(situation).getByRole("button", { name: /^confirmer$/i }));

    await within(situation).findByRole("button", { name: /masquer à nouveau/i });
  });

  it("shows the cumulative balance across all accounts once revealed", async () => {
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
    const user = userEvent.setup();
    renderWithSession(<HomePanel />, session);

    const situation = (await screen.findByText(/situation financière/i)).closest("section")!;
    await user.click(within(situation).getByRole("button", { name: /^afficher$/i }));
    await user.type(within(situation).getByLabelText(/votre mot de passe/i), "test-password-123");
    await user.click(within(situation).getByRole("button", { name: /^confirmer$/i }));

    await within(situation).findByRole("img", { name: /répartition du solde par compte/i });
    expect(within(situation).getByText(/Compte A/)).toBeInTheDocument();
    expect(within(situation).getByText(/Compte B/)).toBeInTheDocument();
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

  it("shows the budget execution as a spent/remaining pie, aggregated across provisioned lines", async () => {
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
    await within(budgetSection).findByRole("img");
    expect(within(budgetSection).getByText(/Restant/)).toBeInTheDocument();
    expect(within(budgetSection).getByText(/50 000 FCFA/)).toBeInTheDocument();
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
