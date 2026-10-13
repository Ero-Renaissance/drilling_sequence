import type { Activity } from "@/api/activities";
import {
  getTeamReadiness,
  listReadiness,
  type CheckStatus,
} from "@/api/readiness";
import { NO_LENS, PROJECTS_TEAM, type Lens } from "@/components/readiness/catalog";
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

/**
 * Load one lens's readiness for a campaign, shaped for the chart and the print:
 * - project gates → the field-project rows, keyed by field project;
 * - a team with well-level checks → its well rows (every check's EFFECTIVE
 *   value, inherited where it applies), keyed by well;
 * - a team with only project-level checks → its project rows;
 * - "none" → nothing.
 */
export async function loadLensReadiness(projectId: string, lens: Lens): Promise<LensReadiness> {
  if (lens === NO_LENS) return { map: new Map(), keyOf: () => null };
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
