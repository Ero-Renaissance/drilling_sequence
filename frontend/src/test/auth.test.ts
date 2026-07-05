import { afterEach, describe, expect, it, vi } from "vitest";

// Mock MSAL so that *constructing* it never touches the real Web Crypto API.
// These tests assert WHETHER PublicClientApplication gets constructed (dev mode
// must not) and that initializeMsal() drives the v3 bootstrap sequence — not
// MSAL internals.
const { PublicClientApplicationMock, msalMockInstance } = vi.hoisted(() => {
  const msalMockInstance = {
    initialize: vi.fn(async () => undefined),
    handleRedirectPromise: vi.fn(async () => null as unknown),
    getAllAccounts: vi.fn(() => [] as unknown[]),
    getActiveAccount: vi.fn(() => null as unknown),
    setActiveAccount: vi.fn(),
  };
  return {
    msalMockInstance,
    // Regular function (not an arrow) so auth.ts can invoke it with `new`.
    PublicClientApplicationMock: vi.fn(function () {
      return msalMockInstance;
    }),
  };
});

vi.mock("@azure/msal-browser", () => ({
  PublicClientApplication: PublicClientApplicationMock,
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  PublicClientApplicationMock.mockClear();
  msalMockInstance.initialize.mockClear();
  msalMockInstance.handleRedirectPromise.mockReset().mockResolvedValue(null);
  msalMockInstance.getAllAccounts.mockReset().mockReturnValue([]);
  msalMockInstance.getActiveAccount.mockReset().mockReturnValue(null);
  msalMockInstance.setActiveAccount.mockClear();
});

describe("lib/auth — dev-mode MSAL guard", () => {
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

describe("lib/auth — initializeMsal (v3 bootstrap + redirect completion)", () => {
  it("is a no-op in dev mode", async () => {
    vi.stubEnv("VITE_DEV_MODE", "true");
    vi.resetModules();
    const { initializeMsal } = await import("@/lib/auth");

    await expect(initializeMsal()).resolves.toBeUndefined();
    expect(msalMockInstance.initialize).not.toHaveBeenCalled();
  });

  it("initializes MSAL, processes the redirect, and activates the returned account", async () => {
    vi.stubEnv("VITE_DEV_MODE", "false");
    vi.resetModules();
    const account = { homeAccountId: "abc" };
    msalMockInstance.handleRedirectPromise.mockResolvedValue({ account });
    const { initializeMsal } = await import("@/lib/auth");

    await initializeMsal();

    expect(msalMockInstance.initialize).toHaveBeenCalledTimes(1);
    expect(msalMockInstance.handleRedirectPromise).toHaveBeenCalledTimes(1);
    // initialize() must run before handleRedirectPromise() — MSAL v3 throws otherwise.
    expect(msalMockInstance.initialize.mock.invocationCallOrder[0]).toBeLessThan(
      msalMockInstance.handleRedirectPromise.mock.invocationCallOrder[0],
    );
    expect(msalMockInstance.setActiveAccount).toHaveBeenCalledWith(account);
  });

  it("falls back to a cached account on a non-redirect load", async () => {
    vi.stubEnv("VITE_DEV_MODE", "false");
    vi.resetModules();
    const cached = { homeAccountId: "cached" };
    msalMockInstance.getAllAccounts.mockReturnValue([cached]);
    const { initializeMsal } = await import("@/lib/auth");

    await initializeMsal();

    expect(msalMockInstance.setActiveAccount).toHaveBeenCalledWith(cached);
  });

  it("does not activate anything when no account exists (first visit)", async () => {
    vi.stubEnv("VITE_DEV_MODE", "false");
    vi.resetModules();
    const { initializeMsal } = await import("@/lib/auth");

    await initializeMsal();

    expect(msalMockInstance.setActiveAccount).not.toHaveBeenCalled();
  });
});
