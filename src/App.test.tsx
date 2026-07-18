import { afterEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { AuthProvider } from "@/auth/AuthContext";
import { db } from "@/db/schema";
import { clearActiveDek } from "@/lib/encryptionSession";
import { renderWithSession, createTestUser } from "@/test/renderAuthenticated";

afterEach(async () => {
  await db.users.clear();
  clearActiveDek();
});

describe("App tab navigation", () => {
  it("shows the login screen when nobody is signed in", async () => {
    render(
      <AuthProvider>
        <App />
      </AuthProvider>,
    );
    expect(await screen.findByText(/premier lancement/i)).toBeInTheDocument();
  });

  it("defaults to the Comptes tab for an admin", async () => {
    const session = await createTestUser("admin");
    renderWithSession(<App />, session);

    const tabs = await screen.findAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual([
      "Comptes",
      "Opérations",
      "Budget Prévisionnel",
      "Dettes & Créances",
      "Rapport Mensuel",
      "Recommandations",
      "Utilisateurs",
    ]);
    expect(screen.getByRole("tab", { name: "Comptes" })).toHaveAttribute("aria-selected", "true");
  });

  it("switches the visible panel when a different tab is clicked", async () => {
    const session = await createTestUser("admin");
    const user = userEvent.setup();
    renderWithSession(<App />, session);

    await screen.findByRole("tab", { name: "Comptes" });
    expect(screen.getByRole("heading", { name: "Comptes" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Dettes & Créances" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Dettes & Créances" }));

    expect(screen.getByRole("heading", { name: "Dettes & Créances" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Comptes" })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Dettes & Créances" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("hides the Utilisateurs tab for a user without manageUsers", async () => {
    const session = await createTestUser("viewer");
    renderWithSession(<App />, session);

    await screen.findByRole("tab", { name: "Comptes" });
    expect(screen.queryByRole("tab", { name: "Utilisateurs" })).not.toBeInTheDocument();
  });

  it("hides the report tabs for a user without viewReports", async () => {
    const session = await createTestUser("viewer", { viewReports: false });
    renderWithSession(<App />, session);

    await screen.findByRole("tab", { name: "Comptes" });
    expect(screen.queryByRole("tab", { name: "Rapport Mensuel" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Recommandations" })).not.toBeInTheDocument();
  });

  it("logs out via the session button and returns to the login screen", async () => {
    const session = await createTestUser("admin");
    const user = userEvent.setup();
    renderWithSession(<App />, session);

    await screen.findByRole("tab", { name: "Comptes" });
    await user.click(screen.getByRole("button", { name: /se déconnecter/i }));

    expect(await screen.findByRole("button", { name: /^se connecter$/i })).toBeInTheDocument();
  });
});
