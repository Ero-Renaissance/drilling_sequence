import type { CatalogCheck, CatalogTeam, CheckStatus } from "@/api/readiness";
import type { PrintRow } from "@/components/revisions/RevisionPrintDoc";
import { ALL_LENS, PROJECTS_TEAM, type Lens } from "@/components/readiness/catalog";
import { worstStatus } from "@/components/readiness/check-meta";
import { wellKeyOf } from "./readiness-lens";

/** Whether a revision recorded team (live) readiness at submission — revisions
 *  from before Phase 4 only carry the project gates. */
export function hasTeamReadiness(rows: readonly PrintRow[]): boolean {
  return rows.some((r) => r.readiness_at_submission !== undefined);
}

/**
 * A revision's print rows through a lens, from what the snapshot froze:
 * - project gates → the rows as stored (`readiness`);
 * - a team → that team's checks from `readiness_at_submission`, one strip per well
 *   (or per field project for a project-level-only team);
 * - "all" → per row, each team's WORST status as one badge per team.
 * Rows with nothing under the lens print no strip. `frozen` is the revision's
 * frozen catalog (which checks belong to which team, as at submission).
 */
export function snapshotRowsForLens(
  rows: readonly PrintRow[],
  lens: Lens,
  frozen: readonly CatalogCheck[],
  teams: readonly CatalogTeam[],
): PrintRow[] {
  if (lens === PROJECTS_TEAM) return [...rows];

  const codesOf = (team: string) => frozen.filter((c) => c.team_code === team).map((c) => c.code);
  const recorded = (r: PrintRow, codes: string[]): CheckStatus[] =>
    codes
      .map((c) => r.readiness_at_submission?.[c]?.status)
      .filter((s): s is CheckStatus => s !== undefined);

  if (lens === ALL_LENS) {
    return rows.map((r) => {
      const summary: Record<string, CheckStatus> = {};
      const gates = r.well_project ? Object.values(r.readiness ?? {}) : [];
      const gatesWorst = worstStatus(gates);
      if (gatesWorst) summary[PROJECTS_TEAM] = gatesWorst;
      for (const team of teams) {
        if (team.code === PROJECTS_TEAM) continue;
        const worst = worstStatus(recorded(r, codesOf(team.code)));
        if (worst) summary[team.code] = worst;
      }
      const any = Object.keys(summary).length > 0;
      return {
        ...r,
        readiness: any ? summary : undefined,
        readiness_required: any ? r.readiness_required : false,
        readiness_key: r.id, // every bar carries its own team badges
      };
    });
  }

  const codes = codesOf(lens);
  const perWell = frozen.some((c) => c.team_code === lens && c.applies_well);
  return rows.map((r) => {
    const values = Object.fromEntries(
      codes
        .filter((c) => r.readiness_at_submission?.[c])
        .map((c) => [c, r.readiness_at_submission![c].status]),
    ) as Record<string, CheckStatus>;
    const any = Object.keys(values).length > 0;
    return {
      ...r,
      readiness: any ? values : undefined,
      readiness_required: any ? r.readiness_required : false,
      readiness_key: perWell ? wellKeyOf(r) : r.well_project,
    };
  });
}
