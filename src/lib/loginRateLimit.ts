/**
 * Login attempt rate limiting. Stored directly on the User record
 * (failedLoginAttempts, lockedUntil) rather than a separate table — only
 * real accounts are ever rate-limited, which is exactly what needs
 * protecting; there is no account to protect behind a nonexistent
 * username, so probing one isn't rate-limited at all (nothing to gain from
 * it either way).
 *
 * This client-side limiter raises the bar against casual guessing through
 * the actual UI. It cannot stop a local attacker with access to a devtools
 * console, who could call the repository directly — no purely client-side
 * mechanism can. See SECURITY.md.
 */

export const MAX_ATTEMPTS_BEFORE_LOCKOUT = 5;
export const BASE_LOCKOUT_MS = 30_000; // 30 seconds
export const MAX_LOCKOUT_MS = 15 * 60_000; // 15 minutes

/** How long (ms) an account should be locked out given a failure count —
 * 0 means "not locked, allow the attempt." The first MAX_ATTEMPTS_BEFORE_LOCKOUT
 * failures are free; every failure after that doubles the lockout, capped
 * at MAX_LOCKOUT_MS. */
export function computeLockoutDurationMs(failedAttempts: number): number {
  if (failedAttempts < MAX_ATTEMPTS_BEFORE_LOCKOUT) return 0;
  const exponent = failedAttempts - MAX_ATTEMPTS_BEFORE_LOCKOUT;
  return Math.min(BASE_LOCKOUT_MS * 2 ** exponent, MAX_LOCKOUT_MS);
}

/** Remaining lockout time in ms, 0 if not currently locked (or never was). */
export function remainingLockoutMs(lockedUntil: number | undefined, now: number): number {
  if (!lockedUntil) return 0;
  return Math.max(0, lockedUntil - now);
}
