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
    const ticked = cell?.applies ?? true; // every check starts ticked
    const plain = (kind: PickerRow["kind"], value: boolean): PickerRow[] => [
      { check, kind, inherits: false, initial: value, projectApplies: value },
    ];
    if (!onWell) return check.applies_project ? plain("edit", ticked) : [];
    if (!check.applies_well) {
      if (!hasProject) return [];
      return plain("project", cell?.applies ?? projectCells?.[check.code]?.applies ?? true);
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
        // read the project's row (ticked when unknown — the default).
        projectApplies: own ? (projectCells?.[check.code]?.applies ?? true) : ticked,
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
 *  project never sends `null` — it has nothing to follow (422). */
export function applicabilityBody(
  target: ReadinessTarget,
  applies: Record<CheckCode, TickChoice>,
): ApplicabilityUpdate {
  if (target.scope === "project") {
    const ticks: Record<CheckCode, boolean> = {};
    for (const [code, choice] of Object.entries(applies)) ticks[code] = choice ?? true;
    return { scope: "project", well_project: target.well_project, applies: ticks };
  }
  return { ...target, applies };
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
