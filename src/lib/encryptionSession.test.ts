import { describe, it, expect, afterEach } from "vitest";
import { setActiveDek, clearActiveDek, getActiveDek, requireActiveDek } from "./encryptionSession";
import { generateDekBytes } from "./encryption";

afterEach(() => {
  clearActiveDek();
});

describe("encryptionSession", () => {
  it("returns null when no session is active", () => {
    expect(getActiveDek()).toBeNull();
  });

  it("returns the DEK once set", () => {
    const dek = generateDekBytes();
    setActiveDek(dek);
    expect(getActiveDek()).toBe(dek);
  });

  it("returns null again after clearing", () => {
    setActiveDek(generateDekBytes());
    clearActiveDek();
    expect(getActiveDek()).toBeNull();
  });

  it("requireActiveDek returns the DEK when one is active", () => {
    const dek = generateDekBytes();
    setActiveDek(dek);
    expect(requireActiveDek()).toBe(dek);
  });

  it("requireActiveDek throws a clear error when no session is active", () => {
    expect(() => requireActiveDek()).toThrow(/aucune session/i);
  });
});
