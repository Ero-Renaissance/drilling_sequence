/**
 * The "Checks that apply" picker's decisions (spec §3.8, §5.1, §8.7), kept out
 * of the component so they are unit-tested without a dialog: which of a team's
 * checks a target's picker lists, how a tick inherits, what one Save sends, and
 * how the response folds back into the team's rows.
 *
 * Only checks that DON'T lock with the plan get a tick: the Project gates use
 * N/A in their status menu instead (decision 31), so they never appear here.
 */
import type {
  ApplicabilityResult,
  ApplicabilityUpdate,
  CatalogCheck,
  CheckCode,
  ReadinessTarget,
  TeamCheckState,
  TeamReadiness,
  TeamWellRow,
} from "@/api/readiness";
import { appliesByDefault } from "@/components/readiness/check-meta";
import { categoryOf, groupItemsByCategory, type CategoryGroups } from "./readiness-categories";

/** A tick as the picker holds it: applies (`true`), doesn't (`false`), or —
 *  on a well that inherits — `null`: it follows its field project. */
export type TickChoice = boolean | null;

type Cells = Partial<Record<CheckCode, Pick<TeamCheckState, "applies" | "applies_source">>>;

/** How one check shows in a target's picker. */
export interface PickerRow {
  check: CatalogCheck;
  /** `edit`: a tick this picker sets. `project`: a project-only check on a
   *  well row — set on the field project, shown read-only. */
  kind: "edit" | "project";
  /** A check enabled at both levels, on a well with a field project: the well
   *  follows its field project's tick until it makes its own choice. */
  inherits: boolean;
  /** As loaded: an inheriting row holds the well's own choice, or `null` while
   *  it follows its field project; every other row holds whether it applies. */
  initial: TickChoice;
  /** The field project's tick — what an inheriting row shows while it follows
   *  (and after Follow project). Equal to the tick for every other row. */
  projectApplies: boolean;
}

/**
 * The rows of one target's picker, in the order of `checks` (catalog order).
 * - A field project lists the team's checks enabled at project level.
 * - A well lists its well-level checks — inheriting where the check is enabled
 *   at both levels and the well has a field project — plus project-only checks,
 *   read-only ("set on the field project"). On a well with no field project
 *   those carry nothing (§7.12), so they're left out, and a two-level check is a
 *   plain tick with nothing to follow.
 * `cells` are the target's own cells as served; `projectCells` the field
 * project's, for what Follow project shows on a well that has its own choice.
 */
export function pickerRows(
  checks: readonly CatalogCheck[],
  target: ReadinessTarget,
  cells: Cells | undefined,
  projectCells?: Cells,
): PickerRow[] {
  const onWell = target.scope === "well";
  const hasProject = target.well_project !== "";
  return checks.flatMap((check): PickerRow[] => {
    if (check.locks_with_plan) return []; // a Project gate: N/A, not a tick
    const cell = cells?.[check.code];
    // With no cell to read, a check reads its own default: ticked, unless it
    // starts unticked (phase 7, spec §3.9) — the field is optional, and a
    // definition without it starts ticked.
    const byDefault = appliesByDefault(check);
    const ticked = cell?.applies ?? byDefault;
    const plain = (kind: PickerRow["kind"], value: boolean): PickerRow[] => [
      { check, kind, inherits: false, initial: value, projectApplies: value },
    ];
    if (!onWell) return check.applies_project ? plain("edit", ticked) : [];
    if (!check.applies_well) {
      if (!hasProject) return [];
      return plain("project", cell?.applies ?? projectCells?.[check.code]?.applies ?? byDefault);
    }
    if (!(check.applies_project && hasProject)) return plain("edit", ticked);
    const own = cell?.applies_source === "well";
    return [
      {
        check,
        kind: "edit",
        inherits: true,
        initial: own ? ticked : null,
        // A following well's tick IS its field project's; with its own choice,
        // read the project's row (the check's default when unknown).
        projectApplies: own ? (projectCells?.[check.code]?.applies ?? byDefault) : ticked,
      },
    ];
  });
}

/** Whether a row reads as ticked for a choice. */
export function isTicked(row: PickerRow, choice: TickChoice): boolean {
  return choice ?? row.projectApplies;
}

