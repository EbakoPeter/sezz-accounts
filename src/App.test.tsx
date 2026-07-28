import { afterEach, describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
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

  it("defaults to the Accueil menu (dashboard), with no dropdown open", async () => {
    const session = await createTestUser("admin");
    renderWithSession(<App />, session);

    const tabs = await screen.findAllByRole("tab");
    expect(tabs.map((t) => t.getAttribute("aria-label"))).toEqual([
      "Accueil",
      "Comptes",
      "Opérations",
      "Budget",
      "Dettes & Créances",
      "Rapports",
      "Recommandations",
      "Utilisateurs",
      "Synchronisation",
    ]);
    // the active tab shows its full name even visually — only the
    // inactive ones are abbreviated
    expect(tabs[0]).toHaveTextContent("Accueil");
    expect(tabs[1]).toHaveTextContent("CPTS");
    expect(screen.getByRole("tab", { name: /accueil/i })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { name: "Accueil" })).toBeInTheDocument();
    // no dropdown unfolded on first load — it only appears once a menu
    // with submenus is actually clicked
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
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
    // still on Budget's content — only the dropdown closed, navigation
    // did not change
    expect(screen.getByRole("heading", { name: "Budget Prévisionnel" })).toBeInTheDocument();
  });

  it("shows a menu's abbreviation while inactive, and its full name once it becomes active", async () => {
    const session = await createTestUser("admin");
    const user = userEvent.setup();
    renderWithSession(<App />, session);

    const debtsTab = await screen.findByRole("tab", { name: "Dettes & Créances" });
    expect(debtsTab).toHaveTextContent("D&C");
    expect(debtsTab).not.toHaveTextContent("Dettes & Créances");

    await user.click(debtsTab);

    expect(debtsTab).toHaveTextContent("Dettes & Créances");
    // switching away abbreviates it again
    await user.click(screen.getByRole("tab", { name: "Comptes" }));
    expect(debtsTab).toHaveTextContent("D&C");
    expect(debtsTab).not.toHaveTextContent("Dettes & Créances");
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
});
