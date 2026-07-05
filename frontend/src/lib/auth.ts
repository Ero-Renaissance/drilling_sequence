import { Configuration, PublicClientApplication } from "@azure/msal-browser";
import { logger } from "@/lib/logger";

const msalConfig: Configuration = {
  auth: {
    clientId: import.meta.env.VITE_AZURE_CLIENT_ID ?? "",
    authority: `https://login.microsoftonline.com/${import.meta.env.VITE_AZURE_TENANT_ID ?? ""}`,
    redirectUri: import.meta.env.VITE_AZURE_REDIRECT_URI ?? window.location.origin,
  },
  cache: { cacheLocation: "sessionStorage" },
};

// Auth is bypassed in dev mode, so MSAL must NOT be constructed there. Its
// constructor eagerly initialises the Web Crypto API (window.crypto.subtle),
// which browsers expose only in a secure context (HTTPS or localhost). On a
// plain-HTTP, non-localhost host — a common DEV_MODE test setup — constructing
// it throws BrowserAuthError "crypto_nonexistent" at module load and white-
// screens the app. Holding it null in dev mode lets such builds load over HTTP.
const isDevMode = import.meta.env.VITE_DEV_MODE === "true";

export const msalInstance: PublicClientApplication | null = isDevMode
  ? null
  : new PublicClientApplication(msalConfig);

// The scope name must match one exposed under the app registration's
// "Expose an API" blade (AADSTS65005 at sign-in means it doesn't exist there).
const apiScope = import.meta.env.VITE_AZURE_API_SCOPE || "user_impersonation";

export const loginRequest = {
  scopes: [`api://${import.meta.env.VITE_AZURE_CLIENT_ID}/${apiScope}`],
};

/**
 * Initialise MSAL and complete a login redirect, if one is in flight. MSAL v3
 * requires an explicit initialize() before any other call, and the auth code
 * Azure AD puts in the URL hash after loginRedirect is only exchanged for
 * tokens by handleRedirectPromise() — without it the account cache stays empty
 * and every API call goes out unauthenticated.
 *
 * Must complete before the app renders: AppShell fetches /api/auth/me on
 * mount, and that call needs the redirect processed to attach a token.
 */
export async function initializeMsal(): Promise<void> {
  if (!msalInstance) return; // dev mode — auth is bypassed

  await msalInstance.initialize();
  const result = await msalInstance.handleRedirectPromise();
  const account = result?.account ?? msalInstance.getAllAccounts()[0] ?? null;
  if (account) msalInstance.setActiveAccount(account);
  // Dev-only breadcrumb (logger.info is silent in prod): says whether this load
  // came back from a login redirect and whether a signed-in account now exists.
  logger.info(
    `MSAL ready — redirect ${result ? "processed" : "none"}, account ${account ? "active" : "absent"}`,
  );
}

/** Acquire an access token silently, falling back to redirect if needed. */
export async function getAccessToken(): Promise<string | null> {
  // Dev mode: no real token needed — backend accepts any Bearer value, and
  // msalInstance is intentionally null (see above), so we never dereference it.
  if (isDevMode || !msalInstance) {
    return "dev-token";
  }

  const account = msalInstance.getActiveAccount() ?? msalInstance.getAllAccounts()[0];
  if (!account) {
    logger.warn("No signed-in MSAL account — request goes out unauthenticated (expect 401)");
    return null;
  }

  try {
    const result = await msalInstance.acquireTokenSilent({
      ...loginRequest,
      account,
    });
    if (!result.accessToken) {
      // MSAL cache edge case: a "successful" silent call can return an empty
      // accessToken (e.g. cached response for a different resource). Force a
      // network refresh rather than silently sending the request unauthenticated.
      logger.warn("acquireTokenSilent returned an empty access token — forcing refresh");
      const fresh = await msalInstance.acquireTokenSilent({
        ...loginRequest,
        account,
        forceRefresh: true,
      });
      return fresh.accessToken || null;
    }
    return result.accessToken;
  } catch (err: unknown) {
    const code =
      typeof (err as { errorCode?: unknown })?.errorCode === "string"
        ? (err as { errorCode: string }).errorCode
        : err instanceof Error
          ? err.name
          : "unknown";
    logger.warn(`Silent token acquisition failed [${code}] — falling back to redirect`);
    await msalInstance.acquireTokenRedirect(loginRequest);
    return null;
  }
}
