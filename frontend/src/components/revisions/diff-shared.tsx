import { useState } from "react";
import { ArrowRight, ChevronDown, MinusCircle, PencilLine, PlusCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ActivityDiff, RevisionDiff as RevisionDiffData } from "@/api/compare";
import type { Revision } from "@/api/revisions";

export const LIVE_REF = "live";

export function sideLabel(rev: { label: string | null; rev_number: number }): string {
  return rev.label ?? `Rev. ${String(rev.rev_number).padStart(2, "0")}`;
}

const STATUS_TAG: Record<Revision["status"], string> = {
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
      </div>
    </div>
  );
}

// ── Per-activity change row ─────────────────────────────────────────────────────

const CHANGE_META: Record<
  ActivityDiff["change"],
  { icon: typeof PlusCircle; tone: string; label: string }
> = {
  added: { icon: PlusCircle, tone: "text-emerald-600 dark:text-emerald-400", label: "Added" },
  removed: { icon: MinusCircle, tone: "text-red-600 dark:text-red-400", label: "Removed" },
  modified: { icon: PencilLine, tone: "text-amber-600 dark:text-amber-400", label: "Modified" },
};

export function ActivityRow({ act }: { act: ActivityDiff }) {
  const [open, setOpen] = useState(act.change === "modified");
  const meta = CHANGE_META[act.change];
  const Icon = meta.icon;
  const subtitle = [act.well_name, act.rig_name].filter(Boolean).join(" · ");

  return (
    <div className="rounded-lg border border-border/60 bg-card">
      <button
        type="button"
        onClick={() => act.change === "modified" && setOpen((v) => !v)}
        className={cn(
          "flex w-full items-center gap-2.5 px-3 py-2.5 text-left",
          act.change === "modified" && "hover:bg-accent/30",
        )}
      >
        <Icon className={cn("h-4 w-4 shrink-0", meta.tone)} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">
              {act.activity_type}
            </span>
            <span className={cn("text-[10px] font-semibold uppercase tracking-wide", meta.tone)}>
              {meta.label}
            </span>
          </div>
          {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        {act.change === "modified" && (
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {act.fields.length} change{act.fields.length !== 1 ? "s" : ""}
          </span>
        )}
        {act.change === "modified" && (
          <ChevronDown
            className={cn(
              "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-180",
            )}
          />
        )}
      </button>

      {act.change === "modified" && open && act.fields.length > 0 && (
        <div className="space-y-1.5 border-t border-border/60 px-3 py-2.5">
          {act.fields.map((f) => (
            <div key={f.field} className="flex flex-wrap items-center gap-2 text-xs">
              <span className="min-w-[7rem] font-medium text-muted-foreground">{f.field}</span>
              <span className="rounded bg-red-500/10 px-1.5 py-0.5 text-red-600 line-through dark:text-red-400">
                {f.old ?? "—"}
              </span>
              <ArrowRight className="h-3 w-3 text-muted-foreground/60" />
              <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-emerald-600 dark:text-emerald-400">
                {f.new ?? "—"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
