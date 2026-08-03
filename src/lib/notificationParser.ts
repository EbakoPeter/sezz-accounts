import type { TransactionKind } from "@/types/models";

export type NotificationSource = "bank" | "mtn-momo" | "orange-money";

/**
 * A *draft* parsed from a notification — deliberately not a Transaction.
 * The whole design (see the "Option B" decision) is that nothing is ever
 * written to a real account automatically: this is only ever the
 * pre-filled starting point for a confirmation screen the user taps
 * through. That's why every field here can be uncertain, and why
 * `direction` in particular can be "unknown" — better to make the user
 * pick than to silently record money moving the wrong way.
 */
export interface ParsedNotification {
  source: NotificationSource;
  /** "income" (money in) / "expense" (money out) / "unknown" when the
   * text alone can't tell us — an Orange Money transfer's direction, for
   * instance, depends on whether the user is the sender or the recipient,
   * which the notification text doesn't state on its own (see parseOrangeMoney). */
  direction: TransactionKind | "unknown";
  /** In the account's own currency unit (FCFA/XAF), already normalized
   * from whatever thousands/decimal punctuation the source used. */
  amount: number;
  /** A human-readable label for the transaction — the merchant, the
   * counterparty, or a description, depending on what the source provides. */
  label: string;
  /** The other party's name or number, when the notification names one. */
  counterparty?: string;
  /** The balance the notification itself reports afterward, when present —
   * purely informational (lets the confirmation screen show "your provider
   * says your balance is now X" as a sanity check), never used to compute
   * anything, since this app derives balances from its own transactions. */
  reportedBalance?: number;
  /** The provider's own transaction id, when present — carried through so
   * a confirmed transaction can note it, making later reconciliation or
   * duplicate-detection possible. */
  reference?: string;
  /** True when any field above is uncertain enough that the user should
   * double-check it specifically. `direction: "unknown"` always sets this. */
  needsReview: boolean;
}

/**
 * Normalizes a money string from any of the observed formats into a
 * plain number. The formats really do differ source to source, verified
 * against real notifications:
 *   "XAF150,000.00" — comma is a thousands separator, dot is decimal
 *   "30000FCFA"     — no separators at all, glued to the currency
 *   "559.1 FCFA"    — dot is decimal, no thousands separator
 *   "30386.78 FCFA" — dot is decimal
 *   "450 XAF"       — plain integer
 *
 * The one genuinely ambiguous case is a lone comma or dot with exactly
 * three following digits ("30,000" vs "30.000") — both mean thirty
 * thousand in every real example seen, never thirty-with-a-fraction, so
 * a separator followed by exactly 3 digits and then a non-digit (or end)
 * is treated as a thousands separator. A dot or comma followed by 1, 2,
 * or more-than-3 digits is a decimal point.
 */
export function parseAmount(raw: string): number | undefined {
  // Strip currency markers and surrounding whitespace, keep digits and
  // separators only.
  const cleaned = raw.replace(/xaf|fcfa|f\b/gi, "").trim();
  const match = cleaned.match(/[\d.,\s]+/);
  if (!match) return undefined;
  let numeric = match[0].replace(/\s/g, "");
  if (numeric === "") return undefined;

  // Determine whether the last separator is a decimal point or a
  // thousands separator, using the "exactly 3 trailing digits" rule.
  const lastSep = Math.max(numeric.lastIndexOf(","), numeric.lastIndexOf("."));
  if (lastSep === -1) {
    const value = Number(numeric);
    return Number.isFinite(value) ? value : undefined;
  }
  const trailing = numeric.slice(lastSep + 1);
  if (trailing.length === 3) {
    // thousands separator — remove all separators entirely
    numeric = numeric.replace(/[.,]/g, "");
  } else {
    // decimal separator — remove all *other* separators, normalize this one to "."
    const intPart = numeric.slice(0, lastSep).replace(/[.,]/g, "");
    numeric = `${intPart}.${trailing}`;
  }
  const value = Number(numeric);
  return Number.isFinite(value) ? value : undefined;
}

/** Builds the optional part of a result, omitting any key whose value is
 * undefined entirely — this project runs with exactOptionalPropertyTypes,
 * under which `{ reportedBalance: undefined }` is NOT assignable to an
 * optional `reportedBalance?: number`; the key must be absent, not
 * present-and-undefined. */
function optionalFields(fields: {
  counterparty?: string | undefined;
  reportedBalance?: number | undefined;
  reference?: string | undefined;
}): Partial<Pick<ParsedNotification, "counterparty" | "reportedBalance" | "reference">> {
  const out: Partial<Pick<ParsedNotification, "counterparty" | "reportedBalance" | "reference">> =
    {};
  if (fields.counterparty !== undefined) out.counterparty = fields.counterparty;
  if (fields.reportedBalance !== undefined) out.reportedBalance = fields.reportedBalance;
  if (fields.reference !== undefined) out.reference = fields.reference;
  return out;
}

