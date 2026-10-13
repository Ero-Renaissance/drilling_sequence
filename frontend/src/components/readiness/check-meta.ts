import type { CheckStatus } from "@/api/readiness";

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
};
