import { afterEach, describe, expect, it, vi } from "vitest";

// Mock MSAL so that *constructing* it never touches the real Web Crypto API.
// The point of these tests is to assert WHETHER PublicClientApplication gets
// constructed (dev mode must not), not to exercise MSAL internals.
const { PublicClientApplicationMock } = vi.hoisted(() => ({
  // Regular function (not an arrow) so auth.ts can invoke it with `new`.
  PublicClientApplicationMock: vi.fn(function () {
    return { getAllAccounts: vi.fn(() => []) };
  }),
}));

vi.mock("@azure/msal-browser", () => ({
  PublicClientApplication: PublicClientApplicationMock,
}));

describe("lib/auth — dev-mode MSAL guard", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    PublicClientApplicationMock.mockClear();
  });

  it("does not construct MSAL in dev mode (prevents crypto_nonexistent over plain HTTP)", async () => {
    vi.stubEnv("VITE_DEV_MODE", "true");
    vi.resetModules();
    const { msalInstance, getAccessToken } = await import("@/lib/auth");

    // The crux: MSAL is never instantiated, so its crypto-requiring constructor
    // never runs — the dashboard can load over a plain-HTTP, non-localhost host.
    expect(PublicClientApplicationMock).not.toHaveBeenCalled();
    expect(msalInstance).toBeNull();
    await expect(getAccessToken()).resolves.toBe("dev-token");
  });

  it("constructs MSAL when dev mode is off", async () => {
    vi.stubEnv("VITE_DEV_MODE", "false");
    vi.resetModules();
    const { msalInstance } = await import("@/lib/auth");

    expect(PublicClientApplicationMock).toHaveBeenCalledTimes(1);
    expect(msalInstance).not.toBeNull();
  });
});
