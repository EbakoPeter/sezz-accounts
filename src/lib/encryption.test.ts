import { describe, it, expect } from "vitest";
import {
  generateSalt,
  generateDekBytes,
  wrapDek,
  unwrapDek,
  encryptWithDek,
  decryptWithDek,
} from "./encryption";

describe("generateSalt / generateDekBytes", () => {
  it("generates a 32-hex-char salt (16 bytes)", () => {
    expect(generateSalt()).toMatch(/^[0-9a-f]{32}$/);
  });

  it("generates different salts each time", () => {
    expect(generateSalt()).not.toBe(generateSalt());
  });

  it("generates a 32-byte DEK", () => {
    expect(generateDekBytes()).toHaveLength(32);
  });

  it("generates different DEKs each time", () => {
    const a = generateDekBytes();
    const b = generateDekBytes();
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });
});

describe("wrapDek / unwrapDek", () => {
  it("round-trips: unwrapping with the correct password recovers the exact DEK bytes", async () => {
    const dek = generateDekBytes();
    const salt = generateSalt();
    const wrapped = await wrapDek(dek, "correct horse battery staple", salt);
    const recovered = await unwrapDek(wrapped, "correct horse battery staple", salt);
    expect(Array.from(recovered)).toEqual(Array.from(dek));
  });

  it("throws when unwrapping with the wrong password", async () => {
    const dek = generateDekBytes();
    const salt = generateSalt();
    const wrapped = await wrapDek(dek, "correct password", salt);
    await expect(unwrapDek(wrapped, "wrong password", salt)).rejects.toThrow();
  });

  it("throws when unwrapping with the wrong salt (even with the right password)", async () => {
    const dek = generateDekBytes();
    const wrapped = await wrapDek(dek, "same password", generateSalt());
    await expect(unwrapDek(wrapped, "same password", generateSalt())).rejects.toThrow();
  });

  it("the same DEK wrapped for two different users produces two different wrapped blobs", async () => {
    const dek = generateDekBytes();
    const wrappedForAlice = await wrapDek(dek, "alice-password", generateSalt());
    const wrappedForBob = await wrapDek(dek, "bob-password", generateSalt());
    expect(wrappedForAlice.data).not.toBe(wrappedForBob.data);
  });

  it("two different users' wrapped copies both unwrap to the identical shared DEK", async () => {
    const dek = generateDekBytes();
    const aliceSalt = generateSalt();
    const bobSalt = generateSalt();
    const wrappedForAlice = await wrapDek(dek, "alice-password", aliceSalt);
    const wrappedForBob = await wrapDek(dek, "bob-password", bobSalt);

    const aliceRecovered = await unwrapDek(wrappedForAlice, "alice-password", aliceSalt);
    const bobRecovered = await unwrapDek(wrappedForBob, "bob-password", bobSalt);

    expect(Array.from(aliceRecovered)).toEqual(Array.from(dek));
    expect(Array.from(bobRecovered)).toEqual(Array.from(dek));
    expect(Array.from(aliceRecovered)).toEqual(Array.from(bobRecovered));
  });
});

describe("encryptWithDek / decryptWithDek", () => {
  it("round-trips a JSON value", async () => {
    const dek = generateDekBytes();
    const value = { label: "Salaire", amount: 300000, note: "" };
    const blob = await encryptWithDek(dek, value);
    const recovered = await decryptWithDek(dek, blob);
    expect(recovered).toEqual(value);
  });

  it("produces ciphertext that does not contain the plaintext as a substring", async () => {
    const dek = generateDekBytes();
    const blob = await encryptWithDek(dek, { label: "SECRET_MARKER_VALUE", amount: 12345 });
    expect(blob.data).not.toContain("SECRET_MARKER_VALUE");
    expect(blob.data).not.toContain("12345");
  });

  it("produces a different ciphertext each time even for the same value (random IV)", async () => {
    const dek = generateDekBytes();
    const a = await encryptWithDek(dek, { x: 1 });
    const b = await encryptWithDek(dek, { x: 1 });
    expect(a.iv).not.toBe(b.iv);
    expect(a.data).not.toBe(b.data);
  });

  it("fails to decrypt with the wrong DEK", async () => {
    const dek = generateDekBytes();
    const otherDek = generateDekBytes();
    const blob = await encryptWithDek(dek, { secret: true });
    await expect(decryptWithDek(otherDek, blob)).rejects.toThrow();
  });
});
