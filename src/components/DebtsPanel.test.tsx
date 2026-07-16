import { afterEach, describe, expect, it } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
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
});
