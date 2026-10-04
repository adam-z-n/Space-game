/// <reference types="vite/client" />

/** The app version from package.json, e.g. "1.0.0". */
declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  /** Set when building an archived release (e.g. "1.0") served from its own path, such as /v1.0/. */
  readonly VITE_ARCHIVE?: string;
}
