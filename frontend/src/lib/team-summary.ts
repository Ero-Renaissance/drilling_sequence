import type { CatalogCheck, CheckStatus, Severity } from "@/api/readiness";
import {
  NOTHING_APPLIES,
  NOT_APPLICABLE,
  STATUS_LABEL,
  STATUS_SEVERITY,
  applies,
  notSelected,
  worstStatus,
  type ReadinessCell,
} from "@/components/readiness/check-meta";
import type { CategoryType } from "./chart-layout";
import { codeWithLabel, lookAlikeCodes } from "./readiness-categories";

/** One check of a team, as one activity sees it. */
export interface TeamCheckDetail {
  code: string;
  label: string;
  status: CheckStatus;
  /** False: a team check that doesn't apply to this target because of a row
   *  (spec §3.8) — left out of every figure and badge, listed muted as "Not
   *  applicable" in live tooltips only. Always true for a Project gate
   *  (`applies()`). A not-selected check (phase 7) never becomes a detail. */
  applies: boolean;
  /** Its code looks like another check's of the same team (`CR`/`CTR`,
   *  `PC`/`PO` — spec §3.4), so a line that lists codes words it with its label
   *  ("CR (Crane)"). Set by `teamDetails` over the team's FULL definitions, as
   *  the team lens judges them; never for a Project gate (they keep bare codes).
   *  Missing reads as false. */
  lookAlike?: boolean;
}

/** A detail's code as a line that lists codes words it: "CR (Crane)" for a
 *  look-alike (spec §3.4), else the bare code. */
function detailCode(d: TeamCheckDetail): string {
  return d.lookAlike ? codeWithLabel(d, new Set([d.code])) : d.code;
}

/**
 * A team's cells on one target as details, in catalog order — the one place the
 * All lens (chart) and the All grid build them. Each is marked by `applies()`
 * against the definition the view rendered from. Left out:
 * - a check with no cell here (e.g. a project-only check on a well with no
 *   field project);
 * - a check that is NOT SELECTED (phase 7, spec §3.9, `notSelected()`): it
 *   carries nothing, so `notApplicableLine`, `summariseTeam().notApplicable`,
 *   the chart tooltips and the panel's "Not applicable (N)" never name it. A
 *   Project gate is never "not selected": it has no tick (decision 31).
 * Look-alike codes (spec §3.4) are judged once here, over the team's FULL
 * `checks` — not only the details kept — so the All lens's tooltip and the All
 * grid's folded team word "CR (Crane)" exactly where the team lens does. A
 * Project gate is never marked: the gates keep their bare codes.
 */
export function teamDetails(
  checks: readonly Pick<CatalogCheck, "code" | "label" | "locks_with_plan">[],
  values: Partial<Record<string, ReadinessCell>> | null | undefined,
): TeamCheckDetail[] {
  const lookAlikes = lookAlikeCodes(checks.filter((c) => !c.locks_with_plan).map((c) => c.code));
  return checks.flatMap((c) => {
    const v = values?.[c.code];
    if (!v || (!c.locks_with_plan && notSelected(v))) return [];
    const detail: TeamCheckDetail = { code: c.code, label: c.label, status: v.status, applies: applies(v, c) };
    if (lookAlikes.has(c.code)) detail.lookAlike = true;
    return [detail];
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
 *  A look-alike code carries its label ("Behind: CR (Crane)", spec §3.4).
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
    groups.set(label, [...(groups.get(label) ?? []), detailCode(d)]);
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

/** How many codes a "Not applicable" line names before "+N more" (spec §8.8:
 *  with 21 equipment types a well can have many). */
export const NOT_APPLICABLE_NAMED = 6;

/** "Not applicable: NAV, PO" from the codes of the checks that don't apply
 *  because of a row, in catalog order — capped at `maxNamed` codes plus "+N
 *  more"; "" for none. For a view that builds its own list (the chart's
 *  team-lens tooltip, which must first drop the not-selected cells with
 *  `notSelected()`). Plain text — escape it where it goes into HTML. */
export function notApplicableCodesLine(
  codes: readonly string[],
  maxNamed = NOT_APPLICABLE_NAMED,
): string {
  if (codes.length === 0) return "";
  const named = codes.slice(0, Math.max(1, maxNamed));
  const more = codes.length - named.length;
  return [`${NOT_APPLICABLE}: ${named.join(", ")}`, ...(more > 0 ? [`+${more} more`] : [])].join(
    " · ",
  );
}

/** "Not applicable: NAV, PO" — the muted list a live tooltip (or the Readiness
 *  panel) adds for the team checks that don't apply because of a row; "" when
 *  every check applies. A not-selected check is never a detail (`teamDetails`),
 *  so it is never named here. A look-alike code carries its label ("PC
 *  (Personnel Carrier)"). Capped like `notApplicableCodesLine`. Prints,
 *  grids' summaries and revisions never list them (decision 33). Plain text —
 *  escape it where it goes into HTML. */
export function notApplicableLine(
  details: readonly TeamCheckDetail[],
  maxNamed = NOT_APPLICABLE_NAMED,
): string {
  return notApplicableCodesLine(
    details.filter((d) => !d.applies).map(detailCode),
    maxNamed,
  );
}

// ── Categories (phase 7, spec §8.8) ─────────────────────────────────────────

/** A category's tooltip line, its types worst first (as `categoryCell` orders
 *  them): "Vessels (2): PSV Behind · DSV On Track". `codeText` words a code —
 *  e.g. adding the label after a look-alike one ("PC (Personnel Carrier)",
 *  spec §3.4). Plain text — escape it where it goes into HTML. */
export function categoryLine(
  name: string,
  types: readonly CategoryType[],
  codeText: (type: CategoryType) => string = (t) => t.code,
): string {
  const named = types.map((t) => `${codeText(t)} ${STATUS_LABEL[t.status] ?? t.status}`);
  return `${name} (${types.length}): ${named.join(" · ")}`;
}

/** A category's folded line in the Readiness panel: "Vessels · 2 selected · 1
 *  behind" — selected = its types that apply here (ticked, or followed from the
 *  field project), behind = those whose severity is blocked. */
export function categoryPanelLine(name: string, types: readonly CategoryType[]): string {
  const behind = types.filter((t) => STATUS_SEVERITY[t.status] === "blocked").length;
  return [name, `${types.length} selected`, ...(behind > 0 ? [`${behind} behind`] : [])].join(" · ");
}
