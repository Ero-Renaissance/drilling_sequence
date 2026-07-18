import { cn } from "@/lib/utils";
import type {
  ActivityDiff,
  ChangeKind,
  ContractDiff,
  RevisionDiff as RevisionDiffData,
} from "@/api/compare";
import type { Revision } from "@/api/revisions";

export const LIVE_REF = "live";

export function sideLabel(rev: { label: string | null; rev_number: number }): string {
  return rev.label ?? `Rev. ${String(rev.rev_number).padStart(2, "0")}`;
}

const STATUS_TAG: Record<Revision["status"], string> = {
  pending_review: "in review",
  pending_approval: "pending",
  approved: "approved",
  discarded: "discarded",
  rejected: "rejected",
  changes_requested: "changes requested",
};

export function optionLabel(rev: Revision): string {
  return rev.status === "approved" || rev.status === "pending_approval"
    ? sideLabel(rev)
    : `${sideLabel(rev)} (${STATUS_TAG[rev.status]})`;
}

function signed(n: number | null): string {
  if (n === null) return "—";
  if (n === 0) return "no change";
  return n > 0 ? `+${n}d` : `${n}d`;
}

function shiftTone(n: number | null): string {
  if (n === null || n === 0) return "text-muted-foreground";
  return n > 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400";
}

// ── Diff triage filtering (shared by the Compare card + the Compare tab) ─────
// Filtering narrows what is EXPANDED, never what is counted: the summary tiles
// always show the full change set, and an explicit "showing X of Y" line
// appears while a filter is active — a filtered view must never be able to
// masquerade as the whole picture on an approval surface.

export type ChangeKindFilter = ChangeKind;

export function matchesDiffFilter(
  a: ActivityDiff,
  changeFilter: ChangeKindFilter | null,
  search: string,
): boolean {
  if (changeFilter && a.change !== changeFilter) return false;
  const q = search.trim().toLowerCase();
  if (!q) return true;
  return [a.rig_name, a.hwu_name, a.well_name, a.well_project, a.activity_type].some(
    (v) => v?.toLowerCase().includes(q),
  );
}

export function matchesContractFilter(
  c: ContractDiff,
  changeFilter: ChangeKindFilter | null,
  search: string,
): boolean {
  // A contract change is not an added/modified/removed ACTIVITY row — under a
  // change-type filter it would surface as an unrelated-looking group, so it
  // only shows when no type filter is active (and its resource matches search).
  if (changeFilter) return false;
  const q = search.trim().toLowerCase();
  return !q || c.resource.toLowerCase().includes(q);
}

// ── Headline summary ──────────────────────────────────────────────────────────

