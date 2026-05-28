import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  ChevronDown,
  GitCompare,
  MinusCircle,
  PencilLine,
  PlusCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  compareRevisions,
  type ActivityDiff,
  type RevisionDiff as RevisionDiffData,
} from "@/api/compare";
import type { Revision } from "@/api/revisions";

const LIVE_REF = "live";

function sideLabel(rev: { label: string | null; rev_number: number }): string {
  return rev.label ?? `Rev. ${String(rev.rev_number).padStart(2, "0")}`;
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

function SummaryBar({ diff }: { diff: RevisionDiffData }) {
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

function ActivityRow({ act }: { act: ActivityDiff }) {
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

// ── Main component ──────────────────────────────────────────────────────────────

interface RevisionDiffProps {
  projectId: string;
  /** The revision being viewed — the "target" (newer) side of the diff. */
  target: Revision;
  /** All revisions in the project, for the comparison picker. */
  revisions: Revision[];
}

export function RevisionDiff({ projectId, target, revisions }: RevisionDiffProps) {
  // Candidate base revisions: everything except the one we're viewing and discarded ones.
  const candidates = useMemo(
    () =>
      revisions
        .filter((r) => r.id !== target.id && r.status !== "discarded")
        .sort((a, b) => b.rev_number - a.rev_number),
    [revisions, target.id],
  );

  // Default base = the most recent revision older than this one.
  const defaultBase = useMemo(
    () => candidates.find((r) => r.rev_number < target.rev_number) ?? candidates[0],
    [candidates, target.rev_number],
  );

  const [baseRef, setBaseRef] = useState<string>(defaultBase?.id ?? "");
  const [diff, setDiff] = useState<RevisionDiffData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setBaseRef(defaultBase?.id ?? "");
  }, [defaultBase?.id]);

  useEffect(() => {
    if (!baseRef) {
      setDiff(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    compareRevisions(projectId, baseRef, target.id)
      .then((d) => !cancelled && setDiff(d))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Failed to compare"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [projectId, baseRef, target.id]);

  if (candidates.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border/70 px-4 py-6 text-center text-sm text-muted-foreground">
        This is the first revision — nothing to compare against yet.
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-xl border border-border/70 bg-card p-4 shadow-soft-sm">
      <div className="flex flex-wrap items-center gap-2">
        <GitCompare className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold text-foreground">Compare with</h2>
        <select
          value={baseRef}
          onChange={(e) => setBaseRef(e.target.value)}
          className="rounded-md border border-border bg-background px-2 py-1 text-sm"
        >
          {candidates.map((r) => (
            <option key={r.id} value={r.id}>
              {sideLabel(r)}
            </option>
          ))}
          <option value={LIVE_REF}>Current working plan (live)</option>
        </select>
        <span className="text-xs text-muted-foreground">
          changes from the selected version into{" "}
          <span className="font-medium text-foreground">{sideLabel(target)}</span>
        </span>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading && <p className="text-sm text-muted-foreground">Comparing…</p>}

      {diff && !loading && (
        <>
          <SummaryBar diff={diff} />
          {diff.activities.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border/70 px-3 py-4 text-center text-sm text-muted-foreground">
              No activity changes between these versions.
            </p>
          ) : (
            <div className="space-y-1.5">
              {diff.activities.map((a) => (
                <ActivityRow key={`${a.change}-${a.activity_id}`} act={a} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
