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

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  savedGates.clear();
  // A team grid remembers its Projects | Wells view per browser: each test
  // starts from the default (Projects).
  window.localStorage.removeItem(TEAM_VIEW_KEY);
});
afterAll(() => server.close());
