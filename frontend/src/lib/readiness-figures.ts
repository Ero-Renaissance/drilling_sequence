/**
 * The three readiness figures (docs/readiness-framework-spec.md §3.7), as the
 * tiles and the Readiness tab word them. Which cells count, and whether a row is
 * ready, is decided by the backend rollup; the browser only adds the per-row
 * counts of the rows it shows and divides — with the backend's half-up rounding.
 */
import type { RowFigures } from "@/api/readiness";

/** Hover text for every place that shows the figures. */
export const READINESS_FIGURES_HINT =
  "Complete = done ÷ counted · On track = Completed or On Track (nothing behind) · " +
  "N/A isn't counted · an unset check reads On Track";

export interface ReadinessFigures {
  /** (done + on track) ÷ counted; null when nothing counts. */
  on_track_pct: number | null;
  behind: number;
  ready: number;
  /** Targets with at least one counted check (all-N/A ones are left out). */
  ready_of: number;
}

/** `part / whole` as a whole-number %, rounded HALF UP in integer arithmetic —
 *  identical to the backend's `pct` (Python's round() is banker's). Null when
 *  nothing counts. */
export function pct(part: number, whole: number): number | null {
  if (whole <= 0) return null;
  return Math.floor((200 * part + whole) / (2 * whole));
}

export interface SummedFigures extends ReadinessFigures {
  /** Rows added up. */
  targets: number;
  /** Complete (the headline): done ÷ counted. */
  complete_pct: number | null;
  counted: number;
  done: number;
  in_progress: number;
  /** Not-counted (N/A) cells. */
  na: number;
}

/** Add up the server's per-row figures of the rows shown. */
export function sumFigures(rows: readonly (RowFigures | undefined)[]): SummedFigures {
  let counted = 0;
  let done = 0;
  let inProgress = 0;
  let behind = 0;
  let na = 0;
  let ready = 0;
  let readyOf = 0;
  for (const f of rows) {
    if (!f) continue;
    counted += f.counted;
    done += f.done;
    inProgress += f.in_progress;
    behind += f.behind;
    na += f.na ?? 0;
    if (f.counted > 0) readyOf += 1;
    if (f.ready) ready += 1;
  }
  return {
    targets: rows.length,
    counted,
    done,
    in_progress: inProgress,
    behind,
    na,
    ready,
    ready_of: readyOf,
    complete_pct: pct(done, counted),
    on_track_pct: pct(done + inProgress, counted),
  };
}

/** The line under the headline Complete %: "complete · 83% on track · 1 behind
 *  · 4/6 ready" (`unit` names what is ready, e.g. "wells"). */
export function readinessSubline(f: ReadinessFigures, unit?: string): string {
  if (f.on_track_pct === null) return "Nothing to count";
  const what = unit ? `${unit} ready` : "ready";
  return `complete · ${f.on_track_pct}% on track · ${f.behind} behind · ${f.ready}/${f.ready_of} ${what}`;
}
