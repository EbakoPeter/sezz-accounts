import { afterEach, describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { AuthProvider } from "@/auth/AuthContext";
import { LanguageProvider } from "@/i18n/LanguageContext";
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
      <LanguageProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </LanguageProvider>,
    );
    expect(await screen.findByText(/premier lancement/i)).toBeInTheDocument();
  });

  it("shows the welcome screen by default, with the full tab list and no dropdown open", async () => {
    const session = await createTestUser("admin");
    renderWithSession(<App />, session);

    // The welcome screen itself — no tab is "selected" here, since it's
    // no longer one of the tabs at all
    expect(await screen.findByText(/bienvenue/i)).toBeInTheDocument();
    expect(screen.queryByRole("tab", { selected: true })).not.toBeInTheDocument();

    const tabs = await screen.findAllByRole("tab");
    expect(tabs.map((t) => t.getAttribute("aria-label"))).toEqual([
      "Comptes",
      "Budget",
      "Dépenses",
      "Revenus",
      "Dettes & Créances",
      "Rapports",
      "Recommandations",
      "Utilisateurs",
      "Synchronisation",
    ]);
    // every tab shows its full name always — no abbreviation
    expect(tabs[0]).toHaveTextContent("Comptes");
    expect(tabs[1]).toHaveTextContent("Budget");
    // no dropdown unfolded on first load — it only appears once a menu
    // with submenus is actually clicked
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("returns to the welcome screen when the SEZZ title is clicked, leaving whichever tab was active", async () => {
    const session = await createTestUser("admin");
    const user = userEvent.setup();
    renderWithSession(<App />, session);

    await user.click(await screen.findByRole("tab", { name: "Comptes" }));
    expect(screen.queryByText(/bienvenue/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /retour à l'accueil/i }));

    expect(await screen.findByText(/bienvenue/i)).toBeInTheDocument();
    expect(screen.queryByRole("tab", { selected: true })).not.toBeInTheDocument();
  });

  it("unfolds a dropdown of submenus when a menu is clicked, closed by default", async () => {
    const session = await createTestUser("admin");
    const user = userEvent.setup();
    renderWithSession(<App />, session);

    await screen.findByRole("tab", { name: /comptes/i });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /dettes & créances/i }));

    const dropdown = await screen.findByRole("menu");
    expect(within(dropdown).getByRole("menuitemradio", { name: "Dettes" })).toBeInTheDocument();
    expect(within(dropdown).getByRole("menuitemradio", { name: "Créances" })).toBeInTheDocument();
    // clicking the parent menu also navigates to its first submenu
    // immediately (now alphabetically first: Créances before Dettes),
    // same as before — the dropdown is an addition, not a replacement
    // for that behavior
    expect(screen.getByRole("heading", { name: "Créances" })).toBeInTheDocument();
  });

  it("closes the dropdown and switches content when a submenu item is clicked", async () => {
    const session = await createTestUser("admin");
    const user = userEvent.setup();
    renderWithSession(<App />, session);

    await screen.findByRole("tab", { name: /comptes/i });
    await user.click(screen.getByRole("tab", { name: /dettes & créances/i }));
    await screen.findByRole("menu");

    await user.click(screen.getByRole("menuitemradio", { name: "Dettes" }));

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Dettes" })).toBeInTheDocument();
  });

  it("toggles the dropdown shut when its own already-open menu is clicked again", async () => {
    const session = await createTestUser("admin");
    const user = userEvent.setup();
    renderWithSession(<App />, session);

    await screen.findByRole("tab", { name: /comptes/i });
    await user.click(screen.getByRole("tab", { name: /budget/i }));
    await screen.findByRole("menu");

    await user.click(screen.getByRole("tab", { name: /budget/i }));

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    // still on Budget's content (Engagements, alphabetically first among
    // its submenus) — only the dropdown closed, navigation did not change
    expect(screen.getByRole("heading", { name: "Engagement" })).toBeInTheDocument();
  });

  it("shows a menu's full name at all times, active or not — no abbreviation", async () => {
    const session = await createTestUser("admin");
    const user = userEvent.setup();
    renderWithSession(<App />, session);

    const debtsTab = await screen.findByRole("tab", { name: "Dettes & Créances" });
    expect(debtsTab).toHaveTextContent("Dettes & Créances");

    await user.click(debtsTab);
    expect(debtsTab).toHaveTextContent("Dettes & Créances");

    // switching away still shows the full name, not an abbreviation
    await user.click(screen.getByRole("tab", { name: "Comptes" }));
    expect(debtsTab).toHaveTextContent("Dettes & Créances");
  });

  it("switches which menu's dropdown is open when a different menu is clicked", async () => {
    const session = await createTestUser("admin");
    const user = userEvent.setup();
    renderWithSession(<App />, session);

    await screen.findByRole("tab", { name: /comptes/i });
    await user.click(screen.getByRole("tab", { name: /comptes/i }));
    let dropdown = await screen.findByRole("menu");
    expect(within(dropdown).getByRole("menuitemradio", { name: "Listing" })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /budget/i }));

    dropdown = await screen.findByRole("menu");
    expect(
      within(dropdown).getByRole("menuitemradio", { name: "Engagements" }),
    ).toBeInTheDocument();
    expect(
      within(dropdown).queryByRole("menuitemradio", { name: "Listing" }),
    ).not.toBeInTheDocument();
  });

  it("closes the dropdown when tapping outside it", async () => {
    const session = await createTestUser("admin");
    const user = userEvent.setup();
    renderWithSession(<App />, session);

    await screen.findByRole("tab", { name: /comptes/i });
    await user.click(screen.getByRole("tab", { name: /comptes/i }));
    await screen.findByRole("menu");

    await user.click(screen.getByRole("tabpanel"));

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("shows Rapport Mensuel as the Mensuel submenu under Rapports, not its own top-level tab", async () => {
    const session = await createTestUser("admin");
    const user = userEvent.setup();
    renderWithSession(<App />, session);

    await screen.findByRole("tab", { name: /comptes/i });
    expect(screen.queryByRole("tab", { name: /rapport mensuel/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /^rapports$/i }));

    const dropdown = await screen.findByRole("menu");
    expect(within(dropdown).getByRole("menuitemradio", { name: "Mensuel" })).toBeInTheDocument();
    expect(within(dropdown).getByRole("menuitemradio", { name: "Général" })).toBeInTheDocument();
    expect(
      within(dropdown).getByRole("menuitemradio", { name: "Personnalisé" }),
    ).toBeInTheDocument();
    expect(within(dropdown).getByRole("menuitemradio", { name: "Trésorerie" })).toBeInTheDocument();
  });

  it("hides the Utilisateurs and Synchronisation menus for a user without manageUsers", async () => {
    const session = await createTestUser("viewer");
    renderWithSession(<App />, session);

    await screen.findByRole("tab", { name: /comptes/i });
    expect(screen.queryByRole("tab", { name: /utilisateurs/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /synchronisation/i })).not.toBeInTheDocument();
  });

  it("hides the Rapports and Recommandations menus for a user without viewReports", async () => {
    const session = await createTestUser("viewer", { viewReports: false });
    renderWithSession(<App />, session);

    await screen.findByRole("tab", { name: /comptes/i });
    expect(screen.queryByRole("tab", { name: /^rapports$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /recommandations/i })).not.toBeInTheDocument();
  });

  it("logs out via the session button and returns to the login screen", async () => {
    const session = await createTestUser("admin");
    const user = userEvent.setup();
    renderWithSession(<App />, session);

    await screen.findByRole("tab", { name: /comptes/i });
    await user.click(screen.getByRole("button", { name: /se déconnecter/i }));

    expect(await screen.findByRole("button", { name: /^se connecter$/i })).toBeInTheDocument();
  });

  it("shows the welcome screen again on a fresh login, even after leaving it before logging out", async () => {
    const session = await createTestUser("admin");
    const user = userEvent.setup();
    renderWithSession(<App />, session);

    // Navigate away from the welcome screen, then log out
    await user.click(await screen.findByRole("tab", { name: "Comptes" }));
    expect(screen.queryByText(/bienvenue/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /se déconnecter/i }));
    await screen.findByRole("button", { name: /^se connecter$/i });

    // Log back in as the same user, within the same rendered App instance
    // — showingWelcome is component state that would otherwise still
    // hold "false" from before logout if nothing reset it
    await user.type(screen.getByLabelText(/nom d'utilisateur/i), session.user.username);
    await user.type(screen.getByLabelText(/mot de passe/i), "test-password-123");
    await user.click(screen.getByRole("button", { name: /^se connecter$/i }));

    expect(await screen.findByText(/bienvenue/i)).toBeInTheDocument();
  });

  it("switches the whole interface's language via the picker, immediately and without a page reload", async () => {
    const session = await createTestUser("admin");
    const user = userEvent.setup();
    renderWithSession(<App />, session);

    expect(await screen.findByRole("tab", { name: "Comptes" })).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText(/langue|language/i), "en");

    expect(await screen.findByRole("tab", { name: "Accounts" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /log out/i })).toBeInTheDocument();
  });
});
