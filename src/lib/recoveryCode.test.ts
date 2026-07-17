import { describe, it, expect } from "vitest";
import { generateRecoveryCode, normalizeRecoveryCode } from "./recoveryCode";

describe("generateRecoveryCode", () => {
  it("produces a code in the expected format (4 groups of 4, dash-separated)", () => {
    const code = generateRecoveryCode();
    expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  });

  it("never contains visually ambiguous characters (0, O, 1, I, L)", () => {
    for (let i = 0; i < 50; i++) {
      const code = generateRecoveryCode();
      expect(code).not.toMatch(/[01IOL]/);
    }
  });

  it("generates a different code each time", () => {
    const codes = new Set(Array.from({ length: 20 }, () => generateRecoveryCode()));
    expect(codes.size).toBe(20);
  });
});

describe("normalizeRecoveryCode", () => {
  it("strips dashes", () => {
    expect(normalizeRecoveryCode("ABCD-EFGH-JKMN-PQRS")).toBe("ABCDEFGHJKMNPQRS");
  });

  it("strips whitespace", () => {
    expect(normalizeRecoveryCode("ABCD EFGH JKMN PQRS")).toBe("ABCDEFGHJKMNPQRS");
  });

  it("uppercases lowercase input", () => {
    expect(normalizeRecoveryCode("abcd-efgh-jkmn-pqrs")).toBe("ABCDEFGHJKMNPQRS");
  });

  it("is idempotent with the generator's own output", () => {
    const code = generateRecoveryCode();
    expect(normalizeRecoveryCode(code)).toBe(code.replace(/-/g, ""));
  });
});
