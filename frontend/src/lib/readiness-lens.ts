import type { Activity } from "@/api/activities";
import {
  getTeamReadiness,
  listReadiness,
  type CatalogCheck,
  type CatalogTeam,
  type CheckStatus,
  type TeamCheckState,
  type TeamReadiness,
} from "@/api/readiness";
import {
  ALL_LENS,
  NO_LENS,
  PROJECTS_TEAM,
  type Lens,
} from "@/components/readiness/catalog";
import type { ReadinessCell } from "@/components/readiness/check-meta";
import { barStripCodes, type StripCheck } from "./chart-layout";
import type { ChartCheckState, ReadinessMap } from "./chart-utils";
import { summariseTeam, teamDetails, type TeamCheckDetail } from "./team-summary";

/** How an activity finds its readiness under a lens: the map key for it, or null
 *  (no readiness under this lens — e.g. no well name for a well lens). */
export type ReadinessKeyOf = (a: Pick<Activity, "well_project" | "well_name" | "activity_type">) => string | null;

/** Field-project key — the project gates, and teams with only project-level checks. */
export const projectKeyOf: ReadinessKeyOf = (a) => a.well_project || null;

/** Well key — project + well + activity type, matching the backend's well rows
 *  ("" for a well with no field project). */
export const wellKeyOf: ReadinessKeyOf = (a) =>
  a.well_name ? `${a.well_project ?? ""}\u0001${a.well_name}\u0001${a.activity_type}` : null;

export interface LensReadiness {
  map: ReadinessMap;
  keyOf: ReadinessKeyOf;
}

/** One activity's readiness under a team lens, from that team's lens data:
 *  its well row (teams with well-level checks) or its field project's row. The
 *  cells are as served — `applies: false` ones included; consumers drop them
 *  with `applies()`. */
export function teamValuesFor(
  team: TeamReadiness,
  a: Pick<Activity, "well_project" | "well_name" | "activity_type">,
): Record<string, TeamCheckState> | undefined {
  if (team.checks.some((c) => c.applies_well)) {
    if (!a.well_name) return undefined;
    return team.well_rows.find(
      (r) =>
        r.well_project === (a.well_project ?? "") &&
        r.well_name === a.well_name &&
        r.activity_type === a.activity_type,
    )?.checks;
  }
  return a.well_project
    ? team.project_rows.find((r) => r.well_project === a.well_project)?.checks
    : undefined;
}

/** One team's badge for one activity, from its details: the worst of the
 *  checks that apply; `applies: false` when none does (no badge — the tooltip
 *  still lists them as "Not applicable"); nothing when the team has no cell
 *  here at all. */
function teamBadge(details: TeamCheckDetail[]): ChartCheckState | undefined {
  if (details.length === 0) return undefined;
  const summary = summariseTeam(details);
  return summary
    ? { status: summary.worst, details }
    : { status: "N/A", applies: false, details };
}

/** "All": per activity, each team's WORST status (a summary badge per team),
 *  keeping the checks behind it (`details`) for the tooltip's team summary. A
 *  team check that doesn't apply is dropped before the worst is taken; the
 *  Project gates pass through, so all-N/A gates still give the grey badge. */
async function loadAll(
  projectId: string,
  activities: readonly Activity[],
  teams: readonly CatalogTeam[],
  projectGateDefs: readonly CatalogCheck[],
): Promise<LensReadiness> {
  const [gates, ...teamData] = await Promise.all([
    listReadiness(projectId),
    ...teams
      .filter((t) => t.code !== PROJECTS_TEAM)
      .map((t) => getTeamReadiness(projectId, t.code)),
  ]);
  const gatesByProject = new Map(gates.map((r) => [r.well_project, r.checks]));
  const map: ReadinessMap = new Map();
  for (const a of activities) {
    if (a.readiness_required === false) continue; // opt-out: no readiness at all
    const summary: Record<string, ChartCheckState> = {};
    const projectGates = a.well_project ? gatesByProject.get(a.well_project) : undefined;
    if (projectGates) {
      // Catalog order; without definitions, the row's own (every gate locks
      // with the plan, so each one applies).
      const defs = projectGateDefs.length
        ? projectGateDefs
        : Object.keys(projectGates).map((code) => ({ code, label: code, locks_with_plan: true }));
      const badge = teamBadge(teamDetails(defs, projectGates));
      if (badge) summary[PROJECTS_TEAM] = badge;
    }
    for (const team of teamData) {
      const badge = teamBadge(teamDetails(team.checks, teamValuesFor(team, a)));
      if (badge) summary[team.team.code] = badge;
    }
    if (Object.keys(summary).length > 0) map.set(a.id, summary);
  }
  // Keyed per activity: every bar carries its own team badges.
  return { map, keyOf: (a) => ("id" in a ? (a as Activity).id : null) };
}

/**
 * Load one lens's readiness for a campaign, shaped for the chart and the print:
 * - project gates → the field-project rows, keyed by field project;
 * - a team with well-level checks → its well rows (every check's EFFECTIVE
 *   value, inherited where it applies), keyed by well;
 * - a team with only project-level checks → its project rows;
 * - a team's cells keep `applies` as served: the chart drops the ones that
 *   don't apply (chart-layout, via `applies()`) and lists them only in its
 *   live tooltip;
 * - "all" → per activity, each team's worst status (needs the activities and
 *   the teams);
 * - "none" → nothing.
 */
export async function loadLensReadiness(
  projectId: string,
  lens: Lens,
  context: {
    activities?: readonly Activity[];
    teams?: readonly CatalogTeam[];
    /** The project gates' definitions — names them in the All lens summary. */
    projectGates?: readonly CatalogCheck[];
  } = {},
): Promise<LensReadiness> {
  if (lens === NO_LENS) return { map: new Map(), keyOf: () => null };
  if (lens === ALL_LENS) {
    return loadAll(
      projectId,
      context.activities ?? [],
      context.teams ?? [],
      context.projectGates ?? [],
    );
  }
  if (lens === PROJECTS_TEAM) {
    const rows = await listReadiness(projectId);
    return {
      map: new Map(rows.map((r) => [r.well_project, r.checks])),
      keyOf: projectKeyOf,
    };
  }
  const team = await getTeamReadiness(projectId, lens);
  if (team.checks.some((c) => c.applies_well)) {
    return {
      map: new Map(
        team.well_rows.map((r) => [
          `${r.well_project}\u0001${r.well_name}\u0001${r.activity_type}`,
          r.checks,
        ]),
      ),
      keyOf: wellKeyOf,
    };
  }
  return {
    map: new Map(team.project_rows.map((r) => [r.well_project, r.checks])),
    keyOf: projectKeyOf,
  };
}

/**
 * One activity's lens cells as a print row's `readiness` (code → status), in
 * catalog order: only the cells that apply (spec §8.4) — the chart strip's own
 * rule (`barStripCodes`, `applies()` against `defs`, the print lens's checks).
 * So an unticked team check never prints the status kept underneath it, and the
 * All lens prints no badge for a team where nothing applies; the Project gates
 * print as they read, N/A included. Undefined when nothing is left: the row
 * prints no strip.
 */
export function printedReadiness(
  cells: Record<string, ReadinessCell> | undefined,
  defs: readonly StripCheck[],
  allLens: boolean,
): Record<string, CheckStatus> | undefined {
  if (!cells) return undefined;
  const drawn = barStripCodes(defs, cells, allLens).filter((code) => cells[code] !== undefined);
  return drawn.length > 0
    ? Object.fromEntries(drawn.map((code) => [code, cells[code].status]))
    : undefined;
}
