import type { CheckStatus, Severity } from "@/api/readiness";
import { STATUS_LABEL, STATUS_SEVERITY, worstStatus } from "@/components/readiness/check-meta";

/** One check of a team, as one activity sees it. */
export interface TeamCheckDetail {
  code: string;
  label: string;
  status: CheckStatus;
  /** Effective tags (e.g. nominated equipment), for checks with a tag list. */
  tags?: string[];
}

export interface TeamSummary {
  /** The badge colour: the worst severity, as a standard status. */
  worst: CheckStatus;
  done: number;
  /** Counted checks — N/A ("not counted") ones are left out, like the tiles. */
  total: number;
  /** Not-done counted checks, worst first (blocked, then in progress), each
   *  group in catalog order. */
  attention: TeamCheckDetail[];
}

const ATTENTION_ORDER: Severity[] = ["blocked", "in_progress"];

/** Summarise a team's checks for one activity — the "All" lens tooltip and the
 *  All grid's folded cell. Counting matches the dashboard tiles: "Available"
 *  counts as done (shared severity), N/A is not counted. */
export function summariseTeam(details: TeamCheckDetail[]): TeamSummary | undefined {
  const worst = worstStatus(details.map((d) => d.status));
  if (!worst) return undefined;
  const severity = (d: TeamCheckDetail) => STATUS_SEVERITY[d.status] ?? "in_progress";
  const counted = details.filter((d) => severity(d) !== "not_counted");
  return {
    worst,
    done: counted.filter((d) => severity(d) === "done").length,
    total: counted.length,
    attention: ATTENTION_ORDER.flatMap((sev) => counted.filter((d) => severity(d) === sev)),
  };
}

/** The one-line text: "4 of 7 done · Not available: NEQ (RW, DSV) · Behind: PO
 *  · +1 more". Names at most `maxNamed` checks (worst first); done checks are
 *  only counted. Plain text — callers escape it where it goes into HTML. */
export function summaryLine(summary: TeamSummary, maxNamed = 4): string {
  if (summary.total === 0) return "Nothing applies (all N/A)";
  if (summary.done === summary.total) return `All ${summary.total} done`;

  // One group per status ("Behind: PO, FFP"), in the worst-first order the
  // statuses first appear — two blocked statuses (Behind, Not available) never
  // interleave.
  const named = summary.attention.slice(0, maxNamed);
  const groups = new Map<string, string[]>();
  for (const d of named) {
    const label = STATUS_LABEL[d.status] ?? d.status;
    const name = d.tags?.length ? `${d.code} (${d.tags.join(", ")})` : d.code;
    groups.set(label, [...(groups.get(label) ?? []), name]);
  }
  const more = summary.attention.length - named.length;
  return [
    `${summary.done} of ${summary.total} done`,
    ...[...groups].map(([label, names]) => `${label}: ${names.join(", ")}`),
    ...(more > 0 ? [`+${more} more`] : []),
  ].join(" · ");
}
