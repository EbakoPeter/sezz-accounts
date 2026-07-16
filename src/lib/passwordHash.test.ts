import { describe, it, expect } from "vitest";
import { hashNewPassword, verifyPassword, generateSalt } from "./passwordHash";

describe("passwordHash", () => {
  it("generates a salt of the expected hex length", () => {
    const salt = generateSalt();
    expect(salt).toMatch(/^[0-9a-f]{32}$/); // 16 bytes -> 32 hex chars
  });

  it("generates a different salt each time", () => {
    expect(generateSalt()).not.toBe(generateSalt());
  });

  it("hashes a password and verifies it correctly", async () => {
    const stored = await hashNewPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", stored)).toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const stored = await hashNewPassword("correct password");
    expect(await verifyPassword("wrong password", stored)).toBe(false);
  });

  it("never stores the password itself, only a hash and salt", async () => {
    const stored = await hashNewPassword("my secret password");
    expect(stored.hash).not.toContain("my secret password");
    expect(stored.salt).not.toContain("my secret password");
  });

  it("produces different hashes for the same password with different salts", async () => {
    const a = await hashNewPassword("same password");
    const b = await hashNewPassword("same password");
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
  });

  it("is case-sensitive", async () => {
    const stored = await hashNewPassword("Password123");
    expect(await verifyPassword("password123", stored)).toBe(false);
  });
});
