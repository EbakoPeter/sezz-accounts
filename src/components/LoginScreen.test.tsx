import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LoginScreen } from "./LoginScreen";
import { AuthProvider, useAuth } from "@/auth/AuthContext";
import { db } from "@/db/schema";
import { clearActiveDek } from "@/lib/encryptionSession";
import { usersRepository } from "@/repositories";
import { MAX_ATTEMPTS_BEFORE_LOCKOUT } from "@/lib/loginRateLimit";

beforeEach(async () => {
  await db.users.clear();
});

afterEach(async () => {
  await db.users.clear();
  clearActiveDek();
});

/** Mirrors how App.tsx actually behaves: shows LoginScreen until someone is
 * authenticated, then shows a simple marker instead — lets tests verify
 * that a login actually completed, not just that no error was thrown. */
function TestHarness() {
  const { currentUser } = useAuth();
  if (currentUser) return <p>Connecté en tant que {currentUser.displayName}</p>;
  return <LoginScreen />;
}

function renderLoginScreen() {
  return render(
    <AuthProvider>
      <TestHarness />
    </AuthProvider>,
  );
}

describe("LoginScreen", () => {
  it("shows the first-run admin creation form when no users exist", async () => {
    renderLoginScreen();
    expect(await screen.findByText(/premier lancement/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^mot de passe$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/confirmer le mot de passe/i)).toBeInTheDocument();
  });

  it("creating the first admin shows a mandatory recovery code screen before logging in", async () => {
    const user = userEvent.setup();
    renderLoginScreen();

    await screen.findByText(/premier lancement/i);
    await user.type(screen.getByLabelText(/nom d'utilisateur/i), "peter");
    await user.type(screen.getByLabelText(/nom affiché/i), "Peter");
    await user.type(screen.getByLabelText(/^mot de passe$/i), "secret123");
    await user.type(screen.getByLabelText(/confirmer le mot de passe/i), "secret123");
    await user.click(screen.getByRole("button", { name: /créer et se connecter/i }));

    const codeElement = await screen.findByTestId("recovery-code");
    expect(codeElement.textContent).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    // not logged in yet — the harness would show the "Connecté" marker instead
    expect(screen.queryByText(/connecté en tant que/i)).not.toBeInTheDocument();

    const continueButton = screen.getByRole("button", { name: /continuer/i });
    expect(continueButton).toBeDisabled();
  });

  it("logs in only after the recovery code is acknowledged", async () => {
    const user = userEvent.setup();
    renderLoginScreen();

    await screen.findByText(/premier lancement/i);
    await user.type(screen.getByLabelText(/nom d'utilisateur/i), "peter");
    await user.type(screen.getByLabelText(/nom affiché/i), "Peter");
    await user.type(screen.getByLabelText(/^mot de passe$/i), "secret123");
    await user.type(screen.getByLabelText(/confirmer le mot de passe/i), "secret123");
    await user.click(screen.getByRole("button", { name: /créer et se connecter/i }));

    await screen.findByTestId("recovery-code");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: /continuer/i }));

    expect(await screen.findByText(/connecté en tant que peter/i)).toBeInTheDocument();
  });

  it("rejects mismatched password confirmation without creating a user", async () => {
    const user = userEvent.setup();
    renderLoginScreen();

    await screen.findByText(/premier lancement/i);
    await user.type(screen.getByLabelText(/nom d'utilisateur/i), "peter");
    await user.type(screen.getByLabelText(/^mot de passe$/i), "secret123");
    await user.type(screen.getByLabelText(/confirmer le mot de passe/i), "different");
    await user.click(screen.getByRole("button", { name: /créer et se connecter/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/ne correspondent pas/i);
    expect(await usersRepository.getByUsername("peter")).toBeUndefined();
  });

  it("shows a plain login form once a user already exists", async () => {
    await usersRepository.create({
      username: "peter",
      displayName: "Peter",
      password: "secret123",
      role: "admin",
    });

    renderLoginScreen();
    expect(await screen.findByRole("button", { name: /^se connecter$/i })).toBeInTheDocument();
    expect(screen.queryByText(/premier lancement/i)).not.toBeInTheDocument();
  });

  it("shows an error for an incorrect password", async () => {
    await usersRepository.create({
      username: "peter",
      displayName: "Peter",
      password: "correct-password",
      role: "admin",
    });

    const user = userEvent.setup();
    renderLoginScreen();

    await screen.findByRole("button", { name: /^se connecter$/i });
    await user.type(screen.getByLabelText(/nom d'utilisateur/i), "peter");
    await user.type(screen.getByLabelText(/mot de passe/i), "wrong-password");
    await user.click(screen.getByRole("button", { name: /^se connecter$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/incorrect/i);
  });

  it("shows a lockout message after too many failed attempts", async () => {
    await usersRepository.create({
      username: "peter",
      displayName: "Peter",
      password: "correct-password",
      role: "admin",
    });

    const user = userEvent.setup();
    renderLoginScreen();
    await screen.findByRole("button", { name: /^se connecter$/i });

    for (let i = 0; i < MAX_ATTEMPTS_BEFORE_LOCKOUT; i++) {
      await user.clear(screen.getByLabelText(/nom d'utilisateur/i));
      await user.type(screen.getByLabelText(/nom d'utilisateur/i), "peter");
      await user.clear(screen.getByLabelText(/mot de passe/i));
      await user.type(screen.getByLabelText(/mot de passe/i), "wrong-password");
      await user.click(screen.getByRole("button", { name: /^se connecter$/i }));
      await screen.findByRole("alert");
    }

    await user.clear(screen.getByLabelText(/nom d'utilisateur/i));
    await user.type(screen.getByLabelText(/nom d'utilisateur/i), "peter");
    await user.clear(screen.getByLabelText(/mot de passe/i));
    await user.type(screen.getByLabelText(/mot de passe/i), "correct-password");
    await user.click(screen.getByRole("button", { name: /^se connecter$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/trop de tentatives/i);
  });

  it("recovers access via the forgot-password flow and logs in with the new password", async () => {
    const { recoveryCode } = await usersRepository.create({
      username: "peter",
      displayName: "Peter",
      password: "forgotten-password",
      role: "admin",
    });

    const user = userEvent.setup();
    renderLoginScreen();

    await user.click(await screen.findByRole("button", { name: /mot de passe oublié/i }));
    await user.type(screen.getByLabelText(/nom d'utilisateur/i), "peter");
    await user.type(screen.getByLabelText(/code de récupération/i), recoveryCode);
    await user.type(screen.getByLabelText(/^nouveau mot de passe$/i), "brand-new-password");
    await user.type(
      screen.getByLabelText(/confirmer le nouveau mot de passe/i),
      "brand-new-password",
    );
    await user.click(screen.getByRole("button", { name: /réinitialiser et se connecter/i }));

    // a fresh, rotated recovery code must be shown before entering the app
    const newCodeElement = await screen.findByTestId("recovery-code");
    expect(newCodeElement.textContent).not.toBe(recoveryCode);
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: /continuer/i }));

    expect(await screen.findByText(/connecté en tant que peter/i)).toBeInTheDocument();
  });

  it("shows an error for an incorrect recovery code", async () => {
    await usersRepository.create({
      username: "peter",
      displayName: "Peter",
      password: "forgotten-password",
      role: "admin",
    });

    const user = userEvent.setup();
    renderLoginScreen();

    await user.click(await screen.findByRole("button", { name: /mot de passe oublié/i }));
    await user.type(screen.getByLabelText(/nom d'utilisateur/i), "peter");
    await user.type(screen.getByLabelText(/code de récupération/i), "WRONG-0000-0000-0000");
    await user.type(screen.getByLabelText(/^nouveau mot de passe$/i), "brand-new-password");
    await user.type(
      screen.getByLabelText(/confirmer le nouveau mot de passe/i),
      "brand-new-password",
    );
    await user.click(screen.getByRole("button", { name: /réinitialiser et se connecter/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/incorrect/i);
  });

  it("can return to the login form from the forgot-password form", async () => {
    await usersRepository.create({
      username: "peter",
      displayName: "Peter",
      password: "secret123",
      role: "admin",
    });

    const user = userEvent.setup();
    renderLoginScreen();

    await user.click(await screen.findByRole("button", { name: /mot de passe oublié/i }));
    await screen.findByLabelText(/code de récupération/i);
    await user.click(screen.getByRole("button", { name: /retour à la connexion/i }));

    expect(await screen.findByRole("button", { name: /^se connecter$/i })).toBeInTheDocument();
  });
});
