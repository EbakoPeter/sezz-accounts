/** Generates a unique id for a new entity. Wrapped in its own module so the
 * strategy (currently `crypto.randomUUID`) can change in one place later. */
export function generateId(): string {
  return crypto.randomUUID();
}
