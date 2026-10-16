import { describe, expect, it } from "vitest";
import {
  READINESS_FIGURES_HINT,
  pct,
  readinessSubline,
  sumFigures,
} from "@/lib/readiness-figures";
import { focusStartOf, inWindow, parseWindow } from "@/lib/readiness-window";
import { checksReady } from "@/lib/watchlist";

// docs/readiness-framework-spec.md §3.7 — the frontend formats the backend's
// figures and decides "ready" for drill-throughs the same way the backend does.

describe("readiness figures", () => {
  it("words the spec's worked example", () => {
    expect(readinessSubline({ on_track_pct: 83, behind: 1, ready: 0, ready_of: 1 })).toBe(
      "complete · 83% on track · 1 behind · 0/1 ready",
    );
    expect(readinessSubline({ on_track_pct: 70, behind: 3, ready: 1, ready_of: 4 }, "wells")).toBe(
      "complete · 70% on track · 3 behind · 1/4 wells ready",
    );
  });

  it("says nothing counts rather than 0%", () => {
    expect(readinessSubline({ on_track_pct: null, behind: 0, ready: 0, ready_of: 0 })).toBe(
      "Nothing to count",
    );
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
});

describe("the window", () => {
  const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

  it("needs work left, and a start inside the window", () => {
    expect(inWindow({ focus_start: null }, 0)).toBe(false); // completed / opted out
    expect(inWindow({ focus_start: inDays(-30) }, 6)).toBe(true); // overdue work still counts
    expect(inWindow({ focus_start: inDays(100) }, 6)).toBe(true);
    expect(inWindow({ focus_start: inDays(400) }, 12)).toBe(false);
    expect(inWindow({ focus_start: inDays(4000) }, 0)).toBe(true); // All
  });

  it("prefers the server's days-to-start (its calendar, as the tile uses)", () => {
    // The browser's date would say 366 days; the server says 365 — the server wins.
    expect(inWindow({ focus_start: inDays(366), focus_in_days: 365 }, 12)).toBe(true);
    expect(inWindow({ focus_start: inDays(300), focus_in_days: 366 }, 12)).toBe(false);
    expect(inWindow({ focus_in_days: -10 }, 6)).toBe(true);
    expect(inWindow({ focus_in_days: null, focus_start: null }, 0)).toBe(false);
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

  it("only accepts the tiles' windows", () => {
    expect([parseWindow("6"), parseWindow("12"), parseWindow("24")]).toEqual([6, 12, 24]);
    expect([parseWindow(null), parseWindow("7"), parseWindow("abc")]).toEqual([0, 0, 0]);
  });
});
