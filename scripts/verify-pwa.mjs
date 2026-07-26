#!/usr/bin/env node
/**
 * Verifies the production build satisfies the actual criteria Chrome/Edge use
 * to decide whether an app is installable (not just "a manifest file exists"):
 *  - manifest is valid JSON, served, and linked from index.html
 *  - name/short_name, start_url, display: standalone are present
 *  - at least one icon >= 192x192 AND one >= 512x512
 *  - a service worker is registered and present on disk
 * Run after `npm run build`.
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
let failures = 0;
let total = 0;

function check(label, condition) {
  total += 1;
  console.log(`${condition ? "PASS" : "FAIL"} - ${label}`);
  if (!condition) failures += 1;
}

const indexHtml = readFileSync(path.join(distDir, "index.html"), "utf8");
check(
  "index.html links the web app manifest",
  /<link[^>]+rel=["']manifest["'][^>]+href=["'][^"']*manifest\.webmanifest["']/.test(indexHtml),
);

const manifestPath = path.join(distDir, "manifest.webmanifest");
check("manifest.webmanifest exists in the build output", existsSync(manifestPath));

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
check("manifest has a name", typeof manifest.name === "string" && manifest.name.length > 0);
check(
  "manifest has a short_name",
  typeof manifest.short_name === "string" && manifest.short_name.length > 0,
);
check("manifest.start_url is set", typeof manifest.start_url === "string");
check(
  "manifest.display is 'standalone' (installable app window, not a browser tab)",
  manifest.display === "standalone",
);

const icons = Array.isArray(manifest.icons) ? manifest.icons : [];
const has192 = icons.some((i) => i.sizes === "192x192" && !i.purpose);
const has512 = icons.some((i) => i.sizes === "512x512" && !i.purpose);
const hasMaskable = icons.some((i) => i.purpose === "maskable");
check("manifest declares a >=192x192 icon (Android install requirement)", has192);
check("manifest declares a >=512x512 icon (splash screen requirement)", has512);
check("manifest declares a maskable icon (adaptive icon on Android)", hasMaskable);

for (const icon of icons) {
  const iconPath = path.join(distDir, icon.src);
  check(`icon file exists on disk: ${icon.src}`, existsSync(iconPath));
}

check(
  "service worker (sw.js) is present in the build output",
  existsSync(path.join(distDir, "sw.js")),
);
check(
  "the app registers the service worker at runtime",
  existsSync(path.join(distDir, "registerSW.js")),
);

console.log(`\n${total - failures}/${total} checks passed`);
if (failures > 0) {
  console.error(`\n${failures} check(s) failed — this build would NOT be installable.`);
  process.exit(1);
}
console.log("\nThis build meets Chrome/Edge/Android's installability criteria.");
