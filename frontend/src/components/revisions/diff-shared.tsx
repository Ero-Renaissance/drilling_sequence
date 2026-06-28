import { cn } from "@/lib/utils";
import type { RevisionDiff as RevisionDiffData } from "@/api/compare";
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

// ── Headline summary ──────────────────────────────────────────────────────────

export function SummaryBar({ diff }: { diff: RevisionDiffData }) {
  const s = diff.summary;
  const stats = [
    { label: "Added", value: s.added, tone: "text-emerald-600 dark:text-emerald-400" },
    { label: "Modified", value: s.modified, tone: "text-amber-600 dark:text-amber-400" },
    { label: "Removed", value: s.removed, tone: "text-red-600 dark:text-red-400" },
    { label: "Unchanged", value: s.unchanged, tone: "text-muted-foreground" },
  ];
  const countDelta = s.target_count - s.base_count;
  const readinessDelta =
    s.base_readiness_pct !== null && s.target_readiness_pct !== null
      ? s.target_readiness_pct - s.base_readiness_pct
      : null;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="rounded-lg border border-border/70 bg-card px-3 py-2 text-center"
          >
            <div className={cn("text-lg font-semibold tabular-nums", stat.tone)}>
              {stat.value}
            </div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              {stat.label}
            </div>
          </div>
        ))}
      </div>
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
