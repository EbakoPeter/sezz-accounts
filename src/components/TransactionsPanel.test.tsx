import { afterEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TransactionsPanel } from "./TransactionsPanel";
import { db } from "@/db/schema";

afterEach(async () => {
  await db.transactions.clear();
  await db.accounts.clear();
});

async function seedAccount() {
  await db.accounts.add({
    id: "acc-1",
    name: "Compte Test",
    initialBalance: 100000,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  } as never);
}

describe("TransactionsPanel", () => {
  it("prompts to create an account first when none exist", async () => {
    render(<TransactionsPanel />);
    expect(await screen.findByText(/créez d'abord un compte/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/libellé/i)).not.toBeInTheDocument();
  });

  it("creates a transaction against an existing account and lists it", async () => {
    await seedAccount();
    const user = userEvent.setup();
    render(<TransactionsPanel />);

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
    await seedAccount();
    await db.transactions.add({
      id: "tx-1",
      accountId: "acc-1",
      kind: "income",
      date: "2026-02-01",
      label: "Salaire",
      amount: 300000,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as never);

    render(<TransactionsPanel />);

    const row = await screen.findByText("Salaire");
    expect(row.closest("tr")!).toHaveTextContent("Compte Test");
  });

  it("shows a validation error inline when the amount is invalid", async () => {
    await seedAccount();
    const user = userEvent.setup();
    render(<TransactionsPanel />);

    await screen.findByLabelText(/compte/i);
    await user.selectOptions(screen.getByLabelText(/compte$/i), "acc-1");
    await user.type(screen.getByLabelText(/libellé/i), "Mauvais montant");
    await user.type(screen.getByLabelText(/montant/i), "-5");
    await user.click(screen.getByRole("button", { name: /ajouter/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/positif/i);
    expect(screen.queryByText("Mauvais montant")).not.toBeInTheDocument();
  });
});
