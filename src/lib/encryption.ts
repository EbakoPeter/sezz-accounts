/**
 * Envelope encryption for data at rest.
 *
 * The actual data (accounts, transactions, budget, debts) is protected by
 * one shared Data Encryption Key (DEK) — shared because multiple users can
 * have permission to see and edit the same data (see the Permissions model
 * in src/types/models.ts); encrypting per-user-password directly would mean
 * a second user could never decrypt data the first user wrote.
 *
 * The DEK itself is never stored in the clear. Instead, every user gets
 * their own *wrapped* copy of the same DEK: the DEK's raw bytes, encrypted
 * ("wrapped") under a key derived from that user's own password. Losing or
 * changing one user's password only ever affects that user's own wrapped
 * copy — it can always be re-wrapped from the raw DEK, which is available
 * to any already-authenticated session holding it in memory (see
 * src/lib/encryptionSession.ts).
 */

const PBKDF2_ITERATIONS = 150_000;
const SALT_BYTES = 16;
const DEK_BYTES = 32; // AES-256

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

/** Derives an AES-GCM key from a password — used only to encrypt/decrypt a
 * user's copy of the DEK's raw bytes ("wrapping"/"unwrapping" it), never to
 * encrypt actual data directly. */
async function deriveWrappingKey(password: string, saltHex: string): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: hexToBytes(saltHex), iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export function generateDekBytes(): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(new ArrayBuffer(DEK_BYTES)));
}

export interface WrappedDek {
  iv: string;
  data: string;
}

/** Wraps (encrypts) raw DEK bytes under a key derived from `password`. */
export async function wrapDek(
  dekBytes: Uint8Array<ArrayBuffer>,
  password: string,
  saltHex: string,
): Promise<WrappedDek> {
  const wrappingKey = await deriveWrappingKey(password, saltHex);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, wrappingKey, dekBytes);
  return { iv: bytesToHex(iv), data: bytesToHex(new Uint8Array(ciphertext)) };
}

/** Unwraps (decrypts) a user's copy of the DEK using their password. Throws
 * if the password is wrong (AES-GCM's authentication tag will not verify). */
export async function unwrapDek(
  wrapped: WrappedDek,
  password: string,
  saltHex: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const wrappingKey = await deriveWrappingKey(password, saltHex);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: hexToBytes(wrapped.iv) },
    wrappingKey,
    hexToBytes(wrapped.data),
  );
  return new Uint8Array(plain);
}

async function importDekKey(dekBytes: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", dekBytes, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

export interface EncryptedBlob {
  iv: string;
  data: string;
}

/** Encrypts an arbitrary JSON-serializable value (typically the bundle of
 * sensitive fields for one record) under the DEK. */
export async function encryptWithDek(
  dekBytes: Uint8Array<ArrayBuffer>,
  value: unknown,
): Promise<EncryptedBlob> {
  const key = await importDekKey(dekBytes);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  return { iv: bytesToHex(iv), data: bytesToHex(new Uint8Array(ciphertext)) };
}

/** Decrypts a blob previously produced by encryptWithDek. */
export async function decryptWithDek<T>(
  dekBytes: Uint8Array<ArrayBuffer>,
  blob: EncryptedBlob,
): Promise<T> {
  const key = await importDekKey(dekBytes);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: hexToBytes(blob.iv) },
    key,
    hexToBytes(blob.data),
  );
  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}
