import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LoginScreen } from "./LoginScreen";
import { AuthProvider } from "@/auth/AuthContext";
import { db } from "@/db/schema";
import { usersRepository } from "@/repositories";

beforeEach(async () => {
  await db.users.clear();
});

afterEach(async () => {
  await db.users.clear();
});

function renderLoginScreen() {
  return render(
    <AuthProvider>
      <LoginScreen />
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

  it("creates the first admin and logs in automatically", async () => {
    const user = userEvent.setup();
    renderLoginScreen();

    await screen.findByText(/premier lancement/i);
    await user.type(screen.getByLabelText(/nom d'utilisateur/i), "peter");
    await user.type(screen.getByLabelText(/nom affiché/i), "Peter");
    await user.type(screen.getByLabelText(/^mot de passe$/i), "secret123");
    await user.type(screen.getByLabelText(/confirmer le mot de passe/i), "secret123");
    await user.click(screen.getByRole("button", { name: /créer et se connecter/i }));

    // The password hash (PBKDF2, 150k iterations) genuinely takes a few
    // hundred ms — clicking submit does not itself wait for that, so the
    // test must poll rather than check once, or the assertion (and the
    // pending write) can leak into whichever test runs next.
    await waitFor(async () => {
      const created = await usersRepository.getByUsername("peter");
      expect(created?.role).toBe("admin");
    });
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
});
