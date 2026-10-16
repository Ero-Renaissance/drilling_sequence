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

/** Whether a target with this `focus_start` is in scope for the window. */
export function inWindow(focusStart: string | null | undefined, months: number): boolean {
  if (!focusStart) return false; // nothing left to be ready for
  const days = HORIZON_DAYS[months];
  if (!days) return true; // All
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() + days);
  return new Date(`${focusStart}T00:00:00`).getTime() <= cutoff.getTime();
}

/** "next 12 months" / "all" — for scope lines. */
export function windowPhrase(months: number): string {
  return months === 0 ? "all" : `next ${months} months`;
}
