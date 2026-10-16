/**
 * The three readiness figures (docs/readiness-framework-spec.md §3.7), as the
 * tiles word them. The numbers come from the backend rollup — the frontend only
 * formats them, never recomputes a percentage.
 */

/** Hover text for every tile that shows the figures. */
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

/** The line under the headline Complete %: "complete · 83% on track · 1 behind
 *  · 4/6 ready" (`unit` names what is ready, e.g. "wells"). */
export function readinessSubline(f: ReadinessFigures, unit?: string): string {
  if (f.on_track_pct === null) return "Nothing to count";
  const what = unit ? `${unit} ready` : "ready";
  return `complete · ${f.on_track_pct}% on track · ${f.behind} behind · ${f.ready}/${f.ready_of} ${what}`;
}
