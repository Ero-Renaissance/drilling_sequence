import type { Activity } from "@/api/activities";
import { detectRigConflicts } from "@/lib/conflicts";

// Watchlist "focus" filters — shared by the dashboard links and the grids that
// honour them. Definitions mirror backend/app/services/dashboard.py so the
// drilled-through list matches the count on the card.

export const NEAR_TERM_DAYS = 90;

export type FocusFilter =
  | "overdue"
  | "high-risk"
  | "conflicts"
  | "past-contract"
  | "not-ready";

export const FOCUS_LABEL: Record<FocusFilter, string> = {
  overdue: "Overdue — past their end date and not marked complete",
  "high-risk": "High-risk and starting within the next 90 days",
  conflicts: "Double-booked — sharing a rig with an overlapping activity",
  "past-contract": "Scheduled to run past the rig's contract end",
  "not-ready": "Starting within the next 90 days and not yet ready",
};

export function isFocusFilter(value: string | null): value is FocusFilter {
  return value !== null && value in FOCUS_LABEL;
}

function daysFromToday(dateStr: string): number {
  const d = new Date(dateStr + "T00:00:00").getTime();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((d - today.getTime()) / 86_400_000);
}

/** Start date within [today, today + 90 days]. */
export function isNearTerm(startDate: string): boolean {
  const n = daysFromToday(startDate);
  return n >= 0 && n <= NEAR_TERM_DAYS;
}

/** End date is before today. */
export function isOverdue(endDate: string): boolean {
  return daysFromToday(endDate) < 0;
}

/** Ready = ≥1 applicable (non-N/A) gate AND all applicable gates Completed. */
export function checksReady(
  checks: Record<string, { status: string }> | undefined,
): boolean {
  const applicable = Object.values(checks ?? {}).filter(
    (c) => c && c.status !== "N/A",
  );
  return applicable.length > 0 && applicable.every((c) => c.status === "Completed");
}

/** Activity ids involved in any same-rig overlap (completed work is excluded). */
export function conflictingActivityIds(activities: Activity[]): Set<string> {
  const ids = new Set<string>();
  for (const c of detectRigConflicts(activities)) {
    ids.add(c.a.id);
    ids.add(c.b.id);
  }
  return ids;
}