export function SummaryBar({
  diff,
  filter = null,
  onFilterChange,
  shownCount,
  onClearFilters,
}: {
  diff: RevisionDiffData;
  /** Active change-type filter — the matching tile reads as pressed. */
  filter?: ChangeKindFilter | null;
  /** When given, the Added/Modified/Removed tiles become toggle filters. */
  onFilterChange?: (f: ChangeKindFilter | null) => void;
  /** Changed activities currently displayed (post filter + search). */
  shownCount?: number;
  /** Clears the type filter AND the search box together. */
  onClearFilters?: () => void;
}) {
  const s = diff.summary;
  // Removed lumps two very different stories: work genuinely dropped vs
  // activities that COMPLETED and were dropped on clone (routine hygiene).
  // Split them so "8 removed" can't read as scope-cutting when 6 finished.
  const completedRemovals = diff.activities.filter(
    (a) => a.change === "removed" && a.removal_reason === "completed",
  ).length;
  const stats: {
    label: string;
    value: number;
    tone: string;
    kind: ChangeKindFilter | null;
    sub?: string;
    tip: string;
  }[] = [
    {
      label: "Added",
      value: s.added,
      tone: "text-emerald-600 dark:text-emerald-400",
      kind: "added",
      tip: "Activities in this version that are not in the baseline. Matched by lineage, so an activity moved to another rig counts as modified, not added.",
    },
    {
      label: "Modified",
      value: s.modified,
      tone: "text-amber-600 dark:text-amber-400",
      kind: "modified",
      tip: "The same activity in both versions with changed fields (dates, rig, well, market…).",
    },
    {
      label: "Removed",
      value: s.removed,
      tone: "text-red-600 dark:text-red-400",
      kind: "removed",
      sub: completedRemovals > 0 ? `${completedRemovals} completed` : undefined,
      tip: "Activities in the baseline that are gone from this version — including finished work dropped on clone (counted separately below the number).",
    },
    {
      label: "Unchanged",
      value: s.unchanged,
      tone: "text-muted-foreground",
      kind: null,
      tip: "Activities identical in both versions.",
    },
  ];
  const changedTotal = s.added + s.modified + s.removed;
  // Scale context: how many rigs/projects the changed set touches.
  // (diff.activities carries changed rows only — unchanged aren't listed.)
  const changed = diff.activities;
  const changedRigs = new Set(
    changed.map((a) => a.rig_name ?? (a.hwu_name ? `HWU · ${a.hwu_name}` : null)).filter(Boolean),
  ).size;
  const changedProjects = new Set(
    changed.map((a) => a.well_project).filter(Boolean),
  ).size;
  const filtered = shownCount !== undefined && shownCount !== changedTotal;
  const countDelta = s.target_count - s.base_count;
  const readinessDelta =
    s.base_readiness_pct !== null && s.target_readiness_pct !== null
      ? s.target_readiness_pct - s.base_readiness_pct
      : null;
  return (
    <div className="space-y-3">
      {/* The tiles count ACTIVITIES — say so once, for all four. */}
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Activity changes
        </span>
        {changedTotal > 0 && (
          <span className="text-[11px] text-muted-foreground">
            across {changedRigs} rig{changedRigs === 1 ? "" : "s"} · {changedProjects} project
            {changedProjects === 1 ? "" : "s"}
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {stats.map((stat) => {
          const clickable = !!onFilterChange && stat.kind !== null;
          const active = filter !== null && stat.kind === filter;
          const Tag = clickable ? "button" : "div";
          return (
            <Tag
              key={stat.label}
              {...(clickable
                ? {
                    type: "button" as const,
                    onClick: () => onFilterChange?.(active ? null : stat.kind),
                    title: active ? "Clear this filter" : stat.tip,
                    "data-testid": `diff-chip-${stat.kind}`,
                  }
                : { title: stat.tip })}
              className={cn(
                "rounded-lg border border-border/70 bg-card px-3 py-2 text-center",
                clickable && "transition-colors hover:border-primary/40",
                active && "border-primary/60 ring-1 ring-primary/40",
              )}
            >
              <div className={cn("text-lg font-semibold tabular-nums", stat.tone)}>
                {stat.value}
              </div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                {stat.label}
              </div>
              {stat.sub && (
                <div className="text-[10px] tabular-nums text-sky-600 dark:text-sky-400">
                  {stat.sub}
                </div>
              )}
            </Tag>
          );
        })}
      </div>
      {filtered && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="diff-shown-count">
          Showing{" "}
          <span className="font-medium text-foreground">
            {shownCount} of {changedTotal}
          </span>{" "}
          changed activities
          {onClearFilters && (
            <button
              type="button"
              onClick={onClearFilters}
              className="rounded-md border border-border px-2 py-0.5 text-xs transition-colors hover:border-primary/40 hover:text-foreground"
            >
              Clear filters
            </button>
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>
          Start{" "}
          <span className={cn("font-medium tabular-nums", shiftTone(s.start_shift_days))}>
            {signed(s.start_shift_days)}
          </span>
        </span>
        <span>
          End{" "}
          <span className={cn("font-medium tabular-nums", shiftTone(s.end_shift_days))}>
            {signed(s.end_shift_days)}
          </span>
        </span>
        <span>
          Duration{" "}
          <span className={cn("font-medium tabular-nums", shiftTone(s.duration_shift_days))}>
            {signed(s.duration_shift_days)}
          </span>
        </span>
        <span>
          Activities{" "}
          <span className="font-medium tabular-nums text-foreground">{s.target_count}</span>
          {countDelta !== 0 && (
            <span className="ml-1 tabular-nums text-muted-foreground">
              ({countDelta > 0 ? "+" : ""}
              {countDelta})
            </span>
          )}
        </span>
        {s.target_readiness_pct !== null && (
          <span>
            Readiness{" "}
            <span className="font-medium tabular-nums text-foreground">
              {s.target_readiness_pct}%
            </span>
            {readinessDelta !== null && readinessDelta !== 0 && (
              <span
                className={cn(
                  "ml-1 font-medium tabular-nums",
                  readinessDelta > 0
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-red-600 dark:text-red-400",
                )}
              >
                {readinessDelta > 0 ? "▲" : "▼"}
                {Math.abs(readinessDelta)}
              </span>
            )}
          </span>
        )}
      </div>
    </div>
  );
}
