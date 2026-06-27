import { describe, it, expect } from "vitest";
import { worstCheck, iconTier, tagFits } from "@/lib/chart-layout";

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
