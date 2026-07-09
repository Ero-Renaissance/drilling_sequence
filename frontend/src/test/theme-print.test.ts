import { afterEach, describe, expect, it } from "vitest";
import { useThemeStore } from "@/store/theme";

/** Print-outs must always be light: beforeprint strips the .dark class (killing
 *  both token-driven and literal `dark:` styling), afterprint restores the
 *  user's theme. */
describe("theme store — print is always light", () => {
  let dispose: (() => void) | undefined;

  afterEach(() => {
    dispose?.();
    dispose = undefined;
    window.localStorage.clear();
    document.documentElement.classList.remove("dark");
  });

  it("strips dark for the print and restores it afterwards", () => {
    useThemeStore.getState().setTheme("dark");
    dispose = useThemeStore.getState().init();
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    window.dispatchEvent(new Event("beforeprint"));
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.style.colorScheme).toBe("light");

    window.dispatchEvent(new Event("afterprint"));
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("leaves a light theme untouched across a print cycle", () => {
    useThemeStore.getState().setTheme("light");
    dispose = useThemeStore.getState().init();

    window.dispatchEvent(new Event("beforeprint"));
    window.dispatchEvent(new Event("afterprint"));
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("stops listening after dispose (no theme surprises from stale handlers)", () => {
    useThemeStore.getState().setTheme("dark");
    dispose = useThemeStore.getState().init();
    dispose();
    dispose = undefined;

    window.dispatchEvent(new Event("beforeprint"));
    // Listener removed — printing no longer mutates the class.
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
});
