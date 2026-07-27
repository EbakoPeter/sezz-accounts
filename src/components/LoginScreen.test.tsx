import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LoginScreen } from "./LoginScreen";
import { AuthProvider, useAuth } from "@/auth/AuthContext";
import { db } from "@/db/schema";
import { setActiveDek, clearActiveDek } from "@/lib/encryptionSession";
import { generateDekBytes } from "@/lib/encryption";
import { usersRepository } from "@/repositories";
import { MAX_ATTEMPTS_BEFORE_LOCKOUT } from "@/lib/loginRateLimit";

beforeEach(async () => {
  await db.users.clear();
  await db.roleTemplates.clear();
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
    await user.type(screen.getByLabelText(/^mot de passe$/i), "wrong-password");
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
      await user.clear(screen.getByLabelText(/^mot de passe$/i));
      await user.type(screen.getByLabelText(/^mot de passe$/i), "wrong-password");
      await user.click(screen.getByRole("button", { name: /^se connecter$/i }));
      await screen.findByRole("alert");
    }

    await user.clear(screen.getByLabelText(/nom d'utilisateur/i));
    await user.type(screen.getByLabelText(/nom d'utilisateur/i), "peter");
    await user.clear(screen.getByLabelText(/^mot de passe$/i));
    await user.type(screen.getByLabelText(/^mot de passe$/i), "correct-password");
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

describe("LoginScreen — joining an existing household via sync", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 400): Response {
    return { ok, status, json: () => Promise.resolve(body) } as Response;
  }

  /** Builds a realistic synced user row — as if it came from another
   * device's push — without ever making that device's DEK active on
   * *this* one, matching what a genuine pull receives: encrypted content
   * this device cannot yet read. */
  async function buildSyncedUserRecord() {
    setActiveDek(generateDekBytes());
    const { user } = await usersRepository.create({
      username: "peter",
      displayName: "Peter",
      password: "secret123",
      role: "admin",
    });
    const row = await db.users.get(user.id);
    if (!row) throw new Error("Setup failed: row not found.");
    clearActiveDek();
    await db.users.delete(user.id); // this device never created it locally
    const { id, createdAt, updatedAt, _enc, ...structural } = row;
    return { tableName: "users" as const, id, createdAt, updatedAt, structural, encData: _enc };
  }

  it("shows a link to join an existing household on the first-run screen", async () => {
    renderLoginScreen();
    expect(
      await screen.findByRole("button", { name: /rejoindre un foyer existant/i }),
    ).toBeInTheDocument();
  });

  it("switches to the join form and back", async () => {
    const user = userEvent.setup();
    renderLoginScreen();

    await user.click(await screen.findByRole("button", { name: /rejoindre un foyer existant/i }));
    expect(screen.getByLabelText(/adresse du serveur/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^retour$/i }));
    expect(await screen.findByText(/premier lancement/i)).toBeInTheDocument();
  });

  it("logs into sync, pulls the existing household's data, and reveals the normal login form", async () => {
    const record = await buildSyncedUserRecord();
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("/auth/login")) {
        return Promise.resolve(jsonResponse({ token: "tok-1", syncAccountId: "acct-1" }));
      }
      return Promise.resolve(jsonResponse({ records: [record], serverTime: 2000 }));
    });

    const user = userEvent.setup();
    renderLoginScreen();
    await user.click(await screen.findByRole("button", { name: /rejoindre un foyer existant/i }));

    await user.type(screen.getByLabelText(/adresse du serveur/i), "https://sync.example.com");
    await user.type(
      screen.getByLabelText(/adresse e-mail \(compte de synchronisation\)/i),
      "family@example.com",
    );
    await user.type(
      screen.getByLabelText(/mot de passe \(compte de synchronisation\)/i),
      "sync-password-123",
    );
    await user.click(
      screen.getByRole("button", { name: /se connecter et récupérer les données/i }),
    );

    // the pulled-in "peter" user makes userCount go from 0 to 1, and the
    // component reacts on its own — no manual navigation needed
    expect(await screen.findByRole("button", { name: /^se connecter$/i })).toBeInTheDocument();
    expect(screen.queryByText(/premier lancement/i)).not.toBeInTheDocument();

    // and logging in as that pulled-in user actually works, proving the
    // shared DEK was received intact, not just the user's metadata
    await user.type(screen.getByLabelText(/nom d'utilisateur/i), "peter");
    await user.type(screen.getByLabelText(/mot de passe/i), "secret123");
    await user.click(screen.getByRole("button", { name: /^se connecter$/i }));
    expect(await screen.findByText(/connecté en tant que peter/i)).toBeInTheDocument();
  });

  it("shows the server's error message when the sync account login fails", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: "Adresse e-mail ou mot de passe incorrect." }, false, 401),
    );

    const user = userEvent.setup();
    renderLoginScreen();
    await user.click(await screen.findByRole("button", { name: /rejoindre un foyer existant/i }));
    await user.type(screen.getByLabelText(/adresse du serveur/i), "https://sync.example.com");
    await user.type(
      screen.getByLabelText(/adresse e-mail \(compte de synchronisation\)/i),
      "family@example.com",
    );
    await user.type(
      screen.getByLabelText(/mot de passe \(compte de synchronisation\)/i),
      "wrong-password",
    );
    await user.click(
      screen.getByRole("button", { name: /se connecter et récupérer les données/i }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(/incorrect/i);
    // still on the join form, first-run screen never created an admin
    expect(await usersRepository.count()).toBe(0);
  });

  it("warns when connected successfully but no data was received", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("/auth/login")) {
        return Promise.resolve(jsonResponse({ token: "tok-1", syncAccountId: "acct-1" }));
      }
      return Promise.resolve(jsonResponse({ records: [], serverTime: 2000 }));
    });

    const user = userEvent.setup();
    renderLoginScreen();
    await user.click(await screen.findByRole("button", { name: /rejoindre un foyer existant/i }));
    await user.type(screen.getByLabelText(/adresse du serveur/i), "https://sync.example.com");
    await user.type(
      screen.getByLabelText(/adresse e-mail \(compte de synchronisation\)/i),
      "family@example.com",
    );
    await user.type(
      screen.getByLabelText(/mot de passe \(compte de synchronisation\)/i),
      "sync-password-123",
    );
    await user.click(
      screen.getByRole("button", { name: /se connecter et récupérer les données/i }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(/aucune donnée/i);
  });
});
