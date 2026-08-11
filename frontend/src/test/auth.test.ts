import { describe, expect, it } from "vitest";

// Authentication is handled at the edge by the reverse proxy (Windows Integrated
// Auth) for the app's own origin, so the SPA manages no bearer token: the API
// layer omits the Authorization header and lets the browser's transparent
// same-origin auth carry each request.
describe("lib/auth — getAccessToken", () => {
  it("resolves to null (no client-managed bearer token under proxy SSO)", async () => {
    const { getAccessToken } = await import("@/lib/auth");
    await expect(getAccessToken()).resolves.toBeNull();
  });
});
