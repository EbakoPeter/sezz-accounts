import { LivreDeComptesDatabase } from "@/db/schema";

let counter = 0;

/** A fresh, isolated database per call — tests never share state, and never
 * touch the real "LivreDeComptesDB" name. */
export function createTestDatabase(): LivreDeComptesDatabase {
  counter += 1;
  return new LivreDeComptesDatabase(`test-db-${counter}-${Date.now()}`);
}
