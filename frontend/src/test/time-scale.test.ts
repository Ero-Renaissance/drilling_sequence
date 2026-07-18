import { describe, expect, it } from "vitest";

import { computeScaleTicks, scaleUnit, todayLabel, todayPct } from "@/lib/time-scale";

const ts = (y: number, m = 0, d = 1) => new Date(y, m, d).getTime();

describe("scaleUnit", () => {
  it("uses months up to ~2 years and years beyond — the bands' break", () => {
    expect(scaleUnit(ts(2026), ts(2027))).toBe("month");
    expect(scaleUnit(ts(2026), ts(2028, 2))).toBe("month"); // ~790 days
    expect(scaleUnit(ts(2026), ts(2029))).toBe("year");
  });
});

describe("computeScaleTicks", () => {
  it("emits first-of-month ticks with combined labels inside a 1-year window", () => {
    const ticks = computeScaleTicks(ts(2026, 0, 15), ts(2026, 6, 15));
    expect(ticks.map((t) => t.label)).toEqual([
      "Feb 2026", "Mar 2026", "Apr 2026", "May 2026", "Jun 2026", "Jul 2026",
    ]);
    // Positions are strictly increasing percentages within (0, 100).
    const pcts = ticks.map((t) => t.pct);
    expect(Math.min(...pcts)).toBeGreaterThan(0);
    expect(Math.max(...pcts)).toBeLessThan(100);
    expect([...pcts].sort((a, b) => a - b)).toEqual(pcts);
  });

  it("a window starting exactly on a boundary includes that boundary at 0%", () => {
    const ticks = computeScaleTicks(ts(2026), ts(2026, 6));
    expect(ticks[0]).toMatchObject({ label: "Jan 2026", pct: 0 });
  });

  it("thins a crowded month scale to quarter starts", () => {
    const ticks = computeScaleTicks(ts(2026), ts(2028)); // 24 months
    expect(ticks.length).toBe(8); // Jan/Apr/Jul/Oct × 2 years
    expect(ticks.every((t) => new Date(t.ts).getMonth() % 3 === 0)).toBe(true);
    expect(ticks[0].label).toBe("Jan 2026");
  });

  it("switches to year labels on wide windows", () => {
    const ticks = computeScaleTicks(ts(2026), ts(2033));
    expect(ticks.map((t) => t.label)).toEqual(
      ["2026", "2027", "2028", "2029", "2030", "2031", "2032"],
    );
  });

  it("degenerate or inverted windows yield no ticks", () => {
    expect(computeScaleTicks(ts(2026), ts(2026))).toEqual([]);
    expect(computeScaleTicks(ts(2027), ts(2026))).toEqual([]);
  });
});

describe("today flag", () => {
  it("positions today inside the window and hides it outside", () => {
    const vs = ts(2026);
    const ve = ts(2027);
    const mid = new Date(2026, 6, 2).getTime();
    expect(todayPct(vs, ve, mid)).toBeCloseTo(49.8, 0);
    expect(todayPct(vs, ve, ts(2025, 11, 31))).toBeNull();
    expect(todayPct(vs, ve, ts(2027, 0, 2))).toBeNull();
  });

  it("labels the flag with the actual date", () => {
    expect(todayLabel(new Date(2026, 6, 18).getTime())).toBe("Today · 18 Jul 2026");
  });
});
