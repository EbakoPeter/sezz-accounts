/// <reference types="vite/client" />

/** ISO timestamp of when this build was produced, injected by vite.config.ts
 * via `define`. Shown in the UI (login screen, error screen) specifically
 * so it's possible to confirm which deployed build is actually running
 * without comparing minified filenames or stack traces by hand. */
declare const __BUILD_TIME__: string;

interface ImportMetaEnv {
  /** Optional. The production sync server's own URL, baked in at build
   * time (a real deploy sets this so a brand new customer creating an
   * account never has to know or type a server address themselves) —
   * left unset in local development, where the field stays editable so
   * it's still possible to point at a different server for testing. */
  readonly VITE_SYNC_SERVER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