function parseBank(text: string): ParsedNotification | undefined {
  // Structured, labelled format:
  //   DEBIT / CREDIT
  //   Amount: XAF150,000.00
  //   Desc: ...
  //   Bal: XAF19,979.00
  const isDebit = /\bDEBIT\b/i.test(text);
  const isCredit = /\bCREDIT\b/i.test(text);
  if (!isDebit && !isCredit) return undefined;

  const amountMatch = text.match(/Amount:\s*([A-Z]*[\d.,]+)/i);
  const amount = amountMatch ? parseAmount(amountMatch[1]!) : undefined;
  if (amount === undefined) return undefined;

  const descMatch = text.match(/Desc:\s*(.+?)(?:\s*Date:|\n|$)/i);
  const balMatch = text.match(/Bal:\s*([A-Z]*[\d.,]+)/i);
  const label = descMatch ? descMatch[1]!.trim() : "Opération bancaire";

  return {
    source: "bank",
    direction: isDebit ? "expense" : "income",
    amount,
    label,
    needsReview: false,
    ...optionalFields({ reportedBalance: balMatch ? parseAmount(balMatch[1]!) : undefined }),
  };
}

function parseMtnMomo(text: string): ParsedNotification | undefined {
  // Two observed shapes, natural-language French:
  //   "Vous avez reçu 450 XAF de NAME (...) ..."           → income
  //   "Votre paiement de 10700 XAF a MERCHANT a ete ..."   → expense
  const received = text.match(
    /[Vv]ous avez re[çc]u\s+([\d.,\s]+(?:XAF|FCFA))\s+de\s+(.+?)(?:\s*\(|\.)/,
  );
  const paid = text.match(
    /[Vv]otre paiement de\s+([\d.,\s]+(?:XAF|FCFA))\s+a\s+(.+?)\s+a\s+[ée]t[ée]/,
  );

  const idMatch = text.match(/Transaction Id:\s*(\d+)/i);
  const balMatch = text.match(/[Nn]ouveau solde(?:\s+est\s+de)?:?\s*([\d.,]+)\s*(?:XAF|FCFA)/);

  if (received) {
    const amount = parseAmount(received[1]!);
    if (amount === undefined) return undefined;
    return {
      source: "mtn-momo",
      direction: "income",
      amount,
      label: `Reçu de ${received[2]!.trim()}`,
      needsReview: false,
      ...optionalFields({
        counterparty: received[2]!.trim(),
        reportedBalance: balMatch ? parseAmount(balMatch[1]!) : undefined,
        reference: idMatch ? idMatch[1] : undefined,
      }),
    };
  }
  if (paid) {
    const amount = parseAmount(paid[1]!);
    if (amount === undefined) return undefined;
    return {
      source: "mtn-momo",
      direction: "expense",
      amount,
      label: `Paiement à ${paid[2]!.trim()}`,
      needsReview: false,
      ...optionalFields({
        counterparty: paid[2]!.trim(),
        reportedBalance: balMatch ? parseAmount(balMatch[1]!) : undefined,
        reference: idMatch ? idMatch[1] : undefined,
      }),
    };
  }
  return undefined;
}

function parseOrangeMoney(text: string, ownNumber?: string): ParsedNotification | undefined {
  // "Transfert de <SENDER> vers <RECIPIENT> reussi. ... Montant
  //  Transaction: 30000FCFA, ... Nouveau Solde: 30386.78 FCFA."
  //
  // Direction is genuinely undecidable from the text alone: the same
  // sentence shape describes both sending and receiving — which one it
  // is depends entirely on whether the user is the <SENDER> or the
  // <RECIPIENT>. Only if we're told the user's own number (ownNumber)
  // can we decide; otherwise direction is "unknown" and the confirmation
  // screen must ask. Guessing here would be exactly the kind of silent
  // wrong-direction error the whole confirm-first design exists to avoid.
  const transferMatch = text.match(/Transfert de\s+(\d+)\s+.*?\s+vers\s+(\d+)\s+/i);
  if (!transferMatch) return undefined;

  const amountMatch = text.match(/Montant Transaction:\s*([\d.,]+\s*FCFA)/i);
  const amount = amountMatch ? parseAmount(amountMatch[1]!) : undefined;
  if (amount === undefined) return undefined;

  const idMatch = text.match(/ID transaction:\s*([A-Z0-9.]+)/i);
  const balMatch = text.match(/Nouveau Solde:\s*([\d.,]+)\s*FCFA/i);
  const senderNumber = transferMatch[1]!;
  const recipientNumber = transferMatch[2]!;

  let direction: TransactionKind | "unknown" = "unknown";
  if (ownNumber) {
    if (senderNumber === ownNumber) direction = "expense";
    else if (recipientNumber === ownNumber) direction = "income";
  }

  return {
    source: "orange-money",
    direction,
    amount,
    label:
      direction === "expense"
        ? `Transfert vers ${recipientNumber}`
        : direction === "income"
          ? `Reçu de ${senderNumber}`
          : `Transfert ${senderNumber} → ${recipientNumber}`,
    // Unknown direction always needs review — the user must pick.
    needsReview: direction === "unknown",
    ...optionalFields({
      counterparty: direction === "income" ? senderNumber : recipientNumber,
      reportedBalance: balMatch ? parseAmount(balMatch[1]!) : undefined,
      reference: idMatch ? idMatch[1] : undefined,
    }),
  };
}

/**
 * Tries each known format against the raw notification text. Returns a
 * draft to confirm, or undefined if nothing recognized it (in which case
 * the UI should fall back to a fully manual entry rather than pretending
 * it understood). `ownNumber`, when known, lets Orange Money transfers
 * resolve their direction instead of leaving it for the user to pick.
 */
export function parseNotification(
  text: string,
  ownNumber?: string,
): ParsedNotification | undefined {
  return parseBank(text) ?? parseMtnMomo(text) ?? parseOrangeMoney(text, ownNumber);
}
