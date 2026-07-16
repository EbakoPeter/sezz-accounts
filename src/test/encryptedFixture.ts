import { toStorageRow } from "@/db/encryptedRecord";

/**
 * Builds the exact row shape a repository would have written, for tests
 * that need to insert a fixture directly into Dexie (bypassing the
 * repository — usually to pin a specific, known id that later assertions
 * reference) while still respecting the encrypted-at-rest format every
 * table uses. Requires an active encryption session, exactly like the real
 * repositories do — see src/test/testDek.ts (repository-level tests) or
 * src/test/renderAuthenticated.tsx (component tests, which activate one as
 * a side effect of creating the test user).
 */
export async function encryptedFixture<T extends object, K extends keyof T>(
  record: T,
  sensitiveKeys: readonly K[],
) {
  return toStorageRow(record, sensitiveKeys);
}
