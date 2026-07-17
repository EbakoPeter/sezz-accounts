import { describe, it, expect } from "vitest";
import {
  computeLockoutDurationMs,
  remainingLockoutMs,
  MAX_ATTEMPTS_BEFORE_LOCKOUT,
  BASE_LOCKOUT_MS,
  MAX_LOCKOUT_MS,
} from "./loginRateLimit";

describe("computeLockoutDurationMs", () => {
  it("returns 0 (no lockout) below the threshold", () => {
    for (let i = 0; i < MAX_ATTEMPTS_BEFORE_LOCKOUT; i++) {
      expect(computeLockoutDurationMs(i)).toBe(0);
    }
  });

  it("locks out starting exactly at the threshold", () => {
    expect(computeLockoutDurationMs(MAX_ATTEMPTS_BEFORE_LOCKOUT)).toBe(BASE_LOCKOUT_MS);
  });

  it("doubles the lockout for each additional failure", () => {
    expect(computeLockoutDurationMs(MAX_ATTEMPTS_BEFORE_LOCKOUT + 1)).toBe(BASE_LOCKOUT_MS * 2);
    expect(computeLockoutDurationMs(MAX_ATTEMPTS_BEFORE_LOCKOUT + 2)).toBe(BASE_LOCKOUT_MS * 4);
  });

  it("caps at MAX_LOCKOUT_MS no matter how many failures", () => {
    expect(computeLockoutDurationMs(MAX_ATTEMPTS_BEFORE_LOCKOUT + 20)).toBe(MAX_LOCKOUT_MS);
  });
});

describe("remainingLockoutMs", () => {
  it("returns 0 when lockedUntil is undefined", () => {
    expect(remainingLockoutMs(undefined, Date.now())).toBe(0);
  });

  it("returns 0 once the lockout has expired", () => {
    const now = 1_000_000;
    expect(remainingLockoutMs(now - 1, now)).toBe(0);
  });

  it("returns the remaining time while still locked", () => {
    const now = 1_000_000;
    expect(remainingLockoutMs(now + 5000, now)).toBe(5000);
  });
});
