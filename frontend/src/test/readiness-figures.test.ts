import { describe, expect, it } from "vitest";
import { READINESS_FIGURES_HINT, readinessSubline } from "@/lib/readiness-figures";
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
