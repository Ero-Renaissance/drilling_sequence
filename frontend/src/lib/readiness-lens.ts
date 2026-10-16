import type { Activity } from "@/api/activities";
import {
  getTeamReadiness,
  listReadiness,
  type CatalogCheck,
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
import type { ChartCheckState, ReadinessMap } from "./chart-utils";
import type { TeamCheckDetail } from "./team-summary";

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

/** "All": per activity, each team's WORST status (a summary badge per team),
 *  keeping the checks behind it (`details`) for the tooltip's team summary. */
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
  const gateLabel = new Map(projectGateDefs.map((g) => [g.code, g.label]));
  const map: ReadinessMap = new Map();
  for (const a of activities) {
    if (a.readiness_required === false) continue; // opt-out: no readiness at all
    const summary: Record<string, ChartCheckState> = {};
    const projectGates = a.well_project ? gatesByProject.get(a.well_project) : undefined;
    if (projectGates) {
      const order = projectGateDefs.length
        ? projectGateDefs.map((g) => g.code).filter((c) => c in projectGates)
        : Object.keys(projectGates);
      const details: TeamCheckDetail[] = order.map((code) => ({
        code,
        label: gateLabel.get(code) ?? code,
        status: projectGates[code].status,
      }));
      const worst = worstStatus(details.map((d) => d.status));
      if (worst) summary[PROJECTS_TEAM] = { status: worst, details };
    }
    for (const team of teamData) {
      const values = teamValuesFor(team, a) as
        | Record<string, { status: CheckStatus; tags?: string[]; inherited_tags?: string[] }>
        | undefined;
      if (!values) continue;
      const details: TeamCheckDetail[] = team.checks
        .filter((c) => values[c.code])
        .map((c) => {
          const v = values[c.code];
          return {
            code: c.code,
            label: c.label,
            status: v.status,
            ...(c.tag_list
              ? { tags: [...new Set([...(v.inherited_tags ?? []), ...(v.tags ?? [])])] }
              : {}),
          };
        });
      const worst = worstStatus(details.map((d) => d.status));
      if (worst) summary[team.team.code] = { status: worst, details };
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
