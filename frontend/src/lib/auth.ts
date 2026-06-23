import { Configuration, PublicClientApplication } from "@azure/msal-browser";

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

export const loginRequest = {
  scopes: [`api://${import.meta.env.VITE_AZURE_CLIENT_ID}/user_impersonation`],
};

/** Acquire an access token silently, falling back to redirect if needed. */
export async function getAccessToken(): Promise<string | null> {
  // Dev mode: no real token needed — backend accepts any Bearer value, and
  // msalInstance is intentionally null (see above), so we never dereference it.
  if (isDevMode || !msalInstance) {
    return "dev-token";
  }

  const accounts = msalInstance.getAllAccounts();
  if (accounts.length === 0) return null;

  try {
    const result = await msalInstance.acquireTokenSilent({
      ...loginRequest,
      account: accounts[0],
    });
    return result.accessToken;
  } catch {
    await msalInstance.acquireTokenRedirect(loginRequest);
    return null;
  }
}
