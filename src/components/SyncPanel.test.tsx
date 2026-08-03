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
  await db.roleTemplates.clear();
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

    fetch.mockResolvedValueOnce(jsonResponse({ totalRecords: 0, latestUpdatedAt: 0 })); // summary
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

  it("shows a clear subscription-required message, distinct from a generic sync failure, on a 402 response", async () => {
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
      jsonResponse(
        {
          error: "La synchronisation nécessite un abonnement actif.",
          subscriptionStatus: "expired",
        },
        false,
        402,
      ),
    );
    await user.click(screen.getByRole("button", { name: /synchroniser maintenant/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/abonnement actif/i);
    expect(alert).toHaveTextContent(/restent utilisables normalement sur cet appareil/i);
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

  it("shows the backup section even with no sync session configured", async () => {
    await renderAuthenticated(<SyncPanel />);

    expect(
      await screen.findByRole("button", { name: /télécharger une sauvegarde/i }),
    ).toBeInTheDocument();
    expect(await screen.findByLabelText(/fichier de sauvegarde/i)).toBeInTheDocument();
  });

  it("downloads a backup when the button is clicked", async () => {
    const user = userEvent.setup();
    const createObjectURL = vi.fn().mockReturnValue("blob:mock-url");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
    // jsdom doesn't implement the special "download" attribute behavior a
    // real browser gives an <a> click — without this, it tries to
    // actually navigate to the blob: URL and logs a "not implemented"
    // error, which is noise, not a real failure, but worth silencing.
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await renderAuthenticated(<SyncPanel />);

    await user.click(await screen.findByRole("button", { name: /télécharger une sauvegarde/i }));

    await waitFor(() => {
      expect(createObjectURL).toHaveBeenCalledTimes(1);
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
    });
    clickSpy.mockRestore();
  });

  it("shows an error and does not offer to restore when the chosen file isn't a valid backup", async () => {
    const user = userEvent.setup();
    await renderAuthenticated(<SyncPanel />);

    const file = new File(["not valid json{{{"], "bad.json", { type: "application/json" });
    await user.upload(await screen.findByLabelText(/fichier de sauvegarde/i), file);

    expect(await screen.findByRole("alert")).toHaveTextContent(/pas une sauvegarde/i);
    expect(
      screen.queryByRole("button", { name: /restaurer cette sauvegarde/i }),
    ).not.toBeInTheDocument();
  });

  it("shows a summary and a restore button once a valid backup file is chosen", async () => {
    const user = userEvent.setup();
    await renderAuthenticated(<SyncPanel />);

    const content = JSON.stringify({
      version: 1,
      exportedAt: new Date("2026-01-15T10:00:00Z").getTime(),
      tables: { accounts: [{ id: "acc-1" }], transactions: [{ id: "tx-1" }] },
    });
    const file = new File([content], "backup.json", { type: "application/json" });
    await user.upload(await screen.findByLabelText(/fichier de sauvegarde/i), file);

    const notice = await screen.findByRole("status");
    expect(notice).toHaveTextContent(/2 enregistrement/i);
    expect(screen.getByRole("button", { name: /restaurer cette sauvegarde/i })).toBeInTheDocument();
  });

  it("does not restore when the confirmation dialog is cancelled", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = userEvent.setup();
    await renderAuthenticated(<SyncPanel />);

    const content = JSON.stringify({ version: 1, exportedAt: 1000, tables: { accounts: [] } });
    const file = new File([content], "backup.json", { type: "application/json" });
    await user.upload(await screen.findByLabelText(/fichier de sauvegarde/i), file);
    await user.click(await screen.findByRole("button", { name: /restaurer cette sauvegarde/i }));

    expect(window.confirm).toHaveBeenCalledTimes(1);
    // still showing the pending restore, nothing applied yet
    expect(screen.getByRole("button", { name: /restaurer cette sauvegarde/i })).toBeInTheDocument();
  });

  it("restores and reloads the app once confirmed", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    const user = userEvent.setup();
    await renderAuthenticated(<SyncPanel />);

    await db.accounts.put({
      id: "acc-existing",
      createdAt: 1000,
      updatedAt: 1000,
      _enc: { iv: "iv", data: "old" },
    });
    const content = JSON.stringify({
      version: 1,
      exportedAt: 1000,
      tables: {
        accounts: [
          { id: "acc-restored", createdAt: 1000, updatedAt: 1000, _enc: { iv: "iv", data: "d" } },
        ],
      },
    });
    const file = new File([content], "backup.json", { type: "application/json" });
    await user.upload(await screen.findByLabelText(/fichier de sauvegarde/i), file);
    await user.click(await screen.findByRole("button", { name: /restaurer cette sauvegarde/i }));

    await waitFor(async () => {
      expect(await db.accounts.get("acc-existing")).toBeUndefined();
      expect(await db.accounts.get("acc-restored")).toBeDefined();
    });
    expect(reload).toHaveBeenCalledTimes(1);
    await db.accounts.clear();
  });

  it("clears the pending restore when Annuler is clicked", async () => {
    const user = userEvent.setup();
    await renderAuthenticated(<SyncPanel />);

    const content = JSON.stringify({ version: 1, exportedAt: 1000, tables: { accounts: [] } });
    const file = new File([content], "backup.json", { type: "application/json" });
    await user.upload(await screen.findByLabelText(/fichier de sauvegarde/i), file);
    await screen.findByRole("button", { name: /restaurer cette sauvegarde/i });

    await user.click(screen.getByRole("button", { name: /^annuler$/i }));

    expect(
      screen.queryByRole("button", { name: /restaurer cette sauvegarde/i }),
    ).not.toBeInTheDocument();
  });
});
