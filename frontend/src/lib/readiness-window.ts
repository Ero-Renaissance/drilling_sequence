/**
 * The readiness YEAR RANGE (spec §3.7, 2026-11-24): which field projects / wells
 * a figure and a grid cover. One definition for the Overview tiles and every
 * Readiness lens — the user shows 1 to 3 calendar years at a time, and a target
 * is IN RANGE when it has readiness-required work that isn't completed
 * (`focus_start`, computed server-side) starting within those years. The range
 * replaced the "next 6 / 12 / 24 months" window.
 */

/** Months → days for the Overview's activity-type mix card (its own duration
 *  picker) — identical to the backend's HORIZON_DAYS. */
export const HORIZON_DAYS: Record<number, number> = { 6: 183, 12: 365, 24: 730 };

/** At most this many years at a time (backend `MAX_RANGE_YEARS`). */
export const MAX_RANGE_YEARS = 3;
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

/** `years` (1–3) calendar years starting at `from`. */
export interface YearRange {
  from: number;
  years: number;
}

/** The range a page opens on: the current year and the next two. */
export function defaultYearRange(now: Date = new Date()): YearRange {
  return { from: now.getFullYear(), years: MAX_RANGE_YEARS };
}

/** A range clamped to what the server accepts (1–3 years, sane bounds). */
export function clampYearRange(range: YearRange): YearRange {
  const years = Math.min(MAX_RANGE_YEARS, Math.max(1, Math.trunc(range.years) || 1));
  const from = Math.min(MAX_YEAR - years + 1, Math.max(MIN_YEAR, Math.trunc(range.from)));
  return { from, years };
}

/** `?from=` / `?years=` → a range; anything missing or invalid falls back to
 *  the default for that part. */
export function parseYearRange(
  from: string | null,
  years: string | null,
  now: Date = new Date(),
): YearRange {
  const fallback = defaultYearRange(now);
  const f = from !== null && /^\d{4}$/.test(from) ? Number(from) : fallback.from;
  const y = years !== null && /^[1-3]$/.test(years) ? Number(years) : fallback.years;
  return clampYearRange({ from: f, years: y });
}

/** The calendar years a range shows, in order. */
export function yearsOf(range: YearRange): number[] {
  return Array.from({ length: range.years }, (_, i) => range.from + i);
}

/** "2026" or "2026–2028" — for labels and scope lines. */
export function rangePhrase(range: YearRange): string {
  const last = range.from + range.years - 1;
  return range.years === 1 ? String(range.from) : `${range.from}–${last}`;
}

/** The range as the readiness reads take it: `from_year=…&years=…`. */
export function rangeQuery(range: YearRange): string {
  return `from_year=${range.from}&years=${range.years}`;
}

/** Whether a target is in the range: it has readiness work left (a focus start)
 *  starting within the years shown. */
export function inYears(target: { focus_start?: string | null }, range: YearRange): boolean {
  if (!target.focus_start) return false; // nothing left to be ready for
  const year = Number(target.focus_start.slice(0, 4));
  return year >= range.from && year < range.from + range.years;
}

/** A target's focus start from its activities — mirrors the backend's
 *  `focus_start_of`: the earliest start among readiness-required, not completed
 *  activities; null when none (completed or opted out → in no window). */
export function focusStartOf(
  activities: readonly { start_date: string; completed_at?: string | null; readiness_required?: boolean }[],
): string | null {
  let first: string | null = null;
  for (const a of activities) {
    if (a.readiness_required === false || a.completed_at) continue;
    if (first === null || a.start_date < first) first = a.start_date;
  }
  return first;
}

