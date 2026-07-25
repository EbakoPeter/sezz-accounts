import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";

import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  define: {
    // Baked in at build time, fresh for every `npm run build` — lets the
    // running app show exactly which build it is, directly in the UI.
    // Existed to solve a real, recurring problem: without it, confirming
    // "is this actually the latest deploy" required comparing minified JS
    // filenames or stack traces by hand, every single time.
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [react(), VitePWA({
    registerType: "autoUpdate",
    includeAssets: ["favicon.png"],
    manifest: {
      name: "SEZZ",
      short_name: "SEZZ",
      description: "Gestion budgétaire personnelle — comptes, opérations, synchronisation",
      lang: "fr",
      theme_color: "#16333E",
      background_color: "#FAF7F1",
      display: "standalone",
      start_url: "/",
      scope: "/",
      icons: [
        { src: "icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "icon-512.png", sizes: "512x512", type: "image/png" },
        {
          src: "icon-maskable-192.png",
          sizes: "192x192",
          type: "image/png",
          purpose: "maskable",
        },
        {
          src: "icon-maskable-512.png",
          sizes: "512x512",
          type: "image/png",
          purpose: "maskable",
        },
      ],
    },
    workbox: {
      // App-shell + asset caching only. IndexedDB (our actual data) is left
      // alone — the service worker's job is "the app still opens offline",
      // not caching API responses (there is no API yet).
      globPatterns: ["**/*.{js,css,html,png,svg,ico}"],
    },
    devOptions: {
      enabled: false,
    },
  }), cloudflare()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});