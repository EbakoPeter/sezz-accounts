import { ValidationError } from "./errors";

/**
 * Money is always a whole-number FCFA amount. This module is the single
 * place that decides what counts as a valid amount and how one is displayed,
 * so that validation logic is never duplicated (or subtly re-implemented
 * differently) across the UI.
 */

/** Throws ValidationError unless `value` is a finite, strictly positive integer. */
export function assertPositiveAmount(value: number, fieldLabel = "Le montant"): void {
  if (!Number.isFinite(value)) {
    throw new ValidationError(`${fieldLabel} doit être un nombre.`);
  }
  if (!Number.isInteger(value)) {
    throw new ValidationError(`${fieldLabel} doit être un nombre entier (pas de centimes).`);
  }
  if (!Number.isSafeInteger(value)) {
    throw new ValidationError(`${fieldLabel} est trop grand pour être représenté précisément.`);
  }
  if (value <= 0) {
    throw new ValidationError(`${fieldLabel} doit être strictement positif.`);
  }
}

/** Same as `assertPositiveAmount` but allows zero (e.g. an opening balance of 0). */
export function assertNonNegativeAmount(value: number, fieldLabel = "Le montant"): void {
  if (!Number.isFinite(value)) {
    throw new ValidationError(`${fieldLabel} doit être un nombre.`);
  }
  if (!Number.isInteger(value)) {
    throw new ValidationError(`${fieldLabel} doit être un nombre entier (pas de centimes).`);
  }
  if (!Number.isSafeInteger(value)) {
    throw new ValidationError(`${fieldLabel} est trop grand pour être représenté précisément.`);
  }
  if (value < 0) {
    throw new ValidationError(`${fieldLabel} ne peut pas être négatif.`);
  }
}

const FCFA_FORMATTER = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });

/** Formats an integer FCFA amount for display, e.g. -12000 -> "(12 000) FCFA".
 * The thousands separator is normalized to a plain space: `Intl.NumberFormat`
 * for "fr-FR" uses a narrow no-break space (U+202F) whose exact codepoint has
 * varied across ICU versions/runtimes, which made this function's output
 * non-deterministic across environments. */
export function formatFcfa(amount: number): string {
  const rounded = Math.round(amount);
  const formatted = FCFA_FORMATTER.format(Math.abs(rounded)).replace(/[\u00A0\u202F]/g, " ");
  return rounded < 0 ? `(${formatted}) FCFA` : `${formatted} FCFA`;
}
