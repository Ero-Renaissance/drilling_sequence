import { useMemo } from "react";

import { computeScaleTicks, todayLabel, todayPct } from "@/lib/time-scale";

/**
 * The sticky timescale that rides above the sequence chart: month/year ticks
 * plus a dated "Today" flag, pinned to the top of the scroll container while
 * the tall Gantt scrolls beneath. Positions come as percentages of the
 * chart's visible window; the pixel inset (`left`/`width`) mirrors the plot
 * area so ticks sit exactly over the chart's own gridlines, and `scrollLeft`
 * keeps them aligned when the chart is scrolled horizontally on narrow
 * screens.
 */
export function TimeScaleStrip({
  vs,
  ve,
  left,
  width,
  scrollLeft,
}: {
  vs: number;
  ve: number;
  left: number;
  width: number;
  scrollLeft: number;
}) {
  const ticks = useMemo(() => computeScaleTicks(vs, ve), [vs, ve]);
  const now = Date.now();
  const tp = todayPct(vs, ve, now);

  return (
    <div data-testid="time-scale-strip" className="sticky top-0 z-20">
      <div className="overflow-hidden rounded-lg border border-border/70 bg-card/95 shadow-soft-sm backdrop-blur">
        <div
          className="relative h-8"
          style={{ marginLeft: left - scrollLeft, width }}
        >
          {ticks.map((t) => (
            <span
              key={t.ts}
              className="absolute top-0 h-full"
              style={{ left: `${t.pct}%` }}
            >
              <span aria-hidden className="absolute left-0 top-0 h-full w-px bg-border/70" />
              <span className="absolute left-1.5 top-1/2 -translate-y-1/2 whitespace-nowrap text-[10px] leading-none text-muted-foreground">
                {t.label}
              </span>
            </span>
          ))}
          {tp !== null && (
            <span className="absolute top-0 h-full" style={{ left: `${tp}%` }}>
              <span
                aria-hidden
                className="absolute left-0 top-0 h-full w-0 border-l-2 border-dashed border-red-500/80"
              />
              <span className="absolute left-1.5 top-1/2 z-10 -translate-y-1/2 whitespace-nowrap rounded border border-red-500/40 bg-card px-1.5 py-0.5 text-[10px] font-semibold leading-none text-red-500">
                {todayLabel(now)}
              </span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
