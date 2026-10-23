import type { RowFigures } from "@/api/readiness";
import { notCountedLabel, readinessFiguresHint, sumFigures } from "@/lib/readiness-figures";
import { windowPhrase } from "@/lib/readiness-window";
import { cn } from "@/lib/utils";
import { STATUS_DOT } from "./check-meta";

/**
 * The three readiness figures (spec §3.7) over EXACTLY the rows a grid shows —
 * after the window, search and any drill-through filter, across every page. Adds
 * the server's per-row figures, so it reads what the Overview tile reads for the
 * same window: "57% complete · 100% on track · 0 behind · 0/1 ready".
 *
 * Shared by the Project gates grid and the team grids, which name their
 * not-counted cells differently (spec §8.7): a gate is "N/A", a team check that
 * doesn't apply is "not applicable".
 */
export function ReadinessSummary({
  rows,
  unit,
  windowMonths,
  projectGates = true,
}: {
  rows: readonly (RowFigures | undefined)[];
  /** What a row is: ["field project", "field projects"] or ["well", "wells"]. */
  unit: [string, string];
  windowMonths: number;
  /** The Project gates (default), or a team's checks. */
  projectGates?: boolean;
}) {
  const f = sumFigures(rows);
  const scope = `${f.targets} ${f.targets === 1 ? unit[0] : unit[1]} · ${windowPhrase(windowMonths)}`;
  return (
    <div
      className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-lg border border-border/70 bg-card px-4 py-3 shadow-soft-sm"
      title={readinessFiguresHint(projectGates)}
      data-testid="readiness-summary"
    >
      <div className="min-w-[220px] flex-1">
        <div className="mb-1.5 flex items-baseline justify-between gap-3 text-xs">
          <span className="font-medium text-muted-foreground">Readiness</span>
          <span className="tabular-nums text-muted-foreground">{scope}</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all duration-500"
            style={{ width: `${f.complete_pct ?? 0}%` }}
          />
        </div>
        {/* The checks behind the figures, as the old bar counted them. */}
        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          <Count dot={STATUS_DOT.Completed} value={f.done} label="done" />
          <Count dot={STATUS_DOT["On Track"]} value={f.in_progress} label="on track" />
          <Count dot={STATUS_DOT.Behind} value={f.behind} label="behind" />
          {f.na > 0 && (
            <Count dot={STATUS_DOT["N/A"]} value={f.na} label={notCountedLabel(projectGates)} />
          )}
          <span className="tabular-nums">of {f.counted + f.na} checks</span>
        </div>
      </div>
      <div className="flex items-baseline gap-4 text-xs">
        <Figure value={f.complete_pct === null ? "—" : `${f.complete_pct}%`} label="complete" strong />
        <Figure value={f.on_track_pct === null ? "—" : `${f.on_track_pct}%`} label="on track" />
        <Figure value={String(f.behind)} label="behind" tone={f.behind > 0 ? "bad" : undefined} />
        <Figure value={`${f.ready}/${f.ready_of}`} label="ready" />
      </div>
    </div>
  );
}

function Count({ dot, value, label }: { dot: string; value: number; label: string }) {
  return (
    <span className="flex items-center gap-1 tabular-nums">
      <span className={cn("h-2 w-2 rounded-full", dot)} />
      {value} {label}
    </span>
  );
}

function Figure({
  value,
  label,
  strong,
  tone,
}: {
  value: string;
  label: string;
  strong?: boolean;
  tone?: "bad";
}) {
  return (
    <div className="flex items-baseline gap-1">
      <span
        className={cn(
          "font-semibold tabular-nums text-foreground",
          strong ? "text-lg" : "text-sm",
          tone === "bad" && "text-red-500",
        )}
      >
        {value}
      </span>
      <span className="text-muted-foreground">{label}</span>
    </div>
  );
}
