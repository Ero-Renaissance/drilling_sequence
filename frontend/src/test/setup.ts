import { vi } from "vitest";
import "@testing-library/jest-dom";
import { server } from "./mocks/server";
import { savedGates } from "./mocks/handlers";
import { TEAM_VIEW_KEY } from "@/components/readiness/team-view";

// jsdom doesn't implement matchMedia; the theme store calls it at creation time.
if (!window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

// jsdom gaps that Radix UI (dropdowns/popovers) relies on.
if (typeof ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
Element.prototype.scrollIntoView ??= () => {};
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.setPointerCapture ??= () => {};
Element.prototype.releasePointerCapture ??= () => {};

// The suite runs on a FIXED date. Readiness pages open on "this year and the
// next two" and fixtures carry calendar dates, so with the real clock a test
// that passes today would fail next January. Only `Date` is faked — timers,
// promises and user events run for real.
vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-24T12:00:00") });

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  savedGates.clear();
  // A team grid remembers its Projects | Wells view per browser: each test
  // starts from the default (Projects).
  window.localStorage.removeItem(TEAM_VIEW_KEY);
});
afterAll(() => server.close());
