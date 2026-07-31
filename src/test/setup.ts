import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";
import { afterEach } from "vitest";

/** localStorage now holds the language preference (see
 * i18n/LanguageContext.tsx) — cleared after every test so one test
 * changing the language can never leak into another sharing the same
 * jsdom environment within a file. */
afterEach(() => {
  localStorage.clear();
});
