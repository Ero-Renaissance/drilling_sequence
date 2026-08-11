/**
 * Authentication client shim.
 *
 * The app authenticates via a reverse proxy (IIS/ARR doing Windows Integrated
 * Auth) that authenticates the browser to the app's own origin transparently.
 * There is therefore no bearer token for the SPA to manage — see getAccessToken.
 */

/**
 * Access token for API calls.
 *
 * Windows Integrated Auth is performed by the reverse proxy for the app's own
 * origin, so same-origin requests are authenticated by the browser transparently
 * and carry no bearer token. This resolves to null (callers then omit the
 * Authorization header); it stays a function so the API modules that call it need
 * no change. In dev mode the backend injects a dev user, so null works there too.
 */
export async function getAccessToken(): Promise<string | null> {
  return null;
}

/**
 * sessionStorage marker set by an explicit Sign out. Windows Integrated Auth
 * has no browser session to end, so without it the Login page would auto-resolve
 * /api/auth/me and bounce the user straight back in. Login consumes it once on
 * mount; the next full page load auto-signs-in again.
 */
export const SIGNED_OUT_KEY = "ds-signed-out";
