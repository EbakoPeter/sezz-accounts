import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  define: {
    // Must mirror vite.config.ts's define — components that read
    // __BUILD_TIME__ (LoginScreen, ErrorBoundary) would otherwise throw
    // ReferenceError under Vitest, which doesn't share Vite's own config.
    // The exact value doesn't matter for tests, only that it exists.
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    css: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      exclude: ["node_modules/", "src/test/", "**/*.test.ts", "**/*.test.tsx"],
    },
  },
});
