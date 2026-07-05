import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { initializeMsal } from "@/lib/auth";
import { logger } from "@/lib/logger";

// MSAL must be initialised — and a returning login redirect processed — before
// anything renders: AppShell fetches /api/auth/me on mount, and that request
// only carries a token once the redirect's auth code has been exchanged.
// On failure we still render, landing the user on the login page to retry.
initializeMsal()
  .catch((err: unknown) => {
    logger.error("MSAL initialisation failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  })
  .finally(() => {
    createRoot(document.getElementById("root")!).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  });
