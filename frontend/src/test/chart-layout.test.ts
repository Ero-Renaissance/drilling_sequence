import { describe, it, expect } from "vitest";
import { barStripCodes, worstCheck, iconTier, siblingMarker, tagFits } from "@/lib/chart-layout";

describe("iconTier", () => {
  it("picks the strip tier by bar width, at the exact thresholds", () => {
    expect(iconTier(200)).toBe("full");
    expect(iconTier(135)).toBe("full");
    expect(iconTier(134)).toBe("half");
    expect(iconTier(90)).toBe("half");
    expect(iconTier(89)).toBe("grid");
    expect(iconTier(45)).toBe("grid");
    expect(iconTier(44)).toBe("single");
    expect(iconTier(0)).toBe("single");
  });
});

describe("tagFits", () => {
  it("fits a short tag on a wide bar", () => {
    expect(tagFits("PROJECT_2", 120)).toBe(true);
  });
  it("does not fit a long tag on a narrow bar", () => {
    expect(tagFits("Deepwater Block 17 Phase 2", 60)).toBe(false);
  });
  it("uses the ~6px/char + 10px padding estimate at the boundary", () => {
    // "ABCDE" → 5*6 + 10 = 40
    expect(tagFits("ABCDE", 40)).toBe(true);
    expect(tagFits("ABCDE", 39)).toBe(false);
  });
});

describe("worstCheck", () => {
  it("returns null for no checks", () => {
    expect(worstCheck(null)).toBeNull();
    expect(worstCheck(undefined)).toBeNull();
    expect(worstCheck({})).toBeNull();
  });

  it("picks Behind over less-severe statuses", () => {
    const w = worstCheck({
      FDP: { status: "Completed" },
      LLI: { status: "Behind" },
      LOC: { status: "On Track" },
    });
    expect(w).toEqual({ code: "LLI", status: "Behind" });
  });

  it("ranks On Track above Completed", () => {
    expect(worstCheck({ FDP: { status: "Completed" }, LLI: { status: "On Track" } })?.status).toBe(
      "On Track",
    );
  });

  it("treats N/A as the least concerning", () => {
    expect(worstCheck({ FDP: { status: "N/A" }, LLI: { status: "Completed" } })?.status).toBe(
      "Completed",
    );
  });
});

describe("barStripCodes", () => {
  const strip = ["projects", "wells", "logistics"];

  it("draws every check of a team lens, set or not (unset gates show their default)", () => {
    expect(barStripCodes(strip, { projects: { status: "Behind" } }, false)).toEqual(strip);
  });

  it("drops a team with no readiness for the activity under the All lens", () => {
    // A well without a field project: no Project gates badge, only Logistics.
    expect(barStripCodes(strip, { logistics: { status: "Not available" } }, true)).toEqual([
      "logistics",
    ]);
    expect(barStripCodes(strip, {}, true)).toEqual([]);
  });

  it("keeps the strip order under the All lens", () => {
    const checks = { logistics: { status: "Available" }, projects: { status: "On Track" } };
    expect(barStripCodes(strip, checks, true)).toEqual(["projects", "logistics"]);
  });
});


describe("siblingMarker — a project's other bars flag only blocked checks", () => {
  it("flags Behind and Not available alike (severity, not status text)", () => {
    expect(siblingMarker({ FDP: { status: "Behind" } })).toEqual({ code: "FDP", status: "Behind" });
    expect(siblingMarker({ NEQ: { status: "Not available" } })).toEqual({
      code: "NEQ",
      status: "Not available",
    });
  });

  it("still flags when an earlier blocked check ties a later Behind", () => {
    // NEQ comes first in catalog order — the old literal "Behind" test hid PO.
    expect(
      siblingMarker({ NEQ: { status: "Not available" }, PO: { status: "Behind" } }, ["NEQ", "PO"]),
    ).toEqual({ code: "NEQ", status: "Not available" });
  });

  it("stays silent while nothing is blocked", () => {
    expect(
      siblingMarker({ FDP: { status: "On Track" }, NEQ: { status: "Pending" }, BUD: { status: "Completed" } }),
    ).toBeNull();
    expect(siblingMarker(null)).toBeNull();
  });
});
