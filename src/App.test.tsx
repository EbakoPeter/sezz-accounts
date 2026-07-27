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
  await db.roleTemplates.clear();
  clearActiveDek();
});

describe("App menu navigation", () => {
  it("shows the login screen when nobody is signed in", async () => {
    render(
      <AuthProvider>
        <App />
      </AuthProvider>,
    );
    expect(await screen.findByText(/premier lancement/i)).toBeInTheDocument();
  });

  it("defaults to the Comptes menu, Nouveau Compte submenu, for an admin", async () => {
    const session = await createTestUser("admin");
    renderWithSession(<App />, session);

    const tabs = await screen.findAllByRole("tab");
    // The top-level menu row and the submenu row both use role="tab" —
    // this asserts on the combined sequence a screen reader/keyboard user
    // would actually encounter, top-level menus first, then whichever
    // menu's submenus are currently showing.
    expect(tabs.map((t) => t.textContent)).toEqual([
      "Comptes",
      "Opérations",
      "Budget",
      "Dettes & Créances",
      "Rapports",
      "Recommandations",
      "Utilisateurs",
      "Synchronisation",
      "Nouveau Compte",
      "Listing",
    ]);
    expect(screen.getByRole("tab", { name: "Comptes" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Nouveau Compte" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("switches both content and submenus when a different top-level menu is clicked", async () => {
    const session = await createTestUser("admin");
    const user = userEvent.setup();
    renderWithSession(<App />, session);

    await screen.findByRole("tab", { name: "Comptes" });
    expect(screen.getByRole("heading", { name: "Comptes" })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Dettes & Créances" }));

    // Dettes & Créances' own submenus (Dettes/Créances) replace
    // Comptes' (Nouveau Compte/Listing) entirely, not alongside them.
    expect(screen.getByRole("tab", { name: "Dettes & Créances" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(await screen.findByRole("tab", { name: "Dettes" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Créances" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Nouveau Compte" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Dettes" })).toBeInTheDocument();
  });

  it("switches content when a submenu is clicked, without changing the top-level menu", async () => {
    const session = await createTestUser("admin");
    const user = userEvent.setup();
    renderWithSession(<App />, session);

    await screen.findByRole("tab", { name: "Comptes" });
    await user.click(screen.getByRole("tab", { name: "Listing" }));

    expect(screen.getByRole("tab", { name: "Comptes" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Listing" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { name: "Comptes" })).toBeInTheDocument();
  });

  it("shows Rapport Mensuel as the Mensuel submenu under Rapports, not its own top-level tab", async () => {
    const session = await createTestUser("admin");
    const user = userEvent.setup();
    renderWithSession(<App />, session);

    await screen.findByRole("tab", { name: "Comptes" });
    expect(screen.queryByRole("tab", { name: "Rapport Mensuel" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Rapports" }));

    expect(await screen.findByRole("tab", { name: "Mensuel" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Général" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Personnalisé" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Trésorerie" })).toBeInTheDocument();
  });

  it("hides the Utilisateurs and Synchronisation menus for a user without manageUsers", async () => {
    const session = await createTestUser("viewer");
    renderWithSession(<App />, session);

    await screen.findByRole("tab", { name: "Comptes" });
    expect(screen.queryByRole("tab", { name: "Utilisateurs" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Synchronisation" })).not.toBeInTheDocument();
  });

  it("hides the Rapports and Recommandations menus for a user without viewReports", async () => {
    const session = await createTestUser("viewer", { viewReports: false });
    renderWithSession(<App />, session);

    await screen.findByRole("tab", { name: "Comptes" });
    expect(screen.queryByRole("tab", { name: "Rapports" })).not.toBeInTheDocument();
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
