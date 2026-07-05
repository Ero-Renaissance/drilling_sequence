/// <reference types="vite/client" />
// Vitest's globals (vi, describe, beforeAll, …) — the suite runs with `globals: true`
// and the test files use them ambiently; this keeps `tsc -b` happy on src/test.
/// <reference types="vitest/globals" />

interface ImportMetaEnv {
  readonly VITE_AZURE_CLIENT_ID: string;
  readonly VITE_AZURE_TENANT_ID: string;
  readonly VITE_AZURE_REDIRECT_URI: string;
  // Scope name under the app registration's "Expose an API" (defaults to
  // user_impersonation when unset).
  readonly VITE_AZURE_API_SCOPE?: string;
  readonly VITE_DEV_MODE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
