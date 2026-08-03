import { afterEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NotificationImportPanel } from "./NotificationImportPanel";
import { db } from "@/db/schema";
import { clearActiveDek } from "@/lib/encryptionSession";
import { encryptedFixture } from "@/test/encryptedFixture";
import { createTestUser, renderWithSession } from "@/test/renderAuthenticated";
import { transactionsRepository } from "@/repositories";
import type { Engagement } from "@/types/models";

const MOMO_RECEIVED = `Vous avez recu 450 XAF de HONORINE MEGNI PEGUE TAYOU (237679963987 HONORINE MEGNI PEGUE TAYOU) sur votre compte Mobile Money 2026-07-29 23:18:23. Votre nouveau solde est de 11103 FCFA. Frais: 0 XAF. Transaction ID: 18136684316.`;

const MOMO_PAID = `Votre paiement de 10700 XAF a CANALPLUS DIRECT  a ete effectue le 2026-07-29 23:29:39. Votre nouveau solde: 403 XAF. Frais: 0 XAF. Transaction Id: 18136723036.`;

const OM_TRANSFER = `Transfert de 656262382 AWOULOU EPSE KABA vers 656480453 EBAKO AGBOR reussi. Details: ID transaction: PP260730.1050.B91660, Montant Transaction: 30000FCFA, Nouveau Solde: 30386.78 FCFA.`;

afterEach(async () => {
  await db.users.clear();
  await db.roleTemplates.clear();
  await db.transactions.clear();
  await db.engagements.clear();
  await db.budgetSubcategories.clear();
  await db.budgetCategories.clear();
  await db.accounts.clear();
  clearActiveDek();
  vi.restoreAllMocks();
});

async function seedAccount(id = "acc-1", name = "Compte MoMo", initialBalance = 10653) {
  await db.accounts.add(
    await encryptedFixture(
      { id, name, initialBalance, createdAt: Date.now(), updatedAt: Date.now() },
      ["name", "initialBalance"] as const,
    ),
  );
}

