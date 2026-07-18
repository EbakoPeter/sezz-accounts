/// <reference types="vite/client" />

/** ISO timestamp of when this build was produced, injected by vite.config.ts
 * via `define`. Shown in the UI (login screen, error screen) specifically
 * so it's possible to confirm which deployed build is actually running
 * without comparing minified filenames or stack traces by hand. */
declare const __BUILD_TIME__: string;
