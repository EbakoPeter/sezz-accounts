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

/** Reverses toStorageRow: decrypts `_enc` and merges the sensitive fields
 * back in, returning the original logical record shape. */
export async function fromStorageRow<T>(row: WithEncrypted): Promise<T> {
  const dek = requireActiveDek();
  const { _enc, ...structural } = row;
  const sensitive = await decryptWithDek<Record<string, unknown>>(dek, _enc);
  return { ...structural, ...sensitive } as T;
}

export async function fromStorageRows<T>(rows: WithEncrypted[]): Promise<T[]> {
  return Promise.all(rows.map((row) => fromStorageRow<T>(row)));
}
