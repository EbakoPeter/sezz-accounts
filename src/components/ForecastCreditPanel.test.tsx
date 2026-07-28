import { afterEach, describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ForecastCreditPanel } from "./ForecastCreditPanel";
import { db } from "@/db/schema";
import { clearActiveDek } from "@/lib/encryptionSession";
import { createTestUser, renderWithSession, renderAuthenticated } from "@/test/renderAuthenticated";

afterEach(async () => {
  await db.users.clear();
  await db.roleTemplates.clear();
  await db.accounts.clear();
  await db.transactions.clear();
  clearActiveDek();
});

describe("ForecastCreditPanel", () => {
  it("shows the form with source, amount, and date fields", async () => {
    await renderAuthenticated(<ForecastCreditPanel />);

    expect(await screen.findByLabelText(/source/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/montant/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/date/i)).toBeInTheDocument();
  });

  it("shows an empty message when no credit has ever been recorded", async () => {
    await renderAuthenticated(<ForecastCreditPanel />);

    expect(await screen.findByText(/aucun crédit prévisionnel enregistré/i)).toBeInTheDocument();
  });

  it("credits the forecast account and shows the entry in the history table", async () => {
    const user = userEvent.setup();
    await renderAuthenticated(<ForecastCreditPanel />);

    await user.type(screen.getByLabelText(/source/i), "Salaire");
    await user.type(screen.getByLabelText(/montant/i), "150000");
    await user.click(screen.getByRole("button", { name: /créditer/i }));

    const row = await screen.findByRole("row", { name: /salaire/i });
    expect(within(row).getByText(/150 000/)).toBeInTheDocument();
  });

  it("clears the form after a successful credit", async () => {
    const user = userEvent.setup();
    await renderAuthenticated(<ForecastCreditPanel />);

    await user.type(screen.getByLabelText(/source/i), "Salaire");
    await user.type(screen.getByLabelText(/montant/i), "150000");
    await user.click(screen.getByRole("button", { name: /créditer/i }));

    await screen.findByRole("row", { name: /salaire/i });
    expect(screen.getByLabelText(/source/i)).toHaveValue("");
    expect(screen.getByLabelText(/montant/i)).toHaveValue(null);
  });

  it("shows a validation error for a non-positive amount, without crediting anything", async () => {
    const user = userEvent.setup();
    await renderAuthenticated(<ForecastCreditPanel />);

    await user.type(screen.getByLabelText(/source/i), "Salaire");
    await user.type(screen.getByLabelText(/montant/i), "0");
    await user.click(screen.getByRole("button", { name: /créditer/i }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/aucun crédit prévisionnel enregistré/i)).toBeInTheDocument();
  });

  it("accumulates multiple credits without creating a duplicate forecast account", async () => {
    const user = userEvent.setup();
    await renderAuthenticated(<ForecastCreditPanel />);

    await user.type(screen.getByLabelText(/source/i), "Salaire");
    await user.type(screen.getByLabelText(/montant/i), "100000");
    await user.click(screen.getByRole("button", { name: /créditer/i }));
    await screen.findByRole("row", { name: /salaire/i });

    await user.type(screen.getByLabelText(/source/i), "Prime");
    await user.type(screen.getByLabelText(/montant/i), "20000");
    await user.click(screen.getByRole("button", { name: /créditer/i }));

    await screen.findByRole("row", { name: /prime/i });
    expect(screen.getByRole("row", { name: /salaire/i })).toBeInTheDocument();
    const forecastAccounts = (await db.accounts.toArray()).length;
    expect(forecastAccounts).toBe(1);
  });

  it("hides the form (but not existing history) for a user without manageTransactions", async () => {
    const session = await createTestUser("viewer");
    renderWithSession(<ForecastCreditPanel />, session);

    expect(
      await screen.findByText(/pas la permission d'enregistrer des opérations/i),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/source/i)).not.toBeInTheDocument();
  });
});
