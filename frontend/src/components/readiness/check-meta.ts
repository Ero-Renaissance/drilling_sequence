import type { CheckStatus, Severity } from "@/api/readiness";

/**
 * How readiness STATUSES are presented. Which checks exist — and each check's
 * label and icon — now come from the readiness catalog (./catalog.tsx) and the
 * owned icon registry (./icon-registry.ts): shape (icon) encodes WHICH check,
 * color (per CheckStatus) encodes status.
 */

/**
 * Color applied to the icon stroke per status.
 *   On Track  → amber  (in flight, no problem)
 *   Completed → green  (done)
 *   Behind    → red    (slipping)
 *   N/A       → muted + strikethrough (does not apply)
 */
export const STATUS_ICON_COLOR: Record<CheckStatus, string> = {
  "On Track": "text-amber-500",
  Completed: "text-emerald-500",
  Behind: "text-red-500",
  "N/A": "text-zinc-300 dark:text-zinc-600 line-through",
  Available: "text-emerald-500",
  "Not available": "text-red-500",
};

/**
 * Solid status dot — used in the legend strip and as a sub-indicator alongside
 * the icon if we ever need both. Kept here so the legend stays in lockstep with
 * what cells render.
 */
export const STATUS_DOT: Record<CheckStatus, string> = {
  "On Track": "bg-amber-500",
  Completed: "bg-emerald-500",
  Behind: "bg-red-500",
  "N/A": "bg-white ring-1 ring-zinc-300 dark:bg-zinc-100 dark:ring-zinc-400",
  Available: "bg-emerald-500",
  "Not available": "bg-red-500",
};

/**
 * User-facing status label. The readiness model is On Track / Behind / Completed
 * (+ N/A, auto-derived), so the label is just the canonical value.
 */
export const STATUS_LABEL: Record<CheckStatus, string> = {
  "On Track": "On Track",
  Completed: "Completed",
  Behind: "Behind",
  "N/A": "N/A",
  Available: "Available",
  "Not available": "Not available",
};

/**
 * The code-defined status sets — mirrors `STATUS_SETS` in
 * backend/app/models/readiness.py (a backend test keeps the severities in step).
 * `statuses` is the picker order; colour follows the shared severity, so an
 * "Available" reads like "Completed" and "Not available" like "Behind".
 */
export const STATUS_SETS: Record<string, { statuses: CheckStatus[]; default: CheckStatus }> = {
  standard: { statuses: ["On Track", "Behind", "Completed", "N/A"], default: "On Track" },
  availability: { statuses: ["Available", "Not available"], default: "Not available" },
};

export const STATUS_SEVERITY: Record<CheckStatus, Severity> = {
  "On Track": "in_progress",
  Completed: "done",
  Behind: "blocked",
  "N/A": "not_counted",
  Available: "done",
  "Not available": "blocked",
};

/** A check's statuses in picker order (unknown set → standard). */
export function statusesOf(statusSet: string | undefined): CheckStatus[] {
  return (STATUS_SETS[statusSet ?? "standard"] ?? STATUS_SETS.standard).statuses;
}

/** What an unset entry of this status set reads as. */
export function defaultStatusOf(statusSet: string | undefined): CheckStatus {
  return (STATUS_SETS[statusSet ?? "standard"] ?? STATUS_SETS.standard).default;
}

/** The statuses to show in a legend for a set of checks (their status sets, in
 *  order, without repeats). */
export function legendStatuses(checks: { status_set: string }[]): CheckStatus[] {
  const sets = checks.length ? checks.map((c) => c.status_set) : ["standard"];
  return [...new Set(sets.flatMap((s) => statusesOf(s)))];
}
