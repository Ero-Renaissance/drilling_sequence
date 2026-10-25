/**
 * The per-browser category fold state (spec §8.8) is keyed by team code. A team
 * code is any `^[a-z][a-z0-9-]{1,31}$` (the admin API's allow-list), so
 * "constructor" — an Object member — is a valid code and must read as an
 * ordinary team; "valueOf" / "toString" (not valid codes) prove every lookup is
 * own-key only. A stored "__proto__" key must stay plain data.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CATEGORY_FOLDS_KEY, useOpenCategories } from "@/components/readiness/category-folds";

const stored = () => JSON.parse(window.localStorage.getItem(CATEGORY_FOLDS_KEY) ?? "{}") as Record<string, unknown>;

afterEach(() => window.localStorage.clear());

describe("useOpenCategories", () => {
  it.each(["constructor", "valueOf", "toString"])(
    "a team coded %s starts all folded and remembers its own choice",
    (team) => {
      const { result } = renderHook(() => useOpenCategories(team));
      expect([...result.current[0]]).toEqual([]);

      act(() => result.current[1]("Vessels"));
      expect([...result.current[0]]).toEqual(["Vessels"]);
      expect(Object.prototype.hasOwnProperty.call(stored(), team)).toBe(true);
      expect(stored()[team]).toEqual(["Vessels"]);
    },
  );

  it("a team coded constructor reads all folded beside another team's stored choice", () => {
    window.localStorage.setItem(CATEGORY_FOLDS_KEY, JSON.stringify({ logistics: ["Lifting"] }));
    const { result } = renderHook(() => useOpenCategories("constructor"));
    expect([...result.current[0]]).toEqual([]);
    const { result: logistics } = renderHook(() => useOpenCategories("logistics"));
    expect([...logistics.current[0]]).toEqual(["Lifting"]);
  });

  it("a stored __proto__ key stays data — read back and written back, never a prototype", () => {
    window.localStorage.setItem(CATEGORY_FOLDS_KEY, '{"__proto__":["Vessels"],"logistics":["Lifting"]}');
    const { result } = renderHook(() => useOpenCategories("logistics"));
    expect([...result.current[0]]).toEqual(["Lifting"]);

    act(() => result.current[1]("Barges"));
    const raw = window.localStorage.getItem(CATEGORY_FOLDS_KEY) ?? "";
    expect(raw).toContain('"__proto__":["Vessels"]');
    expect(stored().logistics).toEqual(["Lifting", "Barges"]);
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
  });
});
