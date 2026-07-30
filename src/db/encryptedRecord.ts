import { encryptWithDek, decryptWithDek, type EncryptedBlob } from "@/lib/encryption";
import { requireActiveDek } from "@/lib/encryptionSession";

/**
 * Every table splits its fields into two groups:
 *  - structural fields: needed for Dexie indexes/queries (ids, dates used
 *    for range filters, foreign keys, `kind` discriminators, ...) — stored
 *    in the clear, since an id or a foreign key isn't sensitive on its own;
 *  - sensitive fields: the actual content (names, amounts, labels,
 *    descriptions, ...) — bundled into one JSON blob and encrypted under
 *    the shared DEK before ever reaching IndexedDB.
 *
 * This is why Web Crypto (inherently asynchronous) can be used at all here:
 * encryption happens in the repository layer, fully before/after the Dexie
 * call, never inside a Dexie hook — Dexie's creating/reading/updating hooks
 * are synchronous and cannot safely await a Promise mid-transaction.
 */

export interface WithEncrypted {
  _enc: EncryptedBlob;
}

/** Produces the shape actually written to Dexie: everything in `record`
 * except `sensitiveKeys`, plus those keys bundled into `_enc`. */
export async function toStorageRow<T extends object, K extends keyof T>(
  record: T,
  sensitiveKeys: readonly K[],
): Promise<Omit<T, K> & WithEncrypted> {
  const dek = requireActiveDek();
  const sensitive = {} as Pick<T, K>;
  const structural: Partial<T> = { ...record };
  for (const key of sensitiveKeys) {
    sensitive[key] = record[key];
    delete structural[key];
  }
  const _enc = await encryptWithDek(dek, sensitive);
  return { ...structural, _enc } as Omit<T, K> & WithEncrypted;
}

/** Thrown by fromStorageRow when a record can't be decrypted with the
 * active DEK. Deliberately distinct from the raw OperationError Web Crypto
 * throws (an authentication-tag mismatch, with no further detail) — this
 * carries an actionable explanation, since the near-universal cause is a
 * shared-DEK mismatch between devices (see fromStorageRows below for the
 * fuller explanation, and SECURITY.md for how to avoid it). */
export class DecryptionError extends Error {
  constructor() {
    super(
      "Impossible de déchiffrer cet enregistrement : il a probablement été chiffré avec une " +
        "clé différente de celle de cette session (par exemple, des données synchronisées " +
        "depuis un appareil ayant créé son propre compte administrateur avant de se " +
        "connecter à la synchronisation, plutôt que de rejoindre un compte existant).",
    );
    this.name = "DecryptionError";
  }
}

/** Reverses toStorageRow: decrypts `_enc` and merges the sensitive fields
 * back in, returning the original logical record shape. Throws
 * DecryptionError (not the raw Web Crypto error) if this specific record
 * can't be decrypted with the active DEK. */
export async function fromStorageRow<T>(row: WithEncrypted): Promise<T> {
  const dek = requireActiveDek();
  const { _enc, ...structural } = row;
  let sensitive: Record<string, unknown>;
  try {
    sensitive = await decryptWithDek<Record<string, unknown>>(dek, _enc);
  } catch {
    throw new DecryptionError();
  }
  return { ...structural, ...sensitive } as T;
}

/**
 * Like fromStorageRow, but tolerant of a decryption failure the same way
 * fromStorageRows already is for a whole list — returns undefined instead
 * of throwing DecryptionError. Every repository's own list() already
 * silently excludes a record it can't decrypt rather than taking the
 * whole list down with it (see fromStorageRows below); a getById()-style
 * single-record lookup had no equivalent, which meant looking up one of
 * those exact same records directly — most commonly a foreign-key
 * resolution, e.g. "look up this transaction's own accountId to show its
 * name" — still threw and crashed the current view via ErrorBoundary,
 * even though the very same record was already being silently skipped by
 * any list rendering it. This makes the two consistent: a record
 * encrypted under a mismatched key (the near-universal cause being
 * multi-device sync — see DecryptionError's own message) is now
 * "invisible until the key mismatch is resolved" everywhere, not "crashes
 * the page" in some call paths and "silently skipped" in others.
 */
export async function fromStorageRowOrUndefined<T>(
  row: WithEncrypted | undefined,
): Promise<T | undefined> {
  if (!row) return undefined;
  try {
    return await fromStorageRow<T>(row);
  } catch (err) {
    if (err instanceof DecryptionError) {
      console.error("Enregistrement ignoré (déchiffrement impossible) :", err);
      return undefined;
    }
    throw err;
  }
}

/**
 * Like fromStorageRow, but for a whole list — and deliberately tolerant of
 * individual failures rather than propagating the first one and losing
 * the entire list. This matters specifically because of multi-device
 * sync: two devices that each independently created their own local admin
 * account (each generating its own encryption key) before ever connecting
 * to the same sync account will each receive the other's data during a
 * pull, encrypted under a key neither of them holds. Before this, a
 * single such record failing to decrypt inside a bulk read (list(), a
 * live-query-backed hook, ...) crashed the entire view — one bad record
 * from another device made every account/transaction/etc. on this device
 * unreadable too. Records that can't be decrypted are now silently
 * excluded rather than taking the whole list down with them; this trades
 * "the app crashes" for "this particular data is invisible until the key
 * mismatch is resolved," which is the safer failure mode of the two — the
 * data itself is untouched either way, only decryptable once this device
 * holds the right key.
 */
export async function fromStorageRows<T>(rows: WithEncrypted[]): Promise<T[]> {
  const results = await Promise.allSettled(rows.map((row) => fromStorageRow<T>(row)));
  const decrypted: T[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      decrypted.push(result.value);
    } else {
      // Deliberate diagnostic signal for exactly the scenario described
      // above; not silent, just not fatal.
      console.error("Enregistrement ignoré (déchiffrement impossible) :", result.reason);
    }
  }
  return decrypted;
}
