import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DebtsPanel } from "./DebtsPanel";
import { db } from "@/db/schema";
import { clearActiveDek } from "@/lib/encryptionSession";
import { encryptedFixture } from "@/test/encryptedFixture";
import {
  createTestUser,
  renderWithSession,
  renderAuthenticated,
  type TestSession,
} from "@/test/renderAuthenticated";
import type { Debt } from "@/types/models";

afterEach(async () => {
  await db.users.clear();
  await db.debtPayments.clear();
  await db.debts.clear();
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

async function seedAccount() {
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
}

describe("DebtsPanel", () => {
  it("prompts to create an account first when none exist", async () => {
    await renderAuthenticated(<DebtsPanel />);
    expect(await screen.findByText(/créez d'abord un compte/i)).toBeInTheDocument();
  });

  it("shows an empty state with no debts", async () => {
    const session = await createTestUser("admin");
    await seedAccount();
    renderWithSession(<DebtsPanel />, session);
    expect(await screen.findByText(/aucune dette ou créance/i)).toBeInTheDocument();
  });

  it("creates a debt with an auto-assigned reference and shows the planned monthly payment", async () => {
    const session = await createTestUser("admin");
    await seedAccount();
    const user = userEvent.setup();
    renderWithSession(<DebtsPanel />, session);

    await screen.findByLabelText(/^type$/i);
    await user.selectOptions(screen.getByLabelText(/^type$/i), "debt");
    await user.type(screen.getByLabelText(/tiers/i), "Banque XYZ");
    await user.selectOptions(screen.getByLabelText(/compte concerné/i), "acc-1");
    await user.type(screen.getByLabelText(/^montant$/i), "600000");
    fireEvent.change(screen.getByLabelText(/^date$/i), { target: { value: "2026-01-01" } });
    fireEvent.change(screen.getByLabelText(/échéance/i), { target: { value: "2026-07-01" } });
    await user.click(screen.getByRole("button", { name: /ajouter/i }));

    expect(await screen.findByText("D01")).toBeInTheDocument();
    const row = screen.getByText("D01").closest("tr");
    expect(row).not.toBeNull();
    expect(row!).toHaveTextContent("Banque XYZ");
    expect(row!).toHaveTextContent("600 000 FCFA");
    expect(row!).toHaveTextContent("100 000 FCFA"); // planned monthly: 600000/6
  });

  it("shows a validation error inline for an empty counterparty", async () => {
    const session = await createTestUser("admin");
    await seedAccount();
    const user = userEvent.setup();
    renderWithSession(<DebtsPanel />, session);

    await screen.findByLabelText(/compte concerné/i);
    await user.selectOptions(screen.getByLabelText(/compte concerné/i), "acc-1");
    await user.type(screen.getByLabelText(/^montant$/i), "1000");
    await user.click(screen.getByRole("button", { name: /ajouter/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/tiers/i);
  });

  it("records a payment and reflects the reduced remaining balance live", async () => {
    const session: TestSession = await createTestUser("admin");
    await seedAccount();
    await db.debts.add(
      await encryptedFixture<Debt, "counterparty" | "amount" | "dueDate" | "description">(
        {
          id: "debt-1",
          reference: "D01",
          kind: "debt",
          counterparty: "Banque",
          accountId: "acc-1",
          amount: 100000,
          date: "2026-01-01",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        ["counterparty", "amount", "dueDate", "description"],
      ),
    );

    const user = userEvent.setup();
    renderWithSession(<DebtsPanel />, session);

    await screen.findByText("D01");
    await user.selectOptions(screen.getByLabelText(/dette \/ créance/i), "debt-1");
    await user.selectOptions(screen.getAllByLabelText(/compte concerné/i)[1]!, "acc-1");
    await user.type(screen.getAllByLabelText(/^montant$/i)[1]!, "30000");
    await user.click(screen.getAllByRole("button", { name: /\+ ajouter/i })[1]!);

    const updatedRemaining = await screen.findByText("70 000 FCFA");
    expect(updatedRemaining.closest("tr")!).toHaveTextContent("D01");
  });

  describe("editing", () => {
    async function seedDebt() {
      await db.debts.add(
        await encryptedFixture<Debt, "counterparty" | "amount" | "dueDate" | "description">(
          {
            id: "debt-1",
            reference: "D01",
            kind: "debt",
            counterparty: "Avant",
            accountId: "acc-1",
            amount: 100000,
            date: "2026-01-01",
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
          ["counterparty", "amount", "dueDate", "description"],
        ),
      );
    }

    it("edits a debt's counterparty and amount", async () => {
      const session = await createTestUser("admin");
      await seedAccount();
      await seedDebt();
      const user = userEvent.setup();
      renderWithSession(<DebtsPanel />, session);

      await screen.findByText("D01");
      await user.click(await screen.findByRole("button", { name: /^modifier$/i }));
      const counterpartyInput = screen.getByLabelText("Tiers de D01");
      await user.clear(counterpartyInput);
      await user.type(counterpartyInput, "Après");
      const amountInput = screen.getByLabelText("Montant de D01");
      await user.clear(amountInput);
      await user.type(amountInput, "200000");
      await user.click(screen.getByRole("button", { name: /enregistrer/i }));

      await waitFor(() => {
        const row = screen.getByText("D01").closest("tr")!;
        expect(row).toHaveTextContent("Après");
        expect(row).toHaveTextContent("200 000 FCFA");
      });
    });

    it("changes the kind from debt to receivable", async () => {
      const session = await createTestUser("admin");
      await seedAccount();
      await seedDebt();
      const user = userEvent.setup();
      renderWithSession(<DebtsPanel />, session);

      await screen.findByText("D01");
      await user.click(await screen.findByRole("button", { name: /^modifier$/i }));
      await user.selectOptions(screen.getByLabelText("Type de D01"), "receivable");
      await user.click(screen.getByRole("button", { name: /enregistrer/i }));

      await waitFor(() => {
        const row = screen.getByText("D01").closest("tr")!;
        expect(row).toHaveTextContent("Créance");
      });
    });

    it("clears the due date when the field is emptied", async () => {
      const session = await createTestUser("admin");
      await seedAccount();
      await db.debts.add(
        await encryptedFixture<Debt, "counterparty" | "amount" | "dueDate" | "description">(
          {
            id: "debt-1",
            reference: "D01",
            kind: "debt",
            counterparty: "Test",
            accountId: "acc-1",
            amount: 100000,
            date: "2026-01-01",
            dueDate: "2026-06-01",
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
          ["counterparty", "amount", "dueDate", "description"],
        ),
      );
      const user = userEvent.setup();
      renderWithSession(<DebtsPanel />, session);

      const row = (await screen.findByText("D01")).closest("tr")!;
      expect(row).toHaveTextContent("2026-06-01");

      await user.click(await screen.findByRole("button", { name: /^modifier$/i }));
      const dueDateInput = screen.getByLabelText("Échéance de D01");
      fireEvent.change(dueDateInput, { target: { value: "" } });
      await user.click(screen.getByRole("button", { name: /enregistrer/i }));

      await waitFor(() => {
        const updatedRow = screen.getByText("D01").closest("tr")!;
        expect(updatedRow).not.toHaveTextContent("2026-06-01");
      });
    });

    it("cancels an edit without saving changes", async () => {
      const session = await createTestUser("admin");
      await seedAccount();
      await seedDebt();
      const user = userEvent.setup();
      renderWithSession(<DebtsPanel />, session);

      await screen.findByText("D01");
      await user.click(await screen.findByRole("button", { name: /^modifier$/i }));
      const counterpartyInput = screen.getByLabelText("Tiers de D01");
      await user.clear(counterpartyInput);
      await user.type(counterpartyInput, "Ne devrait pas être enregistré");
      await user.click(screen.getByRole("button", { name: /annuler/i }));

      const row = screen.getByText("D01").closest("tr")!;
      expect(row).toHaveTextContent("Avant");
      expect(row).not.toHaveTextContent("Ne devrait pas être enregistré");
    });

    it("does not show a Modifier button for a user without manageDebts", async () => {
      const session = await createTestUser("viewer");
      await seedAccount();
      await seedDebt();
      renderWithSession(<DebtsPanel />, session);

      await screen.findByText("D01");
      expect(screen.queryByRole("button", { name: /modifier/i })).not.toBeInTheDocument();
    });
  });

  describe("payments list and editing", () => {
    async function seedDebtWithPayment() {
      await db.debts.add(
        await encryptedFixture<Debt, "counterparty" | "amount" | "dueDate" | "description">(
          {
            id: "debt-1",
            reference: "D01",
            kind: "debt",
            counterparty: "Banque",
            accountId: "acc-1",
            amount: 100000,
            date: "2026-01-01",
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
          ["counterparty", "amount", "dueDate", "description"],
        ),
      );
      await db.debtPayments.add(
        await encryptedFixture(
          {
            id: "payment-1",
            debtId: "debt-1",
            accountId: "acc-1",
            amount: 10000,
            date: "2026-02-01",
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
          ["amount"] as const,
        ),
      );
    }

    it("lists a recorded payment with its debt reference and account", async () => {
      const session = await createTestUser("admin");
      await seedAccount();
      await seedDebtWithPayment();
      renderWithSession(<DebtsPanel />, session);

      const row = (await screen.findByText("10 000 FCFA")).closest("tr")!;
      expect(row).toHaveTextContent("D01");
      expect(row).toHaveTextContent("Compte Test");
      expect(row).toHaveTextContent("2026-02-01");
    });

    it("edits a payment's amount and date", async () => {
      const session = await createTestUser("admin");
      await seedAccount();
      await seedDebtWithPayment();
      const user = userEvent.setup();
      renderWithSession(<DebtsPanel />, session);

      await screen.findByText("10 000 FCFA");
      const paymentRow = screen.getByText("10 000 FCFA").closest("tr")!;
      await user.click(within(paymentRow).getByRole("button", { name: /^modifier$/i }));
      const amountInput = screen.getByLabelText("Montant du remboursement du 2026-02-01");
      await user.clear(amountInput);
      await user.type(amountInput, "15000");
      const dateInput = screen.getByLabelText("Date du remboursement du 2026-02-01");
      await user.clear(dateInput);
      await user.type(dateInput, "2026-02-15");
      await user.click(screen.getByRole("button", { name: /enregistrer/i }));

      await waitFor(() => {
        const row = screen.getByText("15 000 FCFA").closest("tr")!;
        expect(row).toHaveTextContent("D01");
        expect(row).toHaveTextContent("2026-02-15");
      });
    });

    it("cancels a payment edit without saving changes", async () => {
      const session = await createTestUser("admin");
      await seedAccount();
      await seedDebtWithPayment();
      const user = userEvent.setup();
      renderWithSession(<DebtsPanel />, session);

      await screen.findByText("10 000 FCFA");
      const paymentRow = screen.getByText("10 000 FCFA").closest("tr")!;
      await user.click(within(paymentRow).getByRole("button", { name: /^modifier$/i }));
      const amountInput = screen.getByLabelText("Montant du remboursement du 2026-02-01");
      await user.clear(amountInput);
      await user.type(amountInput, "99999");
      await user.click(screen.getByRole("button", { name: /annuler/i }));

      expect(screen.getByText("10 000 FCFA")).toBeInTheDocument();
      expect(screen.queryByText("99 999 FCFA")).not.toBeInTheDocument();
    });

    it("deletes a payment", async () => {
      const session = await createTestUser("admin");
      await seedAccount();
      await seedDebtWithPayment();
      const user = userEvent.setup();
      renderWithSession(<DebtsPanel />, session);

      await screen.findByText("10 000 FCFA");
      const paymentRow = screen.getByText("10 000 FCFA").closest("tr")!;
      await user.click(within(paymentRow).getByRole("button", { name: /^supprimer$/i }));

      await waitFor(() => {
        expect(screen.queryByText("10 000 FCFA")).not.toBeInTheDocument();
      });
    });

    it("does not show Modifier/Supprimer for a user without manageDebts, but still lists the payment", async () => {
      const session = await createTestUser("viewer");
      await seedAccount();
      await seedDebtWithPayment();
      renderWithSession(<DebtsPanel />, session);

      const row = (await screen.findByText("10 000 FCFA")).closest("tr")!;
      expect(row).toHaveTextContent("D01");
      expect(screen.queryByRole("button", { name: /modifier|supprimer/i })).not.toBeInTheDocument();
    });
  });
});
