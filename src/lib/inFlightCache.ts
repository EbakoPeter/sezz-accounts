const inFlight = new Map<string, Promise<unknown>>();

/**
 * Deduplicates genuinely concurrent calls to an expensive async
 * computation: if a call for the same key is already in flight, later
 * callers await that same promise instead of starting a redundant
 * computation from scratch.
 *
 * Deliberately NOT a cache in the usual sense — there is no TTL, no
 * invalidation logic to get wrong, and no stored result to accidentally
 * serve stale. The entry is removed the instant the promise settles
 * (success or failure), before this function's own call even returns, so
 * the very next call — even one microtask later — always starts fresh.
 * This only ever collapses calls that overlap in time and would
 * otherwise compute the exact same thing simultaneously (the case that
 * actually happens in this app: several hooks in the same screen each
 * asking for the same unscoped table read within the same render), never
 * calls that happen to ask the same question at different times. In a
 * financial app, that distinction is the whole point — speed is never
 * worth a wrong number.
 *
 * The caller is responsible for choosing a key precise enough that two
 * calls which could legitimately return different results never share
 * one — e.g. including every parameter that affects the result, not just
 * the database identity.
 */
export async function dedupeInFlight<T>(key: string, compute: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key);
  if (existing) return existing as Promise<T>;

  const promise = compute();
  inFlight.set(key, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(key);
  }
}
