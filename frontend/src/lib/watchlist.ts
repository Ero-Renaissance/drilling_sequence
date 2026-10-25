import type { Activity } from "@/api/activities";
import type { CheckStatus } from "@/api/readiness";
import { STATUS_SEVERITY } from "@/components/readiness/check-meta";
import { detectResourceConflicts } from "@/lib/conflicts";
import { ownValue } from "@/lib/own-key";

// Watchlist "focus" filters — shared by the dashboard links and the grids that
// honour them. Definitions mirror backend/app/services/dashboard.py so the
// drilled-through list matches the count on the card.

export const NEAR_TERM_DAYS = 90;

export type FocusFilter =
  | "overdue"
  | "flood-risk"
  | "conflicts"
  | "past-contract"
  | "not-ready";

export const FOCUS_LABEL: Record<FocusFilter, string> = {
  overdue: "Overdue — past their end date and not marked complete",
  "flood-risk": "Flood-risk and starting within the next 90 days",
  conflicts: "Double-booked — sharing a rig/HWU with an overlapping activity",
  "past-contract": "Scheduled to run past the resource's contract end",
  "not-ready": "Starting within the next 90 days and not yet ready",
};

/** Whether a `?focus=` value (straight from the URL) is one of the filters —
 *  FOCUS_LABEL's OWN keys only: `in` would also accept inherited Object members
 *  ("constructor", "__proto__"), whose "label" then crashes the grid's banner. */
export function isFocusFilter(value: string | null): value is FocusFilter {
  return value !== null && ownValue(FOCUS_LABEL, value) !== undefined;
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

/** Ready (spec §3.7) = ≥1 counted check AND every counted check done, by
 *  shared severity (N/A isn't counted). `checks` are effective values — an unset
 *  gate arrives as On Track, so it isn't ready. */
export function checksReady(
  checks: Record<string, { status: string }> | undefined,
): boolean {
  const severity = (status: string) => STATUS_SEVERITY[status as CheckStatus] ?? "in_progress";
  const counted = Object.values(checks ?? {}).filter(
    (c) => c && severity(c.status) !== "not_counted",
  );
  return counted.length > 0 && counted.every((c) => severity(c.status) === "done");
}

/** Activity ids in any same-resource (rig or HWU) overlap; completed work is excluded. */
export function conflictingActivityIds(activities: Activity[]): Set<string> {
  const ids = new Set<string>();
  for (const c of detectResourceConflicts(activities)) {
    ids.add(c.a.id);
    ids.add(c.b.id);
  }
  return ids;
}
