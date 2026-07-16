import { beforeEach, afterEach } from "vitest";
import { generateDekBytes } from "@/lib/encryption";
import { setActiveDek, clearActiveDek } from "@/lib/encryptionSession";

/**
 * Call once at the top level of a test file (inside or alongside a
 * `describe` block, not inside an `it`) to activate a fresh DEK before
 * every test and clear it afterwards.
 *
 * Needed because every repository now encrypts sensitive fields under the
 * active session's DEK (see src/db/encryptedRecord.ts) — repository-level
 * tests exercise this directly and never go through usersRepository (which
 * would normally establish a session as a side effect of login/creation),
 * so without this they'd fail with "Aucune session chiffrée active".
 */
export function useTestEncryptionSession(): void {
  beforeEach(() => {
    setActiveDek(generateDekBytes());
  });
  afterEach(() => {
    clearActiveDek();
  });
}