async function seedEngagement(amount: number, label: string) {
  await db.budgetCategories.add(
    await encryptedFixture(
      { id: "cat-1", name: "Vie Courante", createdAt: Date.now(), updatedAt: Date.now() },
      ["name"] as const,
    ),
  );
  await db.budgetSubcategories.add(
    await encryptedFixture(
      {
        id: "sub-1",
        categoryId: "cat-1",
        name: "Divers",
        monthlyAllocation: 100000,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      ["name", "monthlyAllocation"] as const,
    ),
  );
  await db.engagements.add(
    await encryptedFixture<Engagement, "amount" | "label" | "note">(
      {
        id: "eng-1",
        subcategoryId: "sub-1",
        amount,
        label,
        date: "2026-01-01",
        status: "engaged" as const,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      ["amount", "label", "note"] as const,
    ),
  );
}

describe("NotificationImportPanel", () => {
  it("parses a received MoMo notification into an income draft and records it on confirm", async () => {
    const session = await createTestUser("admin");
    await seedAccount();
    const user = userEvent.setup();
    renderWithSession(<NotificationImportPanel />, session);

    await user.type(screen.getByLabelText(/texte de la notification/i), MOMO_RECEIVED);
    await user.click(screen.getByRole("button", { name: /analyser/i }));

    // Draft appears, pre-filled as income
    expect(await screen.findByText(/opération détectée/i)).toHaveTextContent(/MTN MoMo/);
    expect(await screen.findByLabelText(/^sens$/i)).toHaveValue("income");
    expect(screen.getByLabelText(/montant/i)).toHaveValue(450);

    await user.selectOptions(screen.getByLabelText(/compte concerné/i), "acc-1");
    await user.click(screen.getByRole("button", { name: /confirmer et enregistrer/i }));

    expect(await screen.findByRole("status")).toHaveTextContent(/enregistrée/i);
    const txns = await transactionsRepository.list();
    expect(txns).toHaveLength(1);
    expect(txns[0]!.kind).toBe("income");
    expect(txns[0]!.amount).toBe(450);
    expect(txns[0]!.note).toMatch(/18136684316/);
  });

  it("requires an engagement before an expense (from a paid MoMo notification) can be confirmed", async () => {
    const session = await createTestUser("admin");
    await seedAccount("acc-1", "Compte MoMo", 11103);
    await seedEngagement(10700, "Abonnement CANAL+");
    const user = userEvent.setup();
    renderWithSession(<NotificationImportPanel />, session);

    await user.type(screen.getByLabelText(/texte de la notification/i), MOMO_PAID);
    await user.click(screen.getByRole("button", { name: /analyser/i }));

    expect(screen.getByLabelText(/^sens$/i)).toHaveValue("expense");
    await user.selectOptions(screen.getByLabelText(/compte concerné/i), "acc-1");

    // Confirm without an engagement → blocked
    await user.click(screen.getByRole("button", { name: /confirmer et enregistrer/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/reliée à un engagement/i);

    // Pick the engagement → succeeds
    await user.selectOptions(screen.getByLabelText(/dépenses à faire/i), "eng-1");
    await user.click(screen.getByRole("button", { name: /confirmer et enregistrer/i }));

    expect(await screen.findByRole("status")).toHaveTextContent(/enregistrée/i);
    const txns = await transactionsRepository.list();
    expect(txns[0]!.kind).toBe("expense");
    expect(txns[0]!.amount).toBe(10700);
  });

  it("flags an Orange Money transfer's direction for review when the user's number is unknown", async () => {
    const session = await createTestUser("admin");
    await seedAccount();
    const user = userEvent.setup();
    renderWithSession(<NotificationImportPanel />, session);

    await user.type(screen.getByLabelText(/texte de la notification/i), OM_TRANSFER);
    await user.click(screen.getByRole("button", { name: /analyser/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/sens.*n.a pas pu être déterminé/i);
    expect(screen.getByLabelText(/montant/i)).toHaveValue(30000);
  });

  it("resolves an Orange Money transfer's direction when the user's own number is given", async () => {
    const session = await createTestUser("admin");
    await seedAccount();
    const user = userEvent.setup();
    renderWithSession(<NotificationImportPanel />, session);

    await user.type(screen.getByLabelText(/votre numéro/i), "656480453");
    await user.type(screen.getByLabelText(/texte de la notification/i), OM_TRANSFER);
    await user.click(screen.getByRole("button", { name: /analyser/i }));

    // 656480453 is the recipient in this transfer → income, no review flag
    expect(screen.getByLabelText(/^sens$/i)).toHaveValue("income");
    expect(screen.queryByText(/n.a pas pu être déterminé/i)).not.toBeInTheDocument();
  });

  it("warns of a balance discrepancy when the reported balance doesn't match NKaP's own projection", async () => {
    const session = await createTestUser("admin");
    // Account starts at 0, so after +450 NKaP projects 450 — but the
    // notification reports 11103, a clear discrepancy signalling earlier
    // transactions NKaP never saw.
    await seedAccount("acc-1", "Compte MoMo", 0);
    const user = userEvent.setup();
    renderWithSession(<NotificationImportPanel />, session);

    await user.type(screen.getByLabelText(/texte de la notification/i), MOMO_RECEIVED);
    await user.click(screen.getByRole("button", { name: /analyser/i }));
    await user.selectOptions(screen.getByLabelText(/compte concerné/i), "acc-1");

    expect(await screen.findByText(/écart détecté/i)).toBeInTheDocument();
  });

  it("shows a not-recognized message for unparseable text", async () => {
    const session = await createTestUser("admin");
    await seedAccount();
    const user = userEvent.setup();
    renderWithSession(<NotificationImportPanel />, session);

    await user.type(
      screen.getByLabelText(/texte de la notification/i),
      "Bonjour, rien à voir ici.",
    );
    await user.click(screen.getByRole("button", { name: /analyser/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/format non reconnu/i);
  });
});
