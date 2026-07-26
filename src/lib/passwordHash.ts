/**
 * Password hashing for local user profiles. This is deliberately simpler
 * than the full envelope-encryption scheme the previous app version used
 * for encrypting all data at rest (that is a separate, larger piece of
 * work, tracked as still pending in the README) — this module only
 * answers "is this the right password for this user", via PBKDF2, so
 * passwords are never stored or compared in plain text.
 */

const PBKDF2_ITERATIONS = 150_000;
const SALT_BYTES = 16;
const HASH_BITS = 256;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export function generateSalt(): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(SALT_BYTES)));
}

async function deriveHash(password: string, saltHex: string): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: hexToBytes(saltHex), iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    HASH_BITS,
  );
  return bytesToHex(new Uint8Array(bits));
}

export interface PasswordHash {
  hash: string;
  salt: string;
}

/** Hashes a new password with a freshly generated salt. */
export async function hashNewPassword(password: string): Promise<PasswordHash> {
  const salt = generateSalt();
  const hash = await deriveHash(password, salt);
  return { hash, salt };
}

/** Constant-time string comparison — avoids leaking hash-match progress
 * through response timing. Overkill for a purely local single-device app,
 * but costs nothing and is the correct default for comparing secrets. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** Verifies a password against a previously stored hash+salt. */
export async function verifyPassword(password: string, stored: PasswordHash): Promise<boolean> {
  const candidate = await deriveHash(password, stored.salt);
  return timingSafeEqual(candidate, stored.hash);
}
