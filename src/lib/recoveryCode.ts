/**
 * Generates the one-time recovery code shown to a user when their account
 * is created (or when they regenerate it). Never stored anywhere in plain
 * form — see usersRepository.ts, which only ever stores a hash of it (for
 * quick verification) and a copy of the shared DEK wrapped under a key
 * derived from it (for actually recovering access).
 */

// Deliberately excludes visually ambiguous characters (0/O, 1/I/L) so a
// person copying the code down by hand is less likely to transcribe it
// wrong — this is a usability property, not a security one; the alphabet
// is still large enough (32 symbols) that entropy stays high.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const GROUP_COUNT = 4;
const GROUP_LENGTH = 4;

/** Produces a code like "XPQ2-7K9M-VC4H-2ZQR" — 16 symbols from a
 * 32-character alphabet, ~80 bits of entropy. Formatted with dashes purely
 * for human readability; the dashes are not part of the secret and are
 * stripped before any hashing/derivation. */
export function generateRecoveryCode(): string {
  const groups: string[] = [];
  for (let g = 0; g < GROUP_COUNT; g++) {
    const randomIndices = crypto.getRandomValues(new Uint8Array(GROUP_LENGTH));
    let group = "";
    for (let i = 0; i < GROUP_LENGTH; i++) {
      group += ALPHABET[randomIndices[i]! % ALPHABET.length];
    }
    groups.push(group);
  }
  return groups.join("-");
}

/** Normalizes user input before hashing/deriving: strips dashes/whitespace
 * and uppercases, so "xpq2 7k9m-vc4h-2zqr" still matches what was issued. */
export function normalizeRecoveryCode(code: string): string {
  return code.replace(/[\s-]/g, "").toUpperCase();
}
