import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AccountsPanel } from "./AccountsPanel";
import { db } from "@/db/schema";
import { clearActiveDek } from "@/lib/encryptionSession";
import { encryptedFixture } from "@/test/encryptedFixture";
import { createTestUser, renderWithSession, renderAuthenticated } from "@/test/renderAuthenticated";
import type { Transaction } from "@/types/models";

// These tests exercise the panel against the app's real singleton database
// (backed by fake-indexeddb in the test environment — see src/test/setup.ts).
// Tables are cleared after every test so state never leaks between tests.
afterEach(async () => {
  await db.users.clear();
  await db.transactions.clear();
  await db.accounts.clear();
  clearActiveDek();
  vi.restoreAllMocks();
});

// Deletion now asks for confirmation first — defaults to "confirmed" so
// every existing test that expects a delete to actually happen doesn't
// need to know about this dialog. Tests specifically covering the
// "cancelled" path override this per-test.
beforeEach(() => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

describe("AccountsPanel", () => {
  it("shows an empty state with no accounts", async () => {
    await renderAuthenticated(<AccountsPanel />);
    expect(await screen.findByText(/aucun compte/i)).toBeInTheDocument();
  });

  it("creates an account through the form and lists it with its balance", async () => {
    const user = userEvent.setup();
    await renderAuthenticated(<AccountsPanel />);

    await user.type(screen.getByLabelText(/nom du compte/i), "Compte Principal");
    await user.clear(screen.getByLabelText(/solde initial/i));
    await user.type(screen.getByLabelText(/solde initial/i), "50000");
    await user.click(screen.getByRole("button", { name: /ajouter/i }));

    expect(await screen.findByText("Compte Principal")).toBeInTheDocument();
    const row = screen.getByText("Compte Principal").closest("tr");
    expect(row).not.toBeNull();
    expect(row!).toHaveTextContent("50 000 FCFA");
  });

  it("asks for confirmation before deleting, and does not delete when cancelled", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = userEvent.setup();
    await renderAuthenticated(<AccountsPanel />);

    await user.type(screen.getByLabelText(/nom du compte/i), "Compte À Garder");
    await user.click(screen.getByRole("button", { name: /^\+ ajouter$/i }));
    await screen.findByText("Compte À Garder");

    await user.click(screen.getByRole("button", { name: /supprimer/i }));

    expect(window.confirm).toHaveBeenCalledTimes(1);
    // still there — the cancelled confirmation must not have deleted it
    expect(screen.getByText("Compte À Garder")).toBeInTheDocument();
  });

  it("deletes after confirmation is accepted", async () => {
    const user = userEvent.setup();
    await renderAuthenticated(<AccountsPanel />);

    await user.type(screen.getByLabelText(/nom du compte/i), "Compte À Supprimer");
    await user.click(screen.getByRole("button", { name: /^\+ ajouter$/i }));
    await screen.findByText("Compte À Supprimer");

    await user.click(screen.getByRole("button", { name: /supprimer/i }));

    await waitFor(() => {
      expect(screen.queryByText("Compte À Supprimer")).not.toBeInTheDocument();
    });
  });

  it("shows a validation error inline instead of throwing, and does not add the row", async () => {
    const user = userEvent.setup();
    await renderAuthenticated(<AccountsPanel />);

    await user.click(screen.getByRole("button", { name: /ajouter/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/obligatoire/i);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("rejects a duplicate account name with a clear message", async () => {
    const user = userEvent.setup();
    await renderAuthenticated(<AccountsPanel />);

    await user.type(screen.getByLabelText(/nom du compte/i), "Caisse");
    await user.click(screen.getByRole("button", { name: /ajouter/i }));
    await waitFor(() => expect(screen.getByLabelText(/nom du compte/i)).toHaveValue(""));

    await user.type(screen.getByLabelText(/nom du compte/i), "Caisse");
    await user.click(screen.getByRole("button", { name: /ajouter/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/existe déjà/i);

    // second attempt should have been rejected, so only one row exists
    const rows = await screen.findAllByRole("row");
    // header row + exactly one data row + footer total row
    expect(rows).toHaveLength(3);
  });

  it("blocks deleting an account that still has transactions, with an explanatory message", async () => {
    const session = await createTestUser("admin");
    await db.accounts.add(
      await encryptedFixture(
        {
          id: "acc-1",
          name: "Avec opérations",
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
          date: "2026-01-01",
          label: "Test",
          amount: 100,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        ["label", "amount", "note"] as const,
      ),
    );

    const user = userEvent.setup();
    renderWithSession(<AccountsPanel />, session);

    const deleteButton = await screen.findByRole("button", { name: /supprimer/i });
    await user.click(deleteButton);

    expect(await screen.findByRole("alert")).toHaveTextContent(/opération/i);
    expect(screen.getByText("Avec opérations")).toBeInTheDocument();
  });

  describe("permission gating", () => {
    it("hides the create form and delete buttons for a user without manageAccounts", async () => {
      const session = await createTestUser("viewer");
      await db.accounts.add(
        await encryptedFixture(
          {
            id: "acc-1",
            name: "Compte Existant",
            initialBalance: 5000,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
          ["name", "initialBalance"] as const,
        ),
      );

      renderWithSession(<AccountsPanel />, session);

      expect(await screen.findByText("Compte Existant")).toBeInTheDocument();
      expect(screen.getByText(/pas la permission/i)).toBeInTheDocument();
      expect(screen.queryByLabelText(/nom du compte/i)).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /supprimer/i })).not.toBeInTheDocument();
    });

    it("shows the create form for a user with manageAccounts explicitly granted", async () => {
      await renderAuthenticated(<AccountsPanel />, {
        role: "viewer",
        permissionOverrides: { manageAccounts: true },
      });
      expect(await screen.findByLabelText(/nom du compte/i)).toBeInTheDocument();
    });
  });

  describe("editing", () => {
    it("edits an account's name and initial balance", async () => {
      const user = userEvent.setup();
      await renderAuthenticated(<AccountsPanel />);

      await user.type(screen.getByLabelText(/nom du compte/i), "Avant");
      await user.clear(screen.getByLabelText(/solde initial/i));
      await user.type(screen.getByLabelText(/solde initial/i), "1000");
      await user.click(screen.getByRole("button", { name: /^\+ ajouter$/i }));
      await screen.findByText("Avant");

      await user.click(screen.getByRole("button", { name: /^modifier$/i }));
      const nameInput = screen.getByLabelText("Nom de Avant");
      await user.clear(nameInput);
      await user.type(nameInput, "Après");
      const balanceInput = screen.getByLabelText("Solde initial de Avant");
      await user.clear(balanceInput);
      await user.type(balanceInput, "2000");
      await user.click(screen.getByRole("button", { name: /enregistrer/i }));

      expect(await screen.findByText("Après")).toBeInTheDocument();
      expect(screen.queryByText("Avant")).not.toBeInTheDocument();
      const row = screen.getByText("Après").closest("tr");
      expect(row!).toHaveTextContent("2 000 FCFA");
    });

    it("cancels an edit without saving changes", async () => {
      const user = userEvent.setup();
      await renderAuthenticated(<AccountsPanel />);

      await user.type(screen.getByLabelText(/nom du compte/i), "Original");
      await user.click(screen.getByRole("button", { name: /^\+ ajouter$/i }));
      await screen.findByText("Original");

      await user.click(screen.getByRole("button", { name: /^modifier$/i }));
      const nameInput = screen.getByLabelText("Nom de Original");
      await user.clear(nameInput);
      await user.type(nameInput, "Ne devrait pas être enregistré");
      await user.click(screen.getByRole("button", { name: /annuler/i }));

      expect(screen.getByText("Original")).toBeInTheDocument();
      expect(screen.queryByText("Ne devrait pas être enregistré")).not.toBeInTheDocument();
    });

    it("shows a validation error inline when saving an invalid edit", async () => {
      const user = userEvent.setup();
      await renderAuthenticated(<AccountsPanel />);

      await user.type(screen.getByLabelText(/nom du compte/i), "CompteTest");
      await user.click(screen.getByRole("button", { name: /^\+ ajouter$/i }));
      await screen.findByText("CompteTest");

      await user.click(screen.getByRole("button", { name: /^modifier$/i }));
      const nameInput = screen.getByLabelText("Nom de CompteTest");
      await user.clear(nameInput);
      await user.click(screen.getByRole("button", { name: /enregistrer/i }));

      expect(await screen.findByRole("alert")).toHaveTextContent(/obligatoire/i);
    });

    it("does not show a Modifier button for a user without manageAccounts", async () => {
      const session = await createTestUser("viewer");
      await db.accounts.add(
        await encryptedFixture(
          {
            id: "acc-1",
            name: "Compte Existant",
            initialBalance: 5000,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
          ["name", "initialBalance"] as const,
        ),
      );
      renderWithSession(<AccountsPanel />, session);

      await screen.findByText("Compte Existant");
      expect(screen.queryByRole("button", { name: /modifier/i })).not.toBeInTheDocument();
    });
  });

  describe("total balance", () => {
    it("shows the sum of every account's current balance, not just the initial balances", async () => {
      const user = userEvent.setup();
      await renderAuthenticated(<AccountsPanel />);

      await user.type(screen.getByLabelText(/nom du compte/i), "Compte A");
      await user.clear(screen.getByLabelText(/solde initial/i));
      await user.type(screen.getByLabelText(/solde initial/i), "10000");
      await user.click(screen.getByRole("button", { name: /^\+ ajouter$/i }));
      await screen.findByText("Compte A");

      await user.type(screen.getByLabelText(/nom du compte/i), "Compte B");
      await user.clear(screen.getByLabelText(/solde initial/i));
      await user.type(screen.getByLabelText(/solde initial/i), "5000");
      await user.click(screen.getByRole("button", { name: /^\+ ajouter$/i }));

      const footer = await waitFor(() => {
        const row = screen.getByText("Total").closest("tr")!;
        expect(row).toHaveTextContent("15 000 FCFA");
        return row;
      });
      expect(footer).toBeInTheDocument();
    });

    it("shows a negative total in the same style as a negative row", async () => {
      const session = await createTestUser("admin");
      await db.accounts.add(
        await encryptedFixture(
          {
            id: "acc-1",
            name: "Compte Découvert",
            initialBalance: 1000,
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
            date: "2026-01-01",
            label: "Grosse dépense",
            amount: 1500,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
          ["label", "amount", "note"],
        ),
      );
      renderWithSession(<AccountsPanel />, session);

      await waitFor(() => {
        const totalCell = screen.getByText("Total").closest("tr")!.querySelector(".negative");
        expect(totalCell).not.toBeNull();
      });
    });

    it("does not show a total row when there are no accounts", async () => {
      await renderAuthenticated(<AccountsPanel />);
      await screen.findByText(/aucun compte/i);
      expect(screen.queryByText("Total")).not.toBeInTheDocument();
    });
  });
});
