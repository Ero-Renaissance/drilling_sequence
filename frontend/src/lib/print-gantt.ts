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

// Estimated rendered width of a well-name label, as a % of the window. The print
// page always renders at the same physical width no matter how many months the
// window spans, so %-per-character is a stable constant. Calibrated for the
// readiness bars' 6px font: ~0.5%/char reads slightly generous, which errs
// toward spilling a borderline name rather than truncating it inside the bar.
const NAME_CHAR_PCT = 0.5;
// Flat allowance for the bar's own padding and the flood droplet.
const NAME_PAD_PCT = 1;

/** Estimated width (% of window) a well-name label needs to render untruncated. */
export function estimateNamePct(name: string): number {
  return name.length * NAME_CHAR_PCT + NAME_PAD_PCT;
}

/**
 * Decide where a print-Gantt bar's well-name label goes.
 *
 * The name stays INSIDE the bar (white on the bar, as before) when the bar is
 * wide enough for THIS name — the test is text-aware, so a short name like
 * "KOCR 9" rides a modest bar while a long one spills. A fixed-width threshold
 * here misfires both ways: it evicts short names from bars with plenty of room
 * and truncates long names that technically pass. When the name doesn't fit, it
 * spills into the empty lane BESIDE the bar — the side with the larger gap —
 * clamped to the distance to the neighbouring bar so it can never overlap it.
 * When neither side has room for even a few characters the label is dropped;
 * the schedule table is the complete cross-reference for those.
 *
 * Everything is a percentage of the window width (matching how the print Gantt
 * positions bars), so there are no pixels here and it stays unit-testable.
 *
 * @param leftPct      bar's left edge (% of window)
 * @param rightPct     bar's right edge (% of window)
 * @param prevRightPct right edge of the previous bar on the row, or 0 if none
 * @param nextLeftPct  left edge of the next bar on the row, or 100 if none
 * @param nameLenPct   estimated width of this bar's name (see estimateNamePct)
 * @param insideMinPct absolute floor: a bar narrower than this never labels
 *                     inside, however short its name (a sliver can't carry text)
 * @param minSidePct   smallest spill gap worth labelling; below it → "none"
 * @param gapPadPct    padding kept between the label and the neighbouring bar
 */
export function placeBarLabel({
  leftPct,
  rightPct,
  prevRightPct,
  nextLeftPct,
  nameLenPct,
  insideMinPct,
  minSidePct,
  gapPadPct,
}: {
  leftPct: number;
  rightPct: number;
  prevRightPct: number;
  nextLeftPct: number;
  nameLenPct: number;
  insideMinPct: number;
  minSidePct: number;
  gapPadPct: number;
}): BarLabelPlacement {
  const barWidth = rightPct - leftPct;
  if (barWidth >= Math.max(insideMinPct, nameLenPct)) {
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


// ── Years-per-page → paper matching (readiness print) ────────────────────────

export type PrintYears = 1 | 2 | 3;

/**
 * Paper size for the readiness print, matched to years-per-page: 1yr on A4
 * (office printer), 2yr on A3, and 3yr jumps to A0 — the plotter poster the
 * planning wall uses. A0 is 4× the width of A4, so 36 months across it are
 * MORE legible than 12 on A4, not less. This is the display label; the CSS
 * value the browser needs is `readinessPageCss` (A0 is not a CSS keyword).
 * The standard (JV record) chart is NOT covered here — it stays a fixed A4
 * 2-year document; changing the formal record's format is a separate decision.
 */
export function readinessPaperSize(years: PrintYears): "A4" | "A3" | "A0" {
  return years === 1 ? "A4" : years === 2 ? "A3" : "A0";
}

/**
 * The `@page size:` value for the readiness print. CSS Paged Media only
 * defines keywords down to A3 — `size: A0 landscape` is invalid and the
 * browser would silently fall back to the printer default — so A0 is emitted
 * as explicit landscape dimensions (width height).
 */
export function readinessPageCss(years: PrintYears): string {
  return years === 3 ? "1189mm 841mm" : `${readinessPaperSize(years)} landscape`;
}

/**
 * Rig rows per readiness page, scaled with the paper's landscape HEIGHT at a
 * constant ~26mm row pitch after the fixed header/legend overhead: A4 210mm
 * → 6, A3 297mm → 9, A0 841mm → 30 (a whole campaign on one sheet).
 */
export function readinessRowsPerPage(years: PrintYears): number {
  return years === 1 ? 6 : years === 2 ? 9 : 30;
}
