/**
 * The readiness window (spec §3.7): which field projects / wells a figure and a
 * grid cover. One definition for the Overview tiles and every Readiness lens —
 * a target is IN SCOPE when it has readiness-required work that isn't completed
 * (`focus_start`, computed server-side) starting on/before today + the window.
 * "All" (0) drops the date limit but still needs work left to do.
 */

/** Window months → days — identical to the backend's HORIZON_DAYS. */
export const HORIZON_DAYS: Record<number, number> = { 6: 183, 12: 365, 24: 730 };

/** The windows a user can pick; 0 = All. */
export const WINDOW_MONTHS = [0, 6, 12, 24] as const;

/** `?horizon=` → months (anything else → 0, All). */
export function parseWindow(param: string | null): number {
  const n = Number(param);
  return n in HORIZON_DAYS ? n : 0;
}

/** A target's window signal: the server's days-to-focus-start when it sent them
 *  (the server's calendar — what the Overview tile uses), else its focus start. */
export interface WindowTarget {
  focus_in_days?: number | null;
  focus_start?: string | null;
}

/** Whether a target is in scope for the window: it has readiness work left
 *  (a focus start) starting on/before today + the window. */
export function inWindow(target: WindowTarget, months: number): boolean {
  const days = HORIZON_DAYS[months];
  if (typeof target.focus_in_days === "number") {
    return !days || target.focus_in_days <= days;
  }
  if (!target.focus_start) return false; // nothing left to be ready for
  if (!days) return true; // All
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() + days);
  return new Date(`${target.focus_start}T00:00:00`).getTime() <= cutoff.getTime();
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

/** "next 12 months" / "all" — for scope lines. */
export function windowPhrase(months: number): string {
  return months === 0 ? "all" : `next ${months} months`;
}
