import { afterEach, describe, expect, it } from "vitest";
import { screen, within, waitFor } from "@testing-library/react";
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
import type { Transaction, Transfer } from "@/types/models";
import { getAccountFlows, netOf } from "@/db/accountFlows";

afterEach(async () => {
  await db.users.clear();
  await db.transactions.clear();
  await db.transfers.clear();
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

async function seedSecondAccount() {
  await db.accounts.add(
    await encryptedFixture(
      {
        id: "acc-2",
        name: "Compte Épargne",
        initialBalance: 0,
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

  it("shows a red alert and blocks an expense that exceeds the available budget", async () => {
    const session = await createTestUser("admin");
    await seedAccount();
    await db.budgetCategories.add(
      await encryptedFixture(
        { id: "cat-1", name: "Vie Courante", createdAt: Date.now(), updatedAt: Date.now() },
        ["name"] as const,
      ),
    );
    await db.budgetSubcategories.add(
      await encryptedFixture(
        {
          id: "sub-1",
          categoryId: "cat-1",
          name: "Scolarité",
          monthlyAllocation: 10000,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        ["name", "monthlyAllocation"] as const,
      ),
    );
    const user = userEvent.setup();
    renderWithSession(<TransactionsPanel />, session);

    await user.selectOptions(await screen.findByLabelText(/compte$/i), "acc-1");
    await user.type(screen.getByLabelText(/libellé/i), "Trop cher");
    await user.type(screen.getByLabelText(/montant/i), "50000");
    await user.selectOptions(await screen.findByLabelText(/ligne budgétaire/i), "sub-1");
    await user.click(screen.getByRole("button", { name: /^\+ ajouter$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/dépasse le budget disponible/i);
    expect(screen.queryByText("Trop cher")).not.toBeInTheDocument();
  });

  describe("editing", () => {
    it("edits a transaction's label and amount", async () => {
      const session = await createTestUser("admin");
      await seedAccount();
      await db.transactions.add(
        await encryptedFixture<Transaction, "label" | "amount" | "note">(
          {
            id: "tx-1",
            accountId: "acc-1",
            kind: "expense",
            date: "2026-01-01",
            label: "Avant",
            amount: 1000,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
          ["label", "amount", "note"],
        ),
      );
      const user = userEvent.setup();
      renderWithSession(<TransactionsPanel />, session);

      await screen.findByText("Avant");
      await user.click(screen.getByRole("button", { name: /^modifier$/i }));
      const labelInput = screen.getByLabelText("Libellé de Avant");
      await user.clear(labelInput);
      await user.type(labelInput, "Après");
      const amountInput = screen.getByLabelText("Montant de Avant");
      await user.clear(amountInput);
      await user.type(amountInput, "2000");
      await user.click(screen.getByRole("button", { name: /enregistrer/i }));

      expect(await screen.findByText("Après")).toBeInTheDocument();
      expect(screen.queryByText("Avant")).not.toBeInTheDocument();
      const row = screen.getByText("Après").closest("tr");
      expect(row!).toHaveTextContent("2 000 FCFA");
    });

    it("moves a transaction to a different account", async () => {
      const session = await createTestUser("admin");
      await seedAccount();
      await db.accounts.add(
        await encryptedFixture(
          {
            id: "acc-2",
            name: "Deuxième Compte",
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
            label: "DepenseTest",
            amount: 1000,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
          ["label", "amount", "note"],
        ),
      );
      const user = userEvent.setup();
      renderWithSession(<TransactionsPanel />, session);

      await screen.findByText("DepenseTest");
      await user.click(screen.getByRole("button", { name: /^modifier$/i }));
      await user.selectOptions(screen.getByLabelText("Compte de DepenseTest"), "acc-2");
      await user.click(screen.getByRole("button", { name: /enregistrer/i }));

      // polls the row itself until it reflects the update — more robust
      // than chaining separate text queries, since "Deuxième Compte" also
      // legitimately appears as an <option> in the create form's account
      // dropdown above the table
      const table = await screen.findByRole("table");
      await waitFor(() => {
        const row = within(table).getByText("DepenseTest").closest("tr")!;
        expect(row).toHaveTextContent("Deuxième Compte");
      });
    });

    it("cancels an edit without saving changes", async () => {
      const session = await createTestUser("admin");
      await seedAccount();
      await db.transactions.add(
        await encryptedFixture<Transaction, "label" | "amount" | "note">(
          {
            id: "tx-1",
            accountId: "acc-1",
            kind: "expense",
            date: "2026-01-01",
            label: "Original",
            amount: 1000,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
          ["label", "amount", "note"],
        ),
      );
      const user = userEvent.setup();
      renderWithSession(<TransactionsPanel />, session);

      await screen.findByText("Original");
      await user.click(screen.getByRole("button", { name: /^modifier$/i }));
      const labelInput = screen.getByLabelText("Libellé de Original");
      await user.clear(labelInput);
      await user.type(labelInput, "Ne devrait pas être enregistré");
      await user.click(screen.getByRole("button", { name: /annuler/i }));

      expect(screen.getByText("Original")).toBeInTheDocument();
      expect(screen.queryByText("Ne devrait pas être enregistré")).not.toBeInTheDocument();
    });

    it("does not show a Modifier button for a user without manageTransactions", async () => {
      const session = await createTestUser("viewer");
      await seedAccount();
      await db.transactions.add(
        await encryptedFixture<Transaction, "label" | "amount" | "note">(
          {
            id: "tx-1",
            accountId: "acc-1",
            kind: "expense",
            date: "2026-01-01",
            label: "Test",
            amount: 1000,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
          ["label", "amount", "note"],
        ),
      );
      renderWithSession(<TransactionsPanel />, session);

      await screen.findByText("Test");
      expect(screen.queryByRole("button", { name: /modifier/i })).not.toBeInTheDocument();
    });
  });

  describe("transfers between accounts", () => {
    it("does not show the transfer form with only one account", async () => {
      const session = await createTestUser("admin");
      await seedAccount();
      renderWithSession(<TransactionsPanel />, session);

      await screen.findByLabelText(/libellé/i);
      expect(screen.queryByText(/transferts entre comptes/i)).not.toBeInTheDocument();
    });

    it("creates a transfer and lists it, showing both account names", async () => {
      const session = await createTestUser("admin");
      await seedAccount();
      await seedSecondAccount();
      const user = userEvent.setup();
      renderWithSession(<TransactionsPanel />, session);

      await user.selectOptions(await screen.findByLabelText(/compte source/i), "acc-1");
      await user.selectOptions(screen.getByLabelText(/compte destination/i), "acc-2");
      await user.type(screen.getByLabelText(/^montant$/i), "10000");
      await user.type(screen.getByLabelText(/libellé \(optionnel\)/i), "Vers épargne");
      await user.click(
        within(screen.getByRole("form", { name: /ajouter un transfert/i })).getByRole("button", {
          name: /^\+ ajouter$/i,
        }),
      );

      const row = await screen.findByText("Vers épargne").then((el) => el.closest("tr")!);
      expect(row).toHaveTextContent("Compte Test");
      expect(row).toHaveTextContent("Compte Épargne");
      expect(row).toHaveTextContent("10 000 FCFA");
    });

    it("affects both accounts' balances correctly", async () => {
      const session = await createTestUser("admin");
      await seedAccount();
      await seedSecondAccount();
      const user = userEvent.setup();
      renderWithSession(<TransactionsPanel />, session);

      await user.selectOptions(await screen.findByLabelText(/compte source/i), "acc-1");
      await user.selectOptions(screen.getByLabelText(/compte destination/i), "acc-2");
      await user.type(screen.getByLabelText(/^montant$/i), "10000");
      await user.click(
        within(screen.getByRole("form", { name: /ajouter un transfert/i })).getByRole("button", {
          name: /^\+ ajouter$/i,
        }),
      );
      await screen.findByText("10 000 FCFA");

      const flows = await getAccountFlows(db);
      expect(netOf(flows.get("acc-1"))).toBe(-10000);
      expect(netOf(flows.get("acc-2"))).toBe(10000);
    });

    it("rejects transferring an account to itself, with an inline error", async () => {
      const session = await createTestUser("admin");
      await seedAccount();
      await seedSecondAccount();
      const user = userEvent.setup();
      renderWithSession(<TransactionsPanel />, session);

      await user.selectOptions(await screen.findByLabelText(/compte source/i), "acc-1");
      await user.selectOptions(screen.getByLabelText(/compte destination/i), "acc-1");
      await user.type(screen.getByLabelText(/^montant$/i), "1000");
      await user.click(
        within(screen.getByRole("form", { name: /ajouter un transfert/i })).getByRole("button", {
          name: /^\+ ajouter$/i,
        }),
      );

      expect(await screen.findByRole("alert")).toHaveTextContent(/différents/i);
    });

    it("edits a transfer's amount and label", async () => {
      const session = await createTestUser("admin");
      await seedAccount();
      await seedSecondAccount();
      await db.transfers.add(
        await encryptedFixture<Transfer, "amount" | "label" | "note">(
          {
            id: "tr-1",
            fromAccountId: "acc-1",
            toAccountId: "acc-2",
            date: "2026-01-01",
            amount: 5000,
            label: "Avant",
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
          ["amount", "label", "note"],
        ),
      );
      const user = userEvent.setup();
      renderWithSession(<TransactionsPanel />, session);

      await screen.findByText("Avant");
      await user.click(screen.getByRole("button", { name: /^modifier$/i }));
      const labelInput = screen.getByLabelText(/libellé du transfert/i);
      await user.clear(labelInput);
      await user.type(labelInput, "Après");
      await user.click(screen.getByRole("button", { name: /enregistrer/i }));

      await waitFor(() => {
        const row = screen.getByText("Après").closest("tr")!;
        expect(row).toHaveTextContent("Après");
      });
      expect(screen.queryByText("Avant")).not.toBeInTheDocument();
    });

    it("cancels a transfer edit without saving changes", async () => {
      const session = await createTestUser("admin");
      await seedAccount();
      await seedSecondAccount();
      await db.transfers.add(
        await encryptedFixture<Transfer, "amount" | "label" | "note">(
          {
            id: "tr-1",
            fromAccountId: "acc-1",
            toAccountId: "acc-2",
            date: "2026-01-01",
            amount: 5000,
            label: "Original",
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
          ["amount", "label", "note"],
        ),
      );
      const user = userEvent.setup();
      renderWithSession(<TransactionsPanel />, session);

      await screen.findByText("Original");
      await user.click(screen.getByRole("button", { name: /^modifier$/i }));
      const labelInput = screen.getByLabelText(/libellé du transfert/i);
      await user.clear(labelInput);
      await user.type(labelInput, "Ne devrait pas être enregistré");
      await user.click(screen.getByRole("button", { name: /annuler/i }));

      expect(screen.getByText("Original")).toBeInTheDocument();
    });

    it("deletes a transfer", async () => {
      const session = await createTestUser("admin");
      await seedAccount();
      await seedSecondAccount();
      await db.transfers.add(
        await encryptedFixture<Transfer, "amount" | "label" | "note">(
          {
            id: "tr-1",
            fromAccountId: "acc-1",
            toAccountId: "acc-2",
            date: "2026-01-01",
            amount: 5000,
            label: "À supprimer",
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
          ["amount", "label", "note"],
        ),
      );
      const user = userEvent.setup();
      renderWithSession(<TransactionsPanel />, session);

      await screen.findByText("À supprimer");
      await user.click(screen.getByRole("button", { name: /supprimer/i }));

      await waitFor(() => {
        expect(screen.queryByText("À supprimer")).not.toBeInTheDocument();
      });
    });

    it("does not show the transfer form or Modifier buttons for a user without manageTransactions", async () => {
      const session = await createTestUser("viewer");
      await seedAccount();
      await seedSecondAccount();
      await db.transfers.add(
        await encryptedFixture<Transfer, "amount" | "label" | "note">(
          {
            id: "tr-1",
            fromAccountId: "acc-1",
            toAccountId: "acc-2",
            date: "2026-01-01",
            amount: 5000,
            label: "Visible",
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
          ["amount", "label", "note"],
        ),
      );
      renderWithSession(<TransactionsPanel />, session);

      await screen.findByText("Visible");
      expect(screen.queryByLabelText(/compte source/i)).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /modifier/i })).not.toBeInTheDocument();
    });
  });
});
