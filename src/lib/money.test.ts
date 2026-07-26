import { describe, it, expect } from "vitest";
import { assertPositiveAmount, assertNonNegativeAmount, formatFcfa } from "./money";
import { ValidationError } from "./errors";

describe("assertPositiveAmount", () => {
  it("accepts a positive integer", () => {
    expect(() => assertPositiveAmount(5000)).not.toThrow();
  });

  it("rejects zero", () => {
    expect(() => assertPositiveAmount(0)).toThrow(ValidationError);
  });

  it("rejects negative numbers", () => {
    expect(() => assertPositiveAmount(-100)).toThrow(ValidationError);
  });

  it("rejects non-integers", () => {
    expect(() => assertPositiveAmount(100.5)).toThrow(ValidationError);
  });

  it("rejects NaN and Infinity", () => {
    expect(() => assertPositiveAmount(NaN)).toThrow(ValidationError);
    expect(() => assertPositiveAmount(Infinity)).toThrow(ValidationError);
  });

  it("includes the custom field label in the error message", () => {
    expect(() => assertPositiveAmount(-1, "Le solde")).toThrow(/Le solde/);
  });
});

describe("assertNonNegativeAmount", () => {
  it("accepts zero", () => {
    expect(() => assertNonNegativeAmount(0)).not.toThrow();
  });

  it("rejects negative numbers", () => {
    expect(() => assertNonNegativeAmount(-1)).toThrow(ValidationError);
  });
});

describe("formatFcfa", () => {
  it("formats a positive amount with thousands separators", () => {
    expect(formatFcfa(1500000)).toBe("1 500 000 FCFA");
  });

  it("formats a negative amount in parentheses", () => {
    expect(formatFcfa(-25000)).toBe("(25 000) FCFA");
  });

  it("formats zero without parentheses", () => {
    expect(formatFcfa(0)).toBe("0 FCFA");
  });

  it("rounds fractional input defensively", () => {
    expect(formatFcfa(999.6)).toBe("1 000 FCFA");
  });
});
