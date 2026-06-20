import { describe, it, expect } from "vitest";
import {
  monthFloor,
  monthCeil,
  computeFittedWindows,
  computeYearSpans,
  placeBarLabel,
} from "@/lib/print-gantt";

// Local-constructed timestamps (month is 1-based here for readability) so the
// assertions are timezone-independent — the functions use local getFullYear/
// getMonth, and so do these inputs.
const ms = (y: number, m: number, d: number) => new Date(y, m - 1, d).getTime();
const ymd = (dt: Date) => [dt.getFullYear(), dt.getMonth() + 1, dt.getDate()];

describe("monthFloor / monthCeil", () => {
  it("floors to the first of the month", () => {
    expect(ymd(monthFloor(ms(2026, 7, 10)))).toEqual([2026, 7, 1]);
  });
  it("ceils to the first of the next month", () => {
    expect(ymd(monthCeil(ms(2026, 7, 25)))).toEqual([2026, 8, 1]);
  });
  it("ceils a year boundary into the next year", () => {
    expect(ymd(monthCeil(ms(2026, 12, 3)))).toEqual([2027, 1, 1]);
  });
});

describe("computeFittedWindows", () => {
  it("returns nothing for no activities", () => {
    expect(computeFittedWindows([], 2)).toEqual([]);
  });

  it("fits a single short activity to its own month, not the calendar year", () => {
    const w = computeFittedWindows([{ s: ms(2026, 7, 10), e: ms(2026, 7, 25) }], 2);
    expect(w).toHaveLength(1);
    expect(ymd(w[0].from)).toEqual([2026, 7, 1]);
    expect(ymd(w[0].to)).toEqual([2026, 8, 1]);
  });

  it("fits a multi-month campaign to its span", () => {
    const w = computeFittedWindows([{ s: ms(2026, 2, 3), e: ms(2026, 11, 20) }], 2);
    expect(w).toHaveLength(1);
    expect(ymd(w[0].from)).toEqual([2026, 2, 1]);
    expect(ymd(w[0].to)).toEqual([2026, 12, 1]);
  });

  it("fits a window that crosses a calendar year", () => {
    const w = computeFittedWindows([{ s: ms(2026, 3, 15), e: ms(2027, 2, 10) }], 2);
    expect(w).toHaveLength(1);
    expect(ymd(w[0].from)).toEqual([2026, 3, 1]);
    expect(ymd(w[0].to)).toEqual([2027, 3, 1]);
  });

  it("drops empty chunks between sparse activities (windowYears=1)", () => {
    const w = computeFittedWindows(
      [
        { s: ms(2026, 4, 1), e: ms(2026, 5, 1) },
        { s: ms(2029, 3, 1), e: ms(2029, 4, 1) },
      ],
      1,
    );
    // 2027 and 2028 are empty → only two windows, no blank pages.
    expect(w).toHaveLength(2);
    expect(w[0].from.getFullYear()).toBe(2026);
    expect(w[1].from.getFullYear()).toBe(2029);
  });

  it("clamps a window to its chunk when data spills past the boundary", () => {
    // windowYears=1: an activity straddling 2026→2027 is split, each side
    // clamped to the calendar boundary (Jan 1).
    const w = computeFittedWindows([{ s: ms(2026, 11, 1), e: ms(2027, 2, 1) }], 1);
    expect(w).toHaveLength(2);
    expect(ymd(w[0].to)).toEqual([2027, 1, 1]); // first window clamped to chunk end
    expect(ymd(w[1].from)).toEqual([2027, 1, 1]); // second window clamped to chunk start
  });
});

describe("computeYearSpans", () => {
  it("yields a single full-width span for a sub-year window", () => {
    const spans = computeYearSpans(new Date(2026, 6, 1), new Date(2026, 7, 1));
    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({ y: 2026, left: 0 });
    expect(spans[0].width).toBeCloseTo(100, 5);
  });

  it("splits a year-crossing window into two adjacent slices summing to 100%", () => {
    const spans = computeYearSpans(new Date(2026, 2, 1), new Date(2027, 2, 1));
    expect(spans.map((s) => s.y)).toEqual([2026, 2027]);
    expect(spans[0].left).toBe(0);
    expect(spans[1].left).toBeCloseTo(spans[0].width, 5); // adjacent, no gap
    expect(spans[0].width + spans[1].width).toBeCloseTo(100, 5);
  });

  it("guards a zero/negative-span window", () => {
    expect(computeYearSpans(new Date(2026, 0, 1), new Date(2026, 0, 1))).toEqual([]);
  });
});

describe("placeBarLabel", () => {
  // Shared thresholds mirroring the readiness-chart constants.
  const opts = { insideMinPct: 10, minSidePct: 4, gapPadPct: 0.5 };

  it("keeps the label inside a wide-enough bar", () => {
    const p = placeBarLabel({ leftPct: 10, rightPct: 30, prevRightPct: 0, nextLeftPct: 100, ...opts });
    expect(p).toEqual({ side: "inside", maxWidthPct: 20 });
  });

  it("spills into the larger (right) gap, clamped to it, when the bar is narrow", () => {
    const p = placeBarLabel({ leftPct: 10, rightPct: 14, prevRightPct: 0, nextLeftPct: 60, ...opts });
    // gapRight = 60-14-0.5 = 45.5, gapLeft = 10-0-0.5 = 9.5 → right
    expect(p.side).toBe("right");
    expect(p.maxWidthPct).toBeCloseTo(45.5, 5);
  });

  it("flips to the left when the bar hugs the right edge", () => {
    const p = placeBarLabel({ leftPct: 90, rightPct: 94, prevRightPct: 50, nextLeftPct: 100, ...opts });
    // gapRight = 100-94-0.5 = 5.5, gapLeft = 90-50-0.5 = 39.5 → left
    expect(p.side).toBe("left");
    expect(p.maxWidthPct).toBeCloseTo(39.5, 5);
  });

  it("prefers the right lane on a tie", () => {
    // gapLeft = 40-20.5-0.5 = 19, gapRight = 63.5-44-0.5 = 19 → tie → right
    const p = placeBarLabel({ leftPct: 40, rightPct: 44, prevRightPct: 20.5, nextLeftPct: 63.5, ...opts });
    expect(p.side).toBe("right");
  });

  it("drops the label when packed between neighbours on both sides", () => {
    const p = placeBarLabel({ leftPct: 50, rightPct: 53, prevRightPct: 49.8, nextLeftPct: 53.2, ...opts });
    expect(p).toEqual({ side: "none", maxWidthPct: 0 });
  });

  it("drops the label when the best gap is positive but below the minimum", () => {
    // gapRight = 16-13-0.5 = 2.5, gapLeft = 10-8-0.5 = 1.5 → best 2.5 < 4 → none
    const p = placeBarLabel({ leftPct: 10, rightPct: 13, prevRightPct: 8, nextLeftPct: 16, ...opts });
    expect(p.side).toBe("none");
  });
});
