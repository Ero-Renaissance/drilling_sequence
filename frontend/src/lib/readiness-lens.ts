import type { Activity } from "@/api/activities";
import {
  getTeamReadiness,
  listReadiness,
  type CatalogTeam,
  type CheckStatus,
  type TeamReadiness,
} from "@/api/readiness";
import {
  ALL_LENS,
  NO_LENS,
  PROJECTS_TEAM,
  type Lens,
} from "@/components/readiness/catalog";
import { worstStatus } from "@/components/readiness/check-meta";
import type { ReadinessMap } from "./chart-utils";

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
 *  its well row (teams with well-level checks) or its field project's row. */
export function teamValuesFor(
  team: TeamReadiness,
  a: Pick<Activity, "well_project" | "well_name" | "activity_type">,
): Record<string, { status: CheckStatus }> | undefined {
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

/** "All": per activity, each team's WORST status (a summary badge per team). */
async function loadAll(
  projectId: string,
  activities: readonly Activity[],
  teams: readonly CatalogTeam[],
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
    const summary: Record<string, { status: CheckStatus }> = {};
    const projectGates = a.well_project ? gatesByProject.get(a.well_project) : undefined;
    const projectWorst = projectGates
      ? worstStatus(Object.values(projectGates).map((v) => v.status))
      : undefined;
    if (projectWorst) summary[PROJECTS_TEAM] = { status: projectWorst };
    for (const team of teamData) {
      const values = teamValuesFor(team, a);
      const worst = values ? worstStatus(Object.values(values).map((v) => v.status)) : undefined;
      if (worst) summary[team.team.code] = { status: worst };
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
 * - "all" → per activity, each team's worst status (needs the activities and
 *   the teams);
 * - "none" → nothing.
 */
export async function loadLensReadiness(
  projectId: string,
  lens: Lens,
  context: { activities?: readonly Activity[]; teams?: readonly CatalogTeam[] } = {},
): Promise<LensReadiness> {
  if (lens === NO_LENS) return { map: new Map(), keyOf: () => null };
  if (lens === ALL_LENS) return loadAll(projectId, context.activities ?? [], context.teams ?? []);
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
          r.checks as Record<string, { status: CheckStatus }>,
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
