import { afterEach, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AccountsPanel } from "./AccountsPanel";
import { db } from "@/db/schema";

// These tests exercise the panel against the app's real singleton database
// (backed by fake-indexeddb in the test environment — see src/test/setup.ts).
// Tables are cleared after every test so state never leaks between tests.
afterEach(async () => {
  await db.transactions.clear();
  await db.accounts.clear();
});

describe("AccountsPanel", () => {
  it("shows an empty state with no accounts", async () => {
    render(<AccountsPanel />);
    expect(await screen.findByText(/aucun compte/i)).toBeInTheDocument();
  });

  it("creates an account through the form and lists it with its balance", async () => {
    const user = userEvent.setup();
    render(<AccountsPanel />);

    await user.type(screen.getByLabelText(/nom du compte/i), "Compte Principal");
    await user.clear(screen.getByLabelText(/solde initial/i));
    await user.type(screen.getByLabelText(/solde initial/i), "50000");
    await user.click(screen.getByRole("button", { name: /ajouter/i }));

    expect(await screen.findByText("Compte Principal")).toBeInTheDocument();
    const row = screen.getByText("Compte Principal").closest("tr");
    expect(row).not.toBeNull();
    expect(row!).toHaveTextContent("50 000 FCFA");
  });

  it("shows a validation error inline instead of throwing, and does not add the row", async () => {
    const user = userEvent.setup();
    render(<AccountsPanel />);

    await user.click(screen.getByRole("button", { name: /ajouter/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/obligatoire/i);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("rejects a duplicate account name with a clear message", async () => {
    const user = userEvent.setup();
    render(<AccountsPanel />);

    await user.type(screen.getByLabelText(/nom du compte/i), "Caisse");
    await user.click(screen.getByRole("button", { name: /ajouter/i }));
    await waitFor(() => expect(screen.getByLabelText(/nom du compte/i)).toHaveValue(""));

    await user.type(screen.getByLabelText(/nom du compte/i), "Caisse");
    await user.click(screen.getByRole("button", { name: /ajouter/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/existe déjà/i);

    // second attempt should have been rejected, so only one row exists
    const rows = await screen.findAllByRole("row");
    // header row + exactly one data row
    expect(rows).toHaveLength(2);
  });

  it("blocks deleting an account that still has transactions, with an explanatory message", async () => {
    const account = await db.accounts.add({
      id: "acc-1",
      name: "Avec opérations",
      initialBalance: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as never);
    await db.transactions.add({
      id: "tx-1",
      accountId: "acc-1",
      kind: "expense",
      date: "2026-01-01",
      label: "Test",
      amount: 100,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as never);
    void account;

    const user = userEvent.setup();
    render(<AccountsPanel />);

    const deleteButton = await screen.findByRole("button", { name: /supprimer/i });
    await user.click(deleteButton);

    expect(await screen.findByRole("alert")).toHaveTextContent(/opération/i);
    expect(screen.getByText("Avec opérations")).toBeInTheDocument();
  });
});
