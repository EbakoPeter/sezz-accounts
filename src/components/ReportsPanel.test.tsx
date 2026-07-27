import { afterEach, describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReportsPanel } from "./ReportsPanel";
import { db } from "@/db/schema";
import { clearActiveDek } from "@/lib/encryptionSession";
import { createTestUser, renderWithSession, renderAuthenticated } from "@/test/renderAuthenticated";

afterEach(async () => {
  await db.users.clear();
  await db.roleTemplates.clear();
  await db.accounts.clear();
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
});
