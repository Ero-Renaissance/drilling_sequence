import type { CatalogCheck, CheckStatus, Severity } from "@/api/readiness";
import {
  NOTHING_APPLIES,
  NOT_APPLICABLE,
  STATUS_LABEL,
  STATUS_SEVERITY,
  applies,
  worstStatus,
  type ReadinessCell,
} from "@/components/readiness/check-meta";

/** One check of a team, as one activity sees it. */
export interface TeamCheckDetail {
  code: string;
  label: string;
  status: CheckStatus;
  /** False: a team check that doesn't apply to this target (spec §3.8) — left
   *  out of every figure and badge, listed muted as "Not applicable" in live
   *  tooltips only. Always true for a Project gate (`applies()`). */
  applies: boolean;
}

/**
 * A team's cells on one target as details, in catalog order — the one place the
 * All lens (chart) and the All grid build them. Each is marked by `applies()`
 * against the definition the view rendered from; a check with no cell here
 * (e.g. a project-only check on a well with no field project) is left out.
 */
export function teamDetails(
  checks: readonly Pick<CatalogCheck, "code" | "label" | "locks_with_plan">[],
  values: Partial<Record<string, ReadinessCell>> | null | undefined,
): TeamCheckDetail[] {
  return checks.flatMap((c) => {
    const v = values?.[c.code];
    return v ? [{ code: c.code, label: c.label, status: v.status, applies: applies(v, c) }] : [];
  });
}

export interface TeamSummary {
  /** The badge colour: the worst severity of the checks that apply, as a
   *  standard status. */
  worst: CheckStatus;
  done: number;
  /** Counted checks — N/A gates ("not counted") are left out, like the tiles;
   *  checks that don't apply never get this far. */
  total: number;
  /** Not-done counted checks, worst first (blocked, then in progress), each
   *  group in catalog order. */
  attention: TeamCheckDetail[];
  /** The team checks that don't apply here, in catalog order — only for the
   *  live tooltip's muted "Not applicable" list. */
  notApplicable: TeamCheckDetail[];
}

const ATTENTION_ORDER: Severity[] = ["blocked", "in_progress"];

/** Summarise a team's checks for one activity — the "All" lens tooltip and the
 *  All grid's folded cell. Checks that don't apply are dropped FIRST (spec §5.1),
 *  so a team where none applies gives `undefined`: no badge. Counting matches the
 *  dashboard tiles: "Available" counts as done (shared severity), N/A is not
 *  counted — so all-N/A Project gates still summarise, as grey N/A. */
export function summariseTeam(details: readonly TeamCheckDetail[]): TeamSummary | undefined {
  const shown = details.filter((d) => d.applies);
  const worst = worstStatus(shown.map((d) => d.status));
  if (!worst) return undefined;
  const severity = (d: TeamCheckDetail) => STATUS_SEVERITY[d.status] ?? "in_progress";
  const counted = shown.filter((d) => severity(d) !== "not_counted");
  return {
    worst,
    done: counted.filter((d) => severity(d) === "done").length,
    total: counted.length,
    attention: ATTENTION_ORDER.flatMap((sev) => counted.filter((d) => severity(d) === sev)),
    notApplicable: details.filter((d) => !d.applies),
  };
}

/** The one-line text: "4 of 6 done · Behind: PO, FFP · On Track: CTR · +1 more".
 *  Names at most `maxNamed` checks (worst first); done checks are only counted.
 *  Plain text — callers escape it where it goes into HTML. */
export function summaryLine(summary: TeamSummary, maxNamed = 4): string {
  // Only Project gates reach a summary with nothing counted: a team check that
  // doesn't apply is dropped before summarising.
  if (summary.total === 0) return "Nothing applies (all N/A)";
  if (summary.done === summary.total) return `All ${summary.total} done`;

  // One group per status ("Behind: PO, FFP"), in the worst-first order the
  // statuses first appear — two blocked statuses (Behind, Not available in a
  // revision's history) never interleave.
  const named = summary.attention.slice(0, maxNamed);
  const groups = new Map<string, string[]>();
  for (const d of named) {
    const label = STATUS_LABEL[d.status] ?? d.status;
    groups.set(label, [...(groups.get(label) ?? []), d.code]);
  }
  const more = summary.attention.length - named.length;
  return [
    `${summary.done} of ${summary.total} done`,
    ...[...groups].map(([label, names]) => `${label}: ${names.join(", ")}`),
    ...(more > 0 ? [`+${more} more`] : []),
  ].join(" · ");
}

/** A team's line whatever applies: its summary line, or "Nothing applies" when
 *  none of its checks applies to the target (no badge); "" with no cells at all. */
export function teamLine(details: readonly TeamCheckDetail[], maxNamed = 4): string {
  const summary = summariseTeam(details);
  if (summary) return summaryLine(summary, maxNamed);
  return details.length > 0 ? NOTHING_APPLIES : "";
}

/** "Not applicable: NAV, PO" — the muted list a live tooltip (or the Readiness
 *  panel) adds for the team checks that don't apply; "" when every check
 *  applies. Prints, grids' summaries and revisions never list them (decision
 *  33). Plain text — escape it where it goes into HTML. */
export function notApplicableLine(details: readonly TeamCheckDetail[]): string {
  const codes = details.filter((d) => !d.applies).map((d) => d.code);
  return codes.length > 0 ? `${NOT_APPLICABLE}: ${codes.join(", ")}` : "";
}
