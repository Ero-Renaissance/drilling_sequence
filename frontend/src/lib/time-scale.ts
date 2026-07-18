/**
 * Tick math for the sticky timescale strip that rides above the sequence
 * chart. Pure functions over the chart's visible window (epoch ms), so the
 * "which months/years get labelled" decisions are unit-tested without
 * rendering ECharts — the strip component only positions what this emits.
 */

export type ScaleUnit = "month" | "year";

const DAY = 86_400_000;

/** Month ticks while the window is ≲2 years, year ticks beyond — the same
 *  break the chart's background bands use, so strip and bands always agree. */
export function scaleUnit(vs: number, ve: number): ScaleUnit {
  return (ve - vs) / DAY <= 800 ? "month" : "year";
}

export interface ScaleTick {
  ts: number;
  /** Position across the window, 0–100 (%). */
  pct: number;
  label: string;
}

/**
 * Calendar boundaries (first-of-month / Jan-1) inside [vs, ve), each with its
 * % position. A crowded month scale (>14 ticks) thins to quarter starts so
 * labels never overlap; the chart below still shows every month band.
 */
export function computeScaleTicks(vs: number, ve: number): ScaleTick[] {
  if (!(ve > vs)) return [];
  const unit = scaleUnit(vs, ve);
  const span = ve - vs;
  const first = new Date(vs);
  let cur =
    unit === "month"
      ? new Date(first.getFullYear(), first.getMonth(), 1)
      : new Date(first.getFullYear(), 0, 1);
  const step = (d: Date) =>
    unit === "month"
      ? new Date(d.getFullYear(), d.getMonth() + 1, 1)
      : new Date(d.getFullYear() + 1, 0, 1);
  if (cur.getTime() < vs) cur = step(cur);

  const ticks: ScaleTick[] = [];
  while (cur.getTime() < ve) {
    const ts = cur.getTime();
    ticks.push({
      ts,
      pct: ((ts - vs) / span) * 100,
      label:
        unit === "month"
          ? `${cur.toLocaleString("default", { month: "short" })} ${cur.getFullYear()}`
          : String(cur.getFullYear()),
    });
    cur = step(cur);
  }
  if (unit === "month" && ticks.length > 14) {
    return ticks.filter((t) => new Date(t.ts).getMonth() % 3 === 0);
  }
  return ticks;
}

/** Where "today" sits in the window (0–100 %), or null when it's outside. */
export function todayPct(vs: number, ve: number, now: number): number | null {
  if (now < vs || now > ve || !(ve > vs)) return null;
  return ((now - vs) / (ve - vs)) * 100;
}

/** "Today · 18 Jul 2026" — the flag carries the actual date; that is the
 *  point of a reference line. */
export function todayLabel(now: number): string {
  const d = new Date(now);
  return `Today · ${d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })}`;
}
