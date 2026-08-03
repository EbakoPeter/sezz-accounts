import { describe, it, expect } from "vitest";
import { parseNotification, parseAmount } from "./notificationParser";

// The exact real notification texts provided, with amounts/numbers left
// as given. These are the ground truth the parser must handle correctly —
// each is a real message from a real provider, not a synthetic example.
const BANK_DEBIT = `DEBIT
 Amount: XAF150,000.00
 Account: 110XXXXXXX29
 Desc: VISA-ATM WD @ 12370068-BIYEMASSI 2            BIY
 Date: 19-07-2026 14:48:09
 Bal: XAF19,979.00 .`;

const MOMO_RECEIVED = `Vous avez recu 450 XAF de HONORINE MEGNI PEGUE TAYOU (237679963987 HONORINE MEGNI PEGUE TAYOU) sur votre compte Mobile Money 2026-07-29 23:18:23. Message de l'expediteur:. Votre nouveau solde est de 11103 FCFA. Frais: 0 XAF. Transaction ID: 18136684316. Emprunte jusqu'à 100 000 FCFA d'avance en quelques secondes pour tes transactions. Tape *126*6# ou télécharge la nouvelle MoMo App ici  link.mtn.cm/NewMoMoAppRef.`;

const MOMO_PAID = `Votre paiement de 10700 XAF a CANALPLUS DIRECT  a ete effectue le 2026-07-29 23:29:39. Votre nouveau solde: 403 XAF. Frais: 0 XAF. Message: -. Transaction Id: 18136723036.  Emprunte jusqu'à 100 000 FCFA d'avance en quelques secondes pour tes transactions. Tape *126*6# ou télécharge la nouvelle MoMo App ici  link.mtn.cm/NewMoMoAppRef.`;

const OM_TRANSFER_A = `Transfert de 656262382 AWOULOU EPSE KABA vers 656480453 EBAKO AGBOR reussi. Details: ID transaction: PP260730.1050.B91660, Montant Transaction: 30000FCFA, Frais: 0 FCFA, Commission: 0 FCFA, Montant Net: 30000 FCFA, Nouveau Solde: 30386.78 FCFA.`;

const OM_TRANSFER_B = `Transfert de 656480453 EBAKO AGBOR vers 693982976 WAMBA reussi. ID transaction: PP260727.1142.A64689, Montant Transaction: 554 FCFA, Frais: 5.1 FCFA, Commission: 0 FCFA, Montant Net: 559.1 FCFA, Nouveau Solde: 386.78 FCFA.`;

describe("parseAmount", () => {
  it("handles a comma thousands separator with decimal (bank format)", () => {
    expect(parseAmount("XAF150,000.00")).toBe(150000);
  });
  it("handles an amount glued to the currency with no separators", () => {
    expect(parseAmount("30000FCFA")).toBe(30000);
  });
  it("handles a decimal amount with a dot", () => {
    expect(parseAmount("559.1 FCFA")).toBe(559.1);
    expect(parseAmount("30386.78 FCFA")).toBe(30386.78);
  });
  it("handles a plain integer", () => {
    expect(parseAmount("450 XAF")).toBe(450);
  });
  it("treats a separator with exactly three trailing digits as thousands, not decimal", () => {
    expect(parseAmount("30,000")).toBe(30000);
    expect(parseAmount("30.000")).toBe(30000);
  });
});

describe("parseNotification — bank", () => {
  it("reads a bank DEBIT as an expense with the right amount and label", () => {
    const result = parseNotification(BANK_DEBIT);
    expect(result?.source).toBe("bank");
    expect(result?.direction).toBe("expense");
    expect(result?.amount).toBe(150000);
    expect(result?.label).toMatch(/VISA-ATM WD/);
    expect(result?.reportedBalance).toBe(19979);
    expect(result?.needsReview).toBe(false);
  });
});

describe("parseNotification — MTN MoMo", () => {
  it("reads a received MoMo payment as income", () => {
    const result = parseNotification(MOMO_RECEIVED);
    expect(result?.source).toBe("mtn-momo");
    expect(result?.direction).toBe("income");
    expect(result?.amount).toBe(450);
    expect(result?.counterparty).toMatch(/HONORINE MEGNI PEGUE TAYOU/);
    expect(result?.reportedBalance).toBe(11103);
    expect(result?.reference).toBe("18136684316");
    expect(result?.needsReview).toBe(false);
  });

  it("reads a MoMo payment sent as an expense", () => {
    const result = parseNotification(MOMO_PAID);
    expect(result?.source).toBe("mtn-momo");
    expect(result?.direction).toBe("expense");
    expect(result?.amount).toBe(10700);
    expect(result?.counterparty).toMatch(/CANALPLUS DIRECT/);
    expect(result?.reportedBalance).toBe(403);
    expect(result?.reference).toBe("18136723036");
    expect(result?.needsReview).toBe(false);
  });
});

describe("parseNotification — Orange Money", () => {
  it("extracts the amount correctly but leaves direction unknown (needs review) when the user's number is not known", () => {
    const result = parseNotification(OM_TRANSFER_A);
    expect(result?.source).toBe("orange-money");
    expect(result?.amount).toBe(30000);
    expect(result?.direction).toBe("unknown");
    expect(result?.needsReview).toBe(true);
    expect(result?.reportedBalance).toBe(30386.78);
    expect(result?.reference).toBe("PP260730.1050.B91660");
  });

  it("resolves direction to income when the user is the recipient", () => {
    // In transfer A, 656480453 (EBAKO AGBOR) is the *recipient* — so for
    // that user this is money coming in.
    const result = parseNotification(OM_TRANSFER_A, "656480453");
    expect(result?.direction).toBe("income");
    expect(result?.needsReview).toBe(false);
    expect(result?.counterparty).toBe("656262382");
  });

  it("resolves direction to expense when the user is the sender", () => {
    // In transfer B, 656480453 (EBAKO AGBOR) is the *sender* — so for
    // that user this is money going out.
    const result = parseNotification(OM_TRANSFER_B, "656480453");
    expect(result?.direction).toBe("expense");
    expect(result?.amount).toBe(554);
    expect(result?.needsReview).toBe(false);
    expect(result?.counterparty).toBe("693982976");
  });

  it("the same user's number gives opposite directions for the two transfers — proving direction really does depend on who you are", () => {
    const asRecipient = parseNotification(OM_TRANSFER_A, "656480453");
    const asSender = parseNotification(OM_TRANSFER_B, "656480453");
    expect(asRecipient?.direction).toBe("income");
    expect(asSender?.direction).toBe("expense");
  });
});

describe("parseNotification — unrecognized", () => {
  it("returns undefined for text that matches no known format", () => {
    expect(
      parseNotification("Bonjour, ceci n'est pas une notification financière."),
    ).toBeUndefined();
  });
});
