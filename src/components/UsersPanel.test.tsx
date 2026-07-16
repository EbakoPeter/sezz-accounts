import { afterEach, describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UsersPanel } from "./UsersPanel";
import { AuthProvider } from "@/auth/AuthContext";
import { db } from "@/db/schema";
import { clearActiveDek } from "@/lib/encryptionSession";
import { usersRepository } from "@/repositories";
import { renderAuthenticated } from "@/test/renderAuthenticated";

afterEach(async () => {
  await db.users.clear();
  clearActiveDek();
});

async function renderAsAdminAndReturnUser() {
  const utils = await renderAuthenticated(<UsersPanel />, { role: "admin" });
  return { ...utils, ...utils.user };
}

describe("UsersPanel", () => {
  it("shows a permission notice instead of the panel for a user without manageUsers", async () => {
    await renderAuthenticated(<UsersPanel />, { role: "standard" });
    expect(
      await screen.findByText(/pas la permission de gérer les utilisateurs/i),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/nom d'utilisateur/i)).not.toBeInTheDocument();
  });

  it("lists the current admin for a user with manageUsers", async () => {
    const admin = await renderAsAdminAndReturnUser();
    const matches = await screen.findAllByText(new RegExp(admin.displayName));
    expect(matches.length).toBeGreaterThan(0);
  });

  it("creates a new user through the form", async () => {
    await renderAsAdminAndReturnUser();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/nom d'utilisateur/i), "newuser");
    await user.type(screen.getByLabelText(/nom affiché/i), "New User");
    await user.type(screen.getByLabelText(/^mot de passe$/i), "password123");
    await user.click(screen.getByRole("button", { name: /\+ ajouter/i }));

    expect(await screen.findByText("New User")).toBeInTheDocument();
  });

  it("refuses to strip manageUsers from the sole remaining admin via the role selector", async () => {
    // Deliberately not using renderAuthenticated()'s bootstrap-admin
    // avoidance here: this test needs a scenario with exactly one admin
    // overall, which is exactly what creating a single user in an empty
    // table produces (the repository's "first user is always admin" rule).
    const soleAdmin = await usersRepository.create({
      username: "solo-admin",
      displayName: "Solo Admin",
      password: "password123",
      role: "viewer", // ignored — forced to admin as the first-ever user
    });
    render(
      <AuthProvider initialUser={soleAdmin}>
        <UsersPanel />
      </AuthProvider>,
    );
    const user = userEvent.setup();

    const roleSelect = await screen.findByLabelText(/rôle de/i);
    await user.selectOptions(roleSelect, "viewer");

    expect(await screen.findByRole("alert")).toHaveTextContent(/au moins un utilisateur/i);
  });

  it("edits individual permissions independently of the role preset", async () => {
    await renderAsAdminAndReturnUser();
    const user = userEvent.setup();

    // a second (standard) user gives us a safe, non-admin row to toggle
    await usersRepository.create({
      username: "standarduser",
      displayName: "Standard User",
      password: "password123",
      role: "standard",
    });

    const standardRow = (await screen.findByText("Standard User")).closest("tr")!;
    await user.click(within(standardRow).getByRole("button", { name: /modifier les privilèges/i }));

    const debtsCheckbox = screen.getByLabelText(/gérer les dettes et créances/i);
    expect(debtsCheckbox).toBeChecked();
    await user.click(debtsCheckbox);
    await user.click(screen.getByRole("button", { name: /enregistrer/i }));

    await waitFor(async () => {
      const updated = await usersRepository.getByUsername("standarduser");
      expect(updated?.permissions.manageDebts).toBe(false);
      expect(updated?.permissions.manageTransactions).toBe(true);
    });
  });

  it("does not allow deleting yourself", async () => {
    await renderAsAdminAndReturnUser();
    expect(screen.queryByRole("button", { name: /^supprimer$/i })).not.toBeInTheDocument();
  });
});
