import type { CatalogCheck, CheckStatus, Severity } from "@/api/readiness";

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
  Pending: "text-amber-500",
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
  Pending: "bg-amber-500",
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
  Pending: "Pending",
  "Not available": "Not available",
};

/**
 * The code-defined status sets — mirrors `STATUS_SETS` in
 * backend/app/models/readiness.py (a backend test keeps the severities in step).
 * `statuses` is the picker order; colour follows the shared severity, so an
 * "Available" reads like "Completed" and "Not available" like "Behind".
 */
export const STATUS_SETS: Record<
  string,
  { statuses: CheckStatus[]; default: CheckStatus; history_only?: boolean }
> = {
  standard: { statuses: ["On Track", "Behind", "Completed", "N/A"], default: "On Track" },
  // Every default is on track: an unset check means no reported problem (§3.7).
  // History only since phase 6 (Nominated Equipment withdrawn, §3.5): kept so
  // past revisions render, never offered for a new check.
  availability: {
    statuses: ["Pending", "Available", "Not available"],
    default: "Pending",
    history_only: true,
  },
};

export const STATUS_SEVERITY: Record<CheckStatus, Severity> = {
  "On Track": "in_progress",
  Completed: "done",
  Behind: "blocked",
  "N/A": "not_counted",
  Available: "done",
  Pending: "in_progress",
  "Not available": "blocked",
};

/** Every status of a check's set, in picker order (unknown set → standard) —
 *  what a stored value can READ, history included. A menu offers
 *  `pickableStatuses` instead. */
export function statusesOf(statusSet: string | undefined): CheckStatus[] {
  return (STATUS_SETS[statusSet ?? "standard"] ?? STATUS_SETS.standard).statuses;
}

/** What an unset entry of this status set reads as. */
export function defaultStatusOf(statusSet: string | undefined): CheckStatus {
  return (STATUS_SETS[statusSet ?? "standard"] ?? STATUS_SETS.standard).default;
}

/** The part of a check's definition that decides how its cells read (spec
 *  §3.8): a check that locks with the plan — a Project gate — keeps N/A as a
 *  status; every other team's check uses the tick list instead. Always the
 *  definition the view rendered from (team rows' `checks`, a revision's frozen
 *  catalog, the lens's checks) — never `checkDefOf`'s unknown-code fallback,
 *  which reads as a gate. */
export type CheckRule = Pick<CatalogCheck, "locks_with_plan">;

/**
 * The statuses a person may PICK for a check (spec §3.3): its set's statuses,
 * minus N/A when the check doesn't lock with the plan — "doesn't apply" is the
 * tick list for those — and none from a history-only set (`availability`: past
 * revisions render it, nobody sets it). The Project gates keep N/A.
 */
export function pickableStatuses(check: Pick<CatalogCheck, "status_set" | "locks_with_plan">): CheckStatus[] {
  const set = STATUS_SETS[check.status_set] ?? STATUS_SETS.standard;
  if (set.history_only) return [];
  return check.locks_with_plan ? [...set.statuses] : set.statuses.filter((s) => s !== "N/A");
}

/** The statuses a legend lists for a set of checks — the ones their icons can
 *  show (spec §8.4), in order, without repeats. A team check is never drawn as
 *  N/A (it isn't drawn at all), so only checks that lock with the plan bring
 *  N/A — the Project gates, and the All lens's Project gates badge. A history
 *  set (a revision's frozen NEQ) still lists what its icons show. */
export function legendStatuses(
  checks: readonly Pick<CatalogCheck, "status_set" | "locks_with_plan">[],
): CheckStatus[] {
  if (checks.length === 0) return [...STATUS_SETS.standard.statuses];
  return [
    ...new Set(
      checks.flatMap((c) =>
        statusesOf(c.status_set).filter((s) => c.locks_with_plan || s !== "N/A"),
      ),
    ),
  ];
}

/** A cell as the views hold it. Live team cells carry `applies`; Project-gate
 *  cells and frozen snapshot cells don't. */
export interface ReadinessCell {
  status: CheckStatus;
  applies?: boolean;
}

/**
 * THE one rule for whether a cell is shown and counted (spec §5.1 "Cells") —
 * every team-check consumer drops the cells this rejects before it rolls up,
 * summarises or draws, so an empty list then gives no icon and no badge.
 * - A check that locks with the plan (a Project gate) always applies: its cells
 *   carry no `applies`, and a gate that doesn't apply reads N/A and draws the
 *   grey N/A icon, as before phase 6. A missing gate cell reads its default.
 * - A team check doesn't apply when its live cell says `applies: false`, or when
 *   it reads N/A — a frozen snapshot records an unticked check as N/A, and an
 *   N/A in history meant "doesn't apply" (§3.8); since phase 6 a team check
 *   that applies always shows Completed, On Track or Behind.
 * - A missing team cell (e.g. a project-only check on a well with no field
 *   project, §7.12) is drawn like one that doesn't apply.
 */
export function applies(cell: ReadinessCell | null | undefined, check: CheckRule): boolean {
  if (check.locks_with_plan) return true;
  if (!cell || cell.applies === false) return false;
  return cell.status !== "N/A";
}

/** How team-check views name a check that doesn't apply (spec §8.7). */
export const NOT_APPLICABLE = "Not applicable";
/** …and a target where none of a team's checks applies. The Project gates keep
 *  "Nothing applies (all N/A)" (lib/team-summary.ts). */
export const NOTHING_APPLIES = "Nothing applies";

/** What a not-counted cell is called: a Project gate's "N/A" (a status picked
 *  in its menu), a team check's "Not applicable" (unticked, §3.8). */
export function notApplicableLabel(check: CheckRule): string {
  return check.locks_with_plan ? STATUS_LABEL["N/A"] : NOT_APPLICABLE;
}

/** A status as a check's views word it: N/A on a team check reads "Not
 *  applicable"; every other status (a gate's N/A included) keeps its label. */
export function statusLabelOf(status: CheckStatus, check: CheckRule): string {
  return status === "N/A" ? notApplicableLabel(check) : (STATUS_LABEL[status] ?? status);
}

const SEVERITY_RANK: Record<Severity, number> = {
  blocked: 3,
  in_progress: 2,
  done: 1,
  not_counted: 0,
};
// A standard status that wears each severity's colour — for team summaries.
const SEVERITY_STATUS: Record<Severity, CheckStatus> = {
  blocked: "Behind",
  in_progress: "On Track",
  done: "Completed",
  not_counted: "N/A",
};

/** One status summarising several (e.g. a team's checks on a well): the worst
 *  severity wins, shown as the standard status of that colour. Undefined when
 *  there is nothing to summarise. Callers pass only cells that apply (`applies`)
 *  — so a team where nothing applies gets no badge, while all-N/A Project gates
 *  still read N/A (grey). */
export function worstStatus(statuses: CheckStatus[]): CheckStatus | undefined {
  if (statuses.length === 0) return undefined;
  const worst = statuses
    .map((s) => STATUS_SEVERITY[s] ?? "in_progress")
    .reduce((a, b) => (SEVERITY_RANK[b] > SEVERITY_RANK[a] ? b : a));
  return SEVERITY_STATUS[worst];
}
