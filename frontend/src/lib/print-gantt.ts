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

/** Where a bar's well-name label sits relative to the bar. */
export type LabelSide = "inside" | "left" | "right" | "none";

export interface BarLabelPlacement {
  side: LabelSide;
  /** The label's max width, as a percentage of the window. For "inside" it is the
   *  bar's own width; for "left"/"right" it is the clamped gap to the neighbour. */
  maxWidthPct: number;
}

/**
 * Decide where a print-Gantt bar's well-name label goes.
 *
 * A bar wide enough keeps the name INSIDE it (white on the bar, as before). When
 * the bar is too narrow to show a useful chunk of its name, the name spills into
 * the empty lane BESIDE the bar — the side with the larger gap — clamped to the
 * distance to the neighbouring bar so it can never overlap it. When neither side
 * has room for even a few characters the label is dropped; the schedule table is
 * the complete cross-reference for those.
 *
 * Everything is a percentage of the window width (matching how the print Gantt
 * positions bars), so there are no pixels here and it stays unit-testable.
 *
 * @param leftPct      bar's left edge (% of window)
 * @param rightPct     bar's right edge (% of window)
 * @param prevRightPct right edge of the previous bar on the row, or 0 if none
 * @param nextLeftPct  left edge of the next bar on the row, or 100 if none
 * @param insideMinPct bar widths >= this keep the label inside
 * @param minSidePct   smallest spill gap worth labelling; below it → "none"
 * @param gapPadPct    padding kept between the label and the neighbouring bar
 */
export function placeBarLabel({
  leftPct,
  rightPct,
  prevRightPct,
  nextLeftPct,
  insideMinPct,
  minSidePct,
  gapPadPct,
}: {
  leftPct: number;
  rightPct: number;
  prevRightPct: number;
  nextLeftPct: number;
  insideMinPct: number;
  minSidePct: number;
  gapPadPct: number;
}): BarLabelPlacement {
  const barWidth = rightPct - leftPct;
  if (barWidth >= insideMinPct) {
    return { side: "inside", maxWidthPct: barWidth };
  }
  const gapRight = Math.max(0, nextLeftPct - rightPct - gapPadPct);
  const gapLeft = Math.max(0, leftPct - prevRightPct - gapPadPct);
  if (Math.max(gapRight, gapLeft) < minSidePct) {
    return { side: "none", maxWidthPct: 0 };
  }
  // Prefer the right lane on a tie — text reads left-to-right into open space.
  return gapRight >= gapLeft
    ? { side: "right", maxWidthPct: gapRight }
    : { side: "left", maxWidthPct: gapLeft };
}
