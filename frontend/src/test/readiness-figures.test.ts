import { describe, expect, it } from "vitest";
import {
  READINESS_FIGURES_HINT,
  pct,
  readinessScope,
  readinessSubline,
  sumFigures,
} from "@/lib/readiness-figures";
import {
  clampYearRange,
  defaultYearRange,
  focusStartOf,
  inYears,
  parseYearRange,
  rangePhrase,
  rangeQuery,
  yearsOf,
} from "@/lib/readiness-window";
import { checksReady } from "@/lib/watchlist";

// docs/readiness-framework-spec.md §3.7 — the frontend formats the backend's
// figures and decides "ready" for drill-throughs the same way the backend does.

describe("readiness figures", () => {
  it("words the spec's worked example: the two figures under Complete", () => {
    expect(readinessSubline({ on_track_pct: 83, behind: 1 })).toBe("83% on track · 1 behind");
  });

  it("says nothing counts rather than 0%", () => {
    expect(readinessSubline({ on_track_pct: null, behind: 0 })).toBe("Nothing to count");
  });

  it("names what a card counts", () => {
    expect(readinessScope(1, "projects")).toBe("1 field project");
    expect(readinessScope(4, "projects")).toBe("4 field projects");
    expect(readinessScope(1, "wells")).toBe("1 well");
    expect(readinessScope(9, "wells")).toBe("9 wells");
  });

  it("explains On track in the hover text", () => {
    expect(READINESS_FIGURES_HINT).toMatch(/On track = Completed or On Track \(nothing behind\)/);
  });
});

describe("checksReady", () => {
  const gates = (statuses: string[]) =>
    Object.fromEntries(statuses.map((status, i) => [`G${i}`, { status }]));

  it("needs every counted check done — an unset gate reads On Track, so it isn't", () => {
    expect(checksReady(gates(["Completed", "N/A"]))).toBe(true);
    expect(checksReady(gates(["Completed", "On Track"]))).toBe(false);
  });

  it("reads severity, so Available is done and Pending isn't", () => {
    expect(checksReady(gates(["Completed", "Available"]))).toBe(true);
    expect(checksReady(gates(["Completed", "Pending"]))).toBe(false);
  });

  it("an all-N/A or empty set is not ready", () => {
    expect(checksReady(gates(["N/A", "N/A"]))).toBe(false);
    expect(checksReady(undefined)).toBe(false);
  });
});

describe("adding up the rows shown", () => {
  it("rounds half up exactly like the backend's pct (test_readiness_rollup.py)", () => {
    expect(pct(1, 8)).toBe(13);
    expect(pct(5, 6)).toBe(83);
    expect(pct(2, 3)).toBe(67);
    expect(pct(0, 4)).toBe(0);
    expect(pct(3, 0)).toBeNull();
  });

  it("sums the server's per-row figures into the three figures", () => {
    const f = sumFigures([
      { counted: 6, done: 3, in_progress: 2, behind: 1, ready: false },
      { counted: 7, done: 7, in_progress: 0, behind: 0, ready: true },
      { counted: 0, done: 0, in_progress: 0, behind: 0, na: 7, ready: false }, // all N/A
    ]);
    expect(f).toMatchObject({
      targets: 3, complete_pct: 77, on_track_pct: 92, behind: 1, na: 7, ready: 1, ready_of: 2,
    });
    expect(sumFigures([]).complete_pct).toBeNull();
  });

  it("a team's unticked checks reach the sum only as not applicable (spec §3.7, §3.8)", () => {
    // Two Logistics wells as served: one with NAV unticked (Behind underneath —
    // the server already left it out), one where nothing applies.
    const f = sumFigures([
      { counted: 2, done: 1, in_progress: 1, behind: 0, na: 1, ready: false },
      { counted: 0, done: 0, in_progress: 0, behind: 0, na: 3, ready: false },
    ]);
    expect(f).toMatchObject({
      targets: 2, counted: 2, behind: 0, na: 4, complete_pct: 50, on_track_pct: 100, ready: 0, ready_of: 1,
    });
    // Nothing applies anywhere → nothing to count: "—", never 0%.
    expect(sumFigures([{ counted: 0, done: 0, in_progress: 0, behind: 0, na: 6, ready: false }])).toMatchObject({
      complete_pct: null, on_track_pct: null, ready_of: 0,
    });
  });
});

describe("the year range", () => {
  const NOW = new Date("2026-11-24T12:00:00");

  it("opens on this year and the next two", () => {
    expect(defaultYearRange(NOW)).toEqual({ from: 2026, years: 3 });
    expect(yearsOf({ from: 2026, years: 3 })).toEqual([2026, 2027, 2028]);
    expect(yearsOf({ from: 2030, years: 1 })).toEqual([2030]);
  });

  it("needs work left, and a spud inside the years shown", () => {
    const range = { from: 2026, years: 2 };
    expect(inYears({ focus_start: null }, range)).toBe(false); // completed / opted out
    expect(inYears({ focus_start: "2026-01-01" }, range)).toBe(true);
    expect(inYears({ focus_start: "2027-12-31" }, range)).toBe(true);
    expect(inYears({ focus_start: "2028-01-01" }, range)).toBe(false);
    // Work that spud before the range is hidden until the range is moved back.
    expect(inYears({ focus_start: "2025-12-31" }, range)).toBe(false);
    expect(inYears({ focus_start: "2025-12-31" }, { from: 2025, years: 1 })).toBe(true);
  });

  it("shows one to three years, never more", () => {
    expect(clampYearRange({ from: 2026, years: 5 })).toEqual({ from: 2026, years: 3 });
    expect(clampYearRange({ from: 2026, years: 0 })).toEqual({ from: 2026, years: 1 });
    expect(clampYearRange({ from: 1200, years: 2 })).toEqual({ from: 2000, years: 2 });
    expect(clampYearRange({ from: 2100, years: 3 })).toEqual({ from: 2098, years: 3 });
  });

  it("reads ?from= and ?years=, falling back to the default for anything invalid", () => {
    expect(parseYearRange("2028", "1", NOW)).toEqual({ from: 2028, years: 1 });
    expect(parseYearRange(null, null, NOW)).toEqual({ from: 2026, years: 3 });
    expect(parseYearRange("abc", "7", NOW)).toEqual({ from: 2026, years: 3 });
    expect(parseYearRange("2027", null, NOW)).toEqual({ from: 2027, years: 3 });
  });

  it("words a range and builds its query", () => {
    expect(rangePhrase({ from: 2026, years: 1 })).toBe("2026");
    expect(rangePhrase({ from: 2026, years: 3 })).toBe("2026–2028");
    expect(rangeQuery({ from: 2027, years: 2 })).toBe("from_year=2027&years=2");
  });

  it("derives a focus start like the backend: unfinished, readiness-required work", () => {
    expect(
      focusStartOf([
        { start_date: "2026-01-01", completed_at: "2026-02-01T00:00:00Z" },
        { start_date: "2026-03-01", readiness_required: false },
        { start_date: "2026-05-01" },
        { start_date: "2026-04-01" },
      ]),
    ).toBe("2026-04-01");
    expect(focusStartOf([{ start_date: "2026-01-01", completed_at: "2026-02-01T00:00:00Z" }])).toBeNull();
  });

});