/**
 * Whether a row reads as the well's own choice ("set on this well") — a
 * PREVIEW against the field project's tick as loaded:
 * - Follow project (`null`) never is;
 * - an unchanged choice is what was loaded (an own choice that came to match
 *   its field project stays one until Follow project, §3.8);
 * - a changed one is stored only where it differs from the field project
 *   (§4.4), so a choice matching the loaded tick previews "from project".
 * The preview never decides what is SENT: a box click always sends its
 * explicit tick (see `changedChoices`), and the server weighs it against the
 * field project's CURRENT tick.
 */
export function isOwnChoice(row: PickerRow, choice: TickChoice): boolean {
  if (!row.inherits || choice === null) return false;
  if (choice === row.initial) return true;
  return choice !== row.projectApplies;
}

/**
 * The codes a Save changes, and to what — only rows whose choice moved from
 * what was loaded (the server changes only the listed codes). A box click is
 * the explicit tick (`true` / `false`), never `null`: turning a click that
 * matches the field project's tick AS LOADED into "follow" would let a
 * concurrent change to that project flip the user's choice. `null` comes only
 * from the explicit **Follow project** control.
 */
export function changedChoices(
  rows: readonly PickerRow[],
  choices: Readonly<Record<CheckCode, TickChoice>>,
): Record<CheckCode, TickChoice> {
  const out: Record<CheckCode, TickChoice> = {};
  for (const row of rows) {
    if (row.kind !== "edit") continue;
    const choice = choices[row.check.code];
    if (choice !== undefined && choice !== row.initial) out[row.check.code] = choice;
  }
  return out;
}

/** The PUT body for one target. Names travel in the body (DS-001). A field
 *  project never sends `null` — it has nothing to follow (422) — so a `null`
 *  there is dropped, never turned into a tick: with no check in scope, `true`
 *  could nominate a check that starts unticked (phase 7). The picker never
 *  holds one for a field project (it has no Follow project). */
export function applicabilityBody(
  target: ReadinessTarget,
  applies: Record<CheckCode, TickChoice>,
): ApplicabilityUpdate {
  if (target.scope === "project") {
    const ticks: Record<CheckCode, boolean> = {};
    for (const [code, choice] of Object.entries(applies)) {
      if (choice !== null) ticks[code] = choice;
    }
    return { scope: "project", well_project: target.well_project, applies: ticks };
  }
  return { ...target, applies };
}

// ── The grouped, searchable tick list (phase 7, spec §8.8) ──────────────────

/** A target's picker rows grouped for display: the team's core checks first,
 *  then one group per category, each in catalog order (lib/readiness-categories). */
export function pickerGroups(rows: readonly PickerRow[]): CategoryGroups<PickerRow> {
  return groupItemsByCategory(rows, (r) => categoryOf(r.check));
}

/** A row's choice as the dialog holds it: the user's, else as loaded. `null` is
 *  a real choice (Follow project), so only a missing entry falls back. */
function choiceOf(row: PickerRow, choices: Readonly<Record<CheckCode, TickChoice>>): TickChoice {
  const choice = choices[row.check.code];
  return choice !== undefined ? choice : row.initial;
}

/** A category group's ticks: "n of m selected" (selected = ticked) and its
 *  tri-state "select all" box. A group with nothing selected starts folded. */
export interface GroupTicks {
  selected: number;
  total: number;
  state: "none" | "some" | "all";
}

export function groupTicks(
  rows: readonly PickerRow[],
  choices: Readonly<Record<CheckCode, TickChoice>>,
): GroupTicks {
  const selected = rows.filter((r) => isTicked(r, choiceOf(r, choices))).length;
  const total = rows.length;
  return {
    selected,
    total,
    state: selected === 0 ? "none" : selected === total ? "all" : "some",
  };
}

/**
 * What a group's "select all" box changes: every row it can edit set to
 * `ticked` — an explicit tick, never Follow project — but only where the row
 * doesn't already read that way, so a well following a field project that
 * already nominated a type isn't given a choice of its own (nor counted as an
 * unsaved change). Read-only rows ("set on the field project") are left alone.
 * The box ticks all from "none" or "some", and unticks all from "all".
 */
