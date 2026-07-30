import { afterEach, describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReportsPanel } from "./ReportsPanel";
import { db } from "@/db/schema";
import { clearActiveDek } from "@/lib/encryptionSession";
import { createTestUser, renderWithSession, renderAuthenticated } from "@/test/renderAuthenticated";
import { encryptedFixture } from "@/test/encryptedFixture";
import type { Transaction } from "@/types/models";

afterEach(async () => {
  await db.users.clear();
  await db.roleTemplates.clear();
  await db.accounts.clear();
  await db.transactions.clear();
  clearActiveDek();
});

describe("ReportsPanel", () => {
  it("shows a permission notice instead of the reports for a user without viewReports", async () => {
    const session = await createTestUser("viewer", { viewReports: false });
    renderWithSession(<ReportsPanel />, session);

    expect(await screen.findByText(/pas la permission/i)).toBeInTheDocument();
    expect(screen.queryByText(/rapport général/i)).not.toBeInTheDocument();
  });

  it("shows all three report sections for a user with viewReports", async () => {
    await renderAuthenticated(<ReportsPanel />);

    expect(await screen.findByRole("heading", { name: /rapport général/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /rapport par opérations/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /rapport de trésorerie/i })).toBeInTheDocument();
  });

  it("downloads the general report without error", async () => {
    const user = userEvent.setup();
    await renderAuthenticated(<ReportsPanel />);

    const heading = await screen.findByRole("heading", { name: /rapport général/i });
    const section = within(heading.closest("section")!);
    await user.click(section.getByRole("button", { name: /télécharger en pdf/i }));

    // absence of an alert confirms the download completed without throwing
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows an inline error when the operations report's date range is invalid", async () => {
    const user = userEvent.setup();
    await renderAuthenticated(<ReportsPanel />);

    await user.clear(screen.getByLabelText(/^du$/i));
    await user.type(screen.getByLabelText(/^du$/i), "2026-06-01");
    await user.clear(screen.getByLabelText(/^au$/i));
    await user.type(screen.getByLabelText(/^au$/i), "2026-01-01");

    const heading = await screen.findByRole("heading", { name: /rapport par opérations/i });
    const section = within(heading.closest("section")!);
    await user.click(section.getByRole("button", { name: /télécharger en pdf/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/doit précéder/i);
  });

  it("shows an inline error when the cash flow report's month range is invalid", async () => {
    const user = userEvent.setup();
    await renderAuthenticated(<ReportsPanel />);

    await user.clear(screen.getByLabelText(/du mois/i));
    await user.type(screen.getByLabelText(/du mois/i), "2026-06");
    await user.clear(screen.getByLabelText(/au mois/i));
    await user.type(screen.getByLabelText(/au mois/i), "2026-01");

    const heading = await screen.findByRole("heading", { name: /rapport de trésorerie/i });
    const section = within(heading.closest("section")!);
    await user.click(section.getByRole("button", { name: /télécharger en pdf/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/doit précéder/i);
  });

  describe("Rapport par opérations — filtre de type et aperçu", () => {
    async function seedAccountAndTransactions() {
      await db.accounts.add(
        await encryptedFixture(
          { id: "acc-1", name: "Compte", initialBalance: 0, createdAt: 1, updatedAt: 1 },
          ["name", "initialBalance"] as const,
        ),
      );
      await db.transactions.add(
        await encryptedFixture<Transaction, "label" | "amount" | "note">(
          {
            id: "tx-income",
            accountId: "acc-1",
            kind: "income",
            date: "2026-01-10",
            label: "Salaire",
            amount: 150000,
            createdAt: 1,
            updatedAt: 1,
          },
          ["label", "amount", "note"],
        ),
      );
      await db.transactions.add(
        await encryptedFixture<Transaction, "label" | "amount" | "note">(
          {
            id: "tx-expense",
            accountId: "acc-1",
            kind: "expense",
            date: "2026-01-15",
            label: "Alimentation",
            amount: 20000,
            createdAt: 1,
            updatedAt: 1,
          },
          ["label", "amount", "note"],
        ),
      );
    }

    it("shows a live preview of transactions matching the current period, before any download", async () => {
      const user = userEvent.setup();
      await renderAuthenticated(<ReportsPanel />);
      await seedAccountAndTransactions();

      await setDateRange(user);

      expect(await screen.findByRole("row", { name: /salaire/i })).toBeInTheDocument();
      expect(screen.getByRole("row", { name: /alimentation/i })).toBeInTheDocument();
    });

    it("restricts the preview to income only when that filter is selected", async () => {
      const user = userEvent.setup();
      await renderAuthenticated(<ReportsPanel />);
      await seedAccountAndTransactions();
      await setDateRange(user);
      await screen.findByRole("row", { name: /salaire/i });

      await user.selectOptions(screen.getByLabelText(/^type$/i), "income");

      expect(screen.getByRole("row", { name: /salaire/i })).toBeInTheDocument();
      expect(screen.queryByRole("row", { name: /alimentation/i })).not.toBeInTheDocument();
    });

    it("restricts the preview to expenses only when that filter is selected", async () => {
      const user = userEvent.setup();
      await renderAuthenticated(<ReportsPanel />);
      await seedAccountAndTransactions();
      await setDateRange(user);
      await screen.findByRole("row", { name: /salaire/i });

      await user.selectOptions(screen.getByLabelText(/^type$/i), "expense");

      expect(screen.getByRole("row", { name: /alimentation/i })).toBeInTheDocument();
      expect(screen.queryByRole("row", { name: /salaire/i })).not.toBeInTheDocument();
    });

    it("shows an empty message when nothing matches the period and type", async () => {
      const user = userEvent.setup();
      await renderAuthenticated(<ReportsPanel />);
      await setDateRange(user);

      expect(
        await screen.findByText(/aucune opération pour cette période et ce type/i),
      ).toBeInTheDocument();
    });

    async function setDateRange(user: ReturnType<typeof userEvent.setup>) {
      await user.clear(screen.getByLabelText(/^du$/i));
      await user.type(screen.getByLabelText(/^du$/i), "2026-01-01");
      await user.clear(screen.getByLabelText(/^au$/i));
      await user.type(screen.getByLabelText(/^au$/i), "2026-01-31");
    }
  });
});
