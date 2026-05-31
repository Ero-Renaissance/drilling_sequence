import { useEffect, useState } from "react";
import {
  ArrowRight,
  ChevronDown,
  FileText,
  MinusCircle,
  PencilLine,
  PlusCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PaginationFooter } from "@/components/ui/pagination-footer";
import { SearchInput } from "@/components/ui/search-input";
import type {
  ActivityDiff,
  ContractDiff,
  RevisionDiff as RevisionDiffData,
} from "@/api/compare";
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

// ── Rig contract changes (rig-level, material to readiness) ─────────────────────

export function ContractDiffList({ contracts }: { contracts?: ContractDiff[] }) {
  if (!contracts || contracts.length === 0) return null;
  return (
    <div className="space-y-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
      <div className="flex items-center gap-2">
        <FileText className="h-4 w-4 text-amber-600 dark:text-amber-400" />
        <h3 className="text-sm font-semibold text-foreground">Rig contracts</h3>
        <span className="text-xs text-muted-foreground">
          {contracts.length} rig{contracts.length !== 1 ? "s" : ""} changed
        </span>
      </div>
      <div className="space-y-1.5">
        {contracts.map((c) => (
          <div key={c.rig_name} className="rounded-lg border border-border/60 bg-card px-3 py-2">
            <p className="text-sm font-medium text-foreground">{c.rig_name}</p>
            <div className="mt-1 space-y-1.5">
              {c.fields.map((f) => (
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
          </div>
        ))}
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
  // Collapsed by default — the reviewer expands the rows they want to inspect
  // rather than being shown every field change at once.
  const [open, setOpen] = useState(false);
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
            {act.change === "removed" && act.removal_reason && (
              <span
                className={cn(
                  "rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
                  act.removal_reason === "completed"
                    ? "border-emerald-500/25 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                    : "border-border bg-muted text-muted-foreground",
                )}
              >
                {act.removal_reason === "completed" ? "Completed" : "Dropped"}
              </span>
            )}
            {act.change !== "removed" && act.completed && (
              <span className="rounded-full border border-emerald-500/25 bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
                Completed
              </span>
            )}
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

// ── Paginated list of change rows ───────────────────────────────────────────────

export function ActivityDiffList({ activities }: { activities: ActivityDiff[] }) {
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [search, setSearch] = useState("");

  // Reset to the first page when the underlying set or the search changes (e.g.
  // a new base/target is picked) so we never land on a now-empty page.
  useEffect(() => {
    setPageIndex(0);
  }, [activities, search]);

  const q = search.trim().toLowerCase();
  const filtered = q
    ? activities.filter((a) =>
        [a.activity_type, a.well_name, a.rig_name]
          .filter(Boolean)
          .some((v) => v!.toLowerCase().includes(q)),
      )
    : activities;

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safeIndex = Math.min(pageIndex, pageCount - 1);
  const start = safeIndex * pageSize;
  const visible = filtered.slice(start, start + pageSize);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search well, rig, type…"
          ariaLabel="Search changes"
          testId="compare-search"
        />
        <span className="text-xs tabular-nums text-muted-foreground">
          {q ? `${filtered.length} of ${activities.length}` : `${activities.length} changes`}
        </span>
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border/70 px-3 py-4 text-center text-sm text-muted-foreground">
          No changes match &ldquo;{search}&rdquo;.
        </p>
      ) : (
        <div className="space-y-1.5">
          {visible.map((a) => (
            <ActivityRow key={`${a.change}-${a.activity_id}`} act={a} />
          ))}
        </div>
      )}

      <PaginationFooter
        pageIndex={safeIndex}
        pageCount={pageCount}
        pageSize={pageSize}
        onPageChange={setPageIndex}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPageIndex(0);
        }}
      />
    </div>
  );
}