export function groupToggle(
  rows: readonly PickerRow[],
  choices: Readonly<Record<CheckCode, TickChoice>>,
  ticked: boolean = groupTicks(rows, choices).state !== "all",
): Record<CheckCode, TickChoice> {
  const patch: Record<CheckCode, TickChoice> = {};
  for (const row of rows) {
    if (row.kind !== "edit") continue;
    if (isTicked(row, choiceOf(row, choices)) !== ticked) patch[row.check.code] = ticked;
  }
  return patch;
}

/** Whether a row matches the picker's search — its code or label, ignoring
 *  case. Filtering only hides rows: their choices stay, and Save still sends
 *  every change (no pagination: a save covers every tick). */
export function matchesPickerSearch(row: PickerRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return row.check.code.toLowerCase().includes(q) || row.check.label.toLowerCase().includes(q);
}

/**
 * The row's **Checks…** marker as loaded — what the button shows beside it so a
 * row's exceptions stand out at a glance (spec §8.7, phase 6):
 * - "5 of 6" — counted only over the checks that start ticked: one a team
 *   unticked is the exception. A check that starts unticked (phase 7, §3.9)
 *   never counts against the total — it is not selected until nominated, and a
 *   not-selected check is named only inside the tick list (decision 37).
 * - "2 selected" — how many of those that start unticked apply here
 *   (nominated on this target, or followed from its field project).
 * Joined "3 of 4 · 2 selected"; "" when every check that starts ticked is
 * ticked and nothing is nominated — an untouched row reads just "Checks…".
 * Read-only rows ("set on the field project") count like any other: they apply
 * to the target or they don't.
 */
export function pickerBadge(rows: readonly PickerRow[]): string {
  const startTicked = rows.filter((r) => appliesByDefault(r.check));
  const ticked = startTicked.filter((r) => isTicked(r, r.initial)).length;
  const selected = rows.filter((r) => !appliesByDefault(r.check) && isTicked(r, r.initial)).length;
  const parts: string[] = [];
  if (ticked < startTicked.length) parts.push(`${ticked} of ${startTicked.length}`);
  if (selected > 0) parts.push(`${selected} selected`);
  return parts.join(" · ");
}

/** The picker's footer: "Showing 5 of 27 · 2 unsaved changes"; either part
 *  only when it says something ("" when nothing is hidden or unsaved). */
export function pickerFooter(shown: number, total: number, unsaved: number): string {
  const parts: string[] = [];
  if (shown < total) parts.push(`Showing ${shown} of ${total}`);
  if (unsaved > 0) parts.push(`${unsaved} unsaved ${unsaved === 1 ? "change" : "changes"}`);
  return parts.join(" · ");
}

function wellKey(r: Pick<TeamWellRow, "well_project" | "well_name" | "activity_type">): string {
  return `${r.well_project}\u0001${r.well_name}\u0001${r.activity_type}`;
}

/** A team's rows with an applicability response folded in: the response holds
 *  the target's rows (a field project's plus its wells'), built exactly as the
 *  team read builds them, so they replace the rows they match. */
export function mergeApplicability(data: TeamReadiness, result: ApplicabilityResult): TeamReadiness {
  const projects = new Map(result.project_rows.map((r) => [r.well_project, r]));
  const wells = new Map(result.well_rows.map((r) => [wellKey(r), r]));
  return {
    ...data,
    project_rows: data.project_rows.map((r) => projects.get(r.well_project) ?? r),
    well_rows: data.well_rows.map((r) => wells.get(wellKey(r)) ?? r),
  };
}

/** How many wells under a field project have their own choice about any of the
 *  team's two-level checks — the field-project picker says so (§8.7). */
export function wellsWithOwnChoice(
  wellRows: readonly TeamWellRow[],
  wellProject: string,
  checks: readonly CatalogCheck[],
): number {
  const inheriting = checks.filter((c) => !c.locks_with_plan && c.applies_project && c.applies_well);
  return wellRows.filter(
    (r) =>
      r.well_project === wellProject &&
      inheriting.some((c) => r.checks[c.code]?.applies_source === "well"),
  ).length;
}
