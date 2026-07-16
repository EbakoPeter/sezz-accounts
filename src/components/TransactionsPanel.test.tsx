import { afterEach, describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TransactionsPanel } from "./TransactionsPanel";
import { db } from "@/db/schema";
import { clearActiveDek } from "@/lib/encryptionSession";
import { encryptedFixture } from "@/test/encryptedFixture";
import {
  createTestUser,
  renderWithSession,
  renderAuthenticated,
  type TestSession,
} from "@/test/renderAuthenticated";
import type { Transaction } from "@/types/models";

afterEach(async () => {
  await db.users.clear();
  await db.transactions.clear();
  await db.accounts.clear();
  clearActiveDek();
});

async function seedAccount() {
  await db.accounts.add(
    await encryptedFixture(
      {
        id: "acc-1",
        name: "Compte Test",
        initialBalance: 100000,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      ["name", "initialBalance"] as const,
    ),
  );
}

describe("TransactionsPanel", () => {
  it("prompts to create an account first when none exist", async () => {
    await renderAuthenticated(<TransactionsPanel />);
    expect(await screen.findByText(/créez d'abord un compte/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/libellé/i)).not.toBeInTheDocument();
  });

  it("creates a transaction against an existing account and lists it", async () => {
    const session: TestSession = await createTestUser("admin");
    await seedAccount();
    const user = userEvent.setup();
    renderWithSession(<TransactionsPanel />, session);

    await screen.findByLabelText(/compte/i);
    await user.selectOptions(screen.getByLabelText(/compte$/i), "acc-1");
    await user.selectOptions(screen.getByLabelText(/type/i), "expense");
    await user.type(screen.getByLabelText(/libellé/i), "Courses");
    await user.type(screen.getByLabelText(/montant/i), "15000");
    await user.click(screen.getByRole("button", { name: /ajouter/i }));

    expect(await screen.findByText("Courses")).toBeInTheDocument();
    const row = screen.getByText("Courses").closest("tr");
    expect(row!).toHaveTextContent("Compte Test");
    expect(row!).toHaveTextContent("-15 000 FCFA");
  });

  it("resolves the account name by id (join at render time) rather than storing it redundantly", async () => {
    const session = await createTestUser("admin");
    await seedAccount();
    await db.transactions.add(
      await encryptedFixture<Transaction, "label" | "amount" | "note">(
        {
          id: "tx-1",
          accountId: "acc-1",
          kind: "income",
          date: "2026-02-01",
          label: "Salaire",
          amount: 300000,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        ["label", "amount", "note"],
      ),
    );

    renderWithSession(<TransactionsPanel />, session);

    const row = await screen.findByText("Salaire");
    expect(row.closest("tr")!).toHaveTextContent("Compte Test");
  });

  it("shows a validation error inline when the amount is invalid", async () => {
    const session = await createTestUser("admin");
    await seedAccount();
    const user = userEvent.setup();
    renderWithSession(<TransactionsPanel />, session);

    await screen.findByLabelText(/compte/i);
    await user.selectOptions(screen.getByLabelText(/compte$/i), "acc-1");
    await user.type(screen.getByLabelText(/libellé/i), "Mauvais montant");
    await user.type(screen.getByLabelText(/montant/i), "-5");
    await user.click(screen.getByRole("button", { name: /ajouter/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/positif/i);
    expect(screen.queryByText("Mauvais montant")).not.toBeInTheDocument();
  });
});
