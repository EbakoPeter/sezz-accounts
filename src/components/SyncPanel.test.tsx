import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SyncPanel } from "./SyncPanel";
import { db } from "@/db/schema";
import { clearActiveDek } from "@/lib/encryptionSession";
import { renderAuthenticated } from "@/test/renderAuthenticated";

let fetchMock: ReturnType<typeof vi.fn>;

afterEach(async () => {
  await db.users.clear();
  await db.syncConfig.clear();
  clearActiveDek();
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 400): Response {
  return { ok, status, json: () => Promise.resolve(body) } as Response;
}

function mockFetch() {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("SyncPanel", () => {
  it("shows the connection form when no sync session exists", async () => {
    await renderAuthenticated(<SyncPanel />);
    expect(await screen.findByLabelText(/adresse du serveur/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /créer le compte de synchronisation/i }),
    ).toBeInTheDocument();
  });

  it("registers a sync account and then shows the connected state", async () => {
    mockFetch().mockResolvedValue(jsonResponse({ token: "tok-1", syncAccountId: "acct-1" }));
    const user = userEvent.setup();
    await renderAuthenticated(<SyncPanel />);

    await user.type(
      await screen.findByLabelText(/adresse du serveur/i),
      "https://sync.example.com",
    );
    await user.type(screen.getByLabelText(/adresse e-mail/i), "peter@example.com");
    await user.type(screen.getByLabelText(/^mot de passe$/i), "password123");
    await user.click(screen.getByRole("button", { name: /créer le compte de synchronisation/i }));

    expect(await screen.findByText(/connecté à/i)).toBeInTheDocument();
    expect(screen.getByText("https://sync.example.com")).toBeInTheDocument();
  });

  it("switches to the login form and logs in with an existing sync account", async () => {
    mockFetch().mockResolvedValue(jsonResponse({ token: "tok-1", syncAccountId: "acct-1" }));
    const user = userEvent.setup();
    await renderAuthenticated(<SyncPanel />);

    await user.click(
      await screen.findByRole("button", { name: /j'ai déjà un compte de synchronisation/i }),
    );
    expect(screen.getByRole("button", { name: /^se connecter$/i })).toBeInTheDocument();

    await user.type(
      await screen.findByLabelText(/adresse du serveur/i),
      "https://sync.example.com",
    );
    await user.type(screen.getByLabelText(/adresse e-mail/i), "peter@example.com");
    await user.type(screen.getByLabelText(/^mot de passe$/i), "password123");
    await user.click(screen.getByRole("button", { name: /^se connecter$/i }));

    expect(await screen.findByText(/connecté à/i)).toBeInTheDocument();
  });

  it("shows an inline error when the server rejects the connection attempt", async () => {
    mockFetch().mockResolvedValue(
      jsonResponse({ error: "Un compte existe déjà avec cette adresse e-mail." }, false, 409),
    );
    const user = userEvent.setup();
    await renderAuthenticated(<SyncPanel />);

    await user.type(
      await screen.findByLabelText(/adresse du serveur/i),
      "https://sync.example.com",
    );
    await user.type(screen.getByLabelText(/adresse e-mail/i), "peter@example.com");
    await user.type(screen.getByLabelText(/^mot de passe$/i), "password123");
    await user.click(screen.getByRole("button", { name: /créer le compte de synchronisation/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/existe déjà/i);
  });

  it("triggers a sync and shows the result summary", async () => {
    const fetch = mockFetch();
    fetch.mockResolvedValueOnce(jsonResponse({ token: "tok-1", syncAccountId: "acct-1" }));
    const user = userEvent.setup();
    await renderAuthenticated(<SyncPanel />);

    await user.type(
      await screen.findByLabelText(/adresse du serveur/i),
      "https://sync.example.com",
    );
    await user.type(screen.getByLabelText(/adresse e-mail/i), "peter@example.com");
    await user.type(screen.getByLabelText(/^mot de passe$/i), "password123");
    await user.click(screen.getByRole("button", { name: /créer le compte de synchronisation/i }));
    await screen.findByText(/connecté à/i);

    fetch.mockResolvedValueOnce(jsonResponse({ accepted: 0, serverTime: 1000 })); // push
    fetch.mockResolvedValueOnce(jsonResponse({ records: [], serverTime: 2000 })); // pull
    await user.click(screen.getByRole("button", { name: /synchroniser maintenant/i }));

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(/élément\(s\) envoyé/i);
    expect(status).toHaveTextContent(/0 reçu/i);
  });

  it("shows an inline error when a sync attempt fails", async () => {
    const fetch = mockFetch();
    fetch.mockResolvedValueOnce(jsonResponse({ token: "tok-1", syncAccountId: "acct-1" }));
    const user = userEvent.setup();
    await renderAuthenticated(<SyncPanel />);

    await user.type(
      await screen.findByLabelText(/adresse du serveur/i),
      "https://sync.example.com",
    );
    await user.type(screen.getByLabelText(/adresse e-mail/i), "peter@example.com");
    await user.type(screen.getByLabelText(/^mot de passe$/i), "password123");
    await user.click(screen.getByRole("button", { name: /créer le compte de synchronisation/i }));
    await screen.findByText(/connecté à/i);

    fetch.mockResolvedValueOnce(
      jsonResponse({ error: "Session invalide ou expirée." }, false, 401),
    );
    await user.click(screen.getByRole("button", { name: /synchroniser maintenant/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/session invalide/i);
  });

  it("disconnects and shows the connection form again", async () => {
    mockFetch().mockResolvedValue(jsonResponse({ token: "tok-1", syncAccountId: "acct-1" }));
    const user = userEvent.setup();
    await renderAuthenticated(<SyncPanel />);

    await user.type(
      await screen.findByLabelText(/adresse du serveur/i),
      "https://sync.example.com",
    );
    await user.type(screen.getByLabelText(/adresse e-mail/i), "peter@example.com");
    await user.type(screen.getByLabelText(/^mot de passe$/i), "password123");
    await user.click(screen.getByRole("button", { name: /créer le compte de synchronisation/i }));
    await screen.findByText(/connecté à/i);

    await user.click(screen.getByRole("button", { name: /se déconnecter de la synchronisation/i }));

    await waitFor(() => {
      expect(screen.getByLabelText(/adresse du serveur/i)).toBeInTheDocument();
    });
  });

  it("reflects a sync status written from outside the component (e.g. by automatic background sync)", async () => {
    mockFetch().mockResolvedValue(jsonResponse({ token: "tok-1", syncAccountId: "acct-1" }));
    const user = userEvent.setup();
    await renderAuthenticated(<SyncPanel />);

    await user.type(
      await screen.findByLabelText(/adresse du serveur/i),
      "https://sync.example.com",
    );
    await user.type(screen.getByLabelText(/adresse e-mail/i), "peter@example.com");
    await user.type(screen.getByLabelText(/^mot de passe$/i), "password123");
    await user.click(screen.getByRole("button", { name: /créer le compte de synchronisation/i }));
    await screen.findByText(/connecté à/i);

    await db.syncConfig.put({
      key: "lastSyncStatus",
      value: JSON.stringify({
        attemptedAt: Date.now(),
        success: true,
        pushed: 3,
        pulled: 1,
        deleted: 0,
      }),
    });

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(/3 élément\(s\) envoyé/i);
    expect(status).toHaveTextContent(/1 reçu/i);
  });
});
