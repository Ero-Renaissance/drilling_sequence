/**
 * Pure time-window math for the static print Gantt, extracted from
 * RevisionPrintDoc. These are the most-iterated decisions in the print-out
 * (fitting each page's window to the data, laying out the year axis), so they
 * live here as framework-free functions that can be unit-tested without
 * rendering a PDF — closing the "eyeball the print" verification gap for the
 * logic, if not yet the pixels.
 */

/** First day of the month containing `t` — snaps a fitted window's start to a
 *  clean month boundary so the month axis bands line up at the left edge. */
export function monthFloor(t: number): Date {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/** First day of the month *after* the one containing `t` — snaps a fitted
 *  window's end out to a clean month boundary so the last bar isn't flush-right. */
export function monthCeil(t: number): Date {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth() + 1, 1);
}

export interface TimeWindow {
  from: Date;
  to: Date;
}

/**
 * Paginate the timeline into chunks of at most `windowYears`, but fit each chunk
 * to the activities that actually fall in it (snapped out to whole months)
 * instead of the full calendar year(s) — so a short campaign fills the page
 * width rather than sitting in an empty Jan–Dec backdrop. Empty chunks are
 * dropped. Fitting is clamped to the chunk, so an activity spanning a boundary
 * is split across pages and a window never stretches past its chunk.
 *
 * `items` carry start/end as epoch milliseconds.
 */
export function computeFittedWindows(
  items: ReadonlyArray<{ s: number; e: number }>,
  windowYears: number,
): TimeWindow[] {
  if (items.length === 0) return [];
  const startYear = new Date(Math.min(...items.map((a) => a.s))).getFullYear();
  const endYear = new Date(Math.max(...items.map((a) => a.e))).getFullYear();

  const windows: TimeWindow[] = [];
  for (let y = startYear; y <= endYear; y += windowYears) {
    const cFrom = new Date(y, 0, 1).getTime();
    const cTo = new Date(y + windowYears, 0, 1).getTime();
    const inChunk = items.filter((a) => a.e > cFrom && a.s < cTo);
    if (inChunk.length === 0) continue;
    const lo = Math.min(...inChunk.map((a) => a.s));
    const hi = Math.max(...inChunk.map((a) => a.e));
    windows.push({
      from: lo <= cFrom ? new Date(cFrom) : monthFloor(lo),
      to: hi >= cTo ? new Date(cTo) : monthCeil(hi),
    });
  }
  return windows;
}

export interface YearSpan {
  /** The calendar year. */
  y: number;
  /** Left edge of the year's visible slice, as a percentage of the window. */
  left: number;
  /** Width of the visible slice, as a percentage of the window. */
  width: number;
}

/**
 * The calendar years a window touches, each as a percentage slice of the window
 * width — drives the centred year labels and the internal year gridlines on the
 * print axis. A sub-year window yields a single full-width span so the year
 * still reads even when no Jan-1 boundary falls inside it.
 */
export function computeYearSpans(from: Date, to: Date): YearSpan[] {
  const winStart = from.getTime();
  const winSpan = to.getTime() - winStart;
  if (winSpan <= 0) return [];
  // `to` is exclusive, so the last visible year is the one containing to − 1ms.
  const lastYear = new Date(to.getTime() - 1).getFullYear();

  const spans: YearSpan[] = [];
  for (let y = from.getFullYear(); y <= lastYear; y++) {
    const ys = Math.max(winStart, new Date(y, 0, 1).getTime());
    const ye = Math.min(to.getTime(), new Date(y + 1, 0, 1).getTime());
    if (ye <= ys) continue;
    spans.push({
      y,
      left: ((ys - winStart) / winSpan) * 100,
      width: ((ye - ys) / winSpan) * 100,
    });
  }
  return spans;
}
