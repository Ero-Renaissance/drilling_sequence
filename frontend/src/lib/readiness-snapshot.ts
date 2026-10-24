import type { CatalogCheck, CatalogTeam, CheckStatus } from "@/api/readiness";
import type { PrintRow } from "@/components/revisions/RevisionPrintDoc";
import { ALL_LENS, PROJECTS_TEAM, lensChecksOf, type Lens } from "@/components/readiness/catalog";
import { applies, worstStatus } from "@/components/readiness/check-meta";
import { stripChecksOf, withCategoryCells } from "./chart-layout";
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
 * A team check recorded as N/A didn't apply (spec §3.8, `applies()` against its
 * FROZEN definition): it isn't drawn, and a team where nothing applied gets no
 * badge. A check that was not selected at submission isn't recorded at all
 * (phase 7, §6), so it draws nothing either. The Project gates print as stored
 * — grey N/A icons included.
 * Under a team lens a category prints ONE icon (phase 7, §8.8), keyed
 * `categoryCode(name)`: the worst of its types that applied, from the
 * categories FROZEN with the revision — the print draws `stripChecksOf` of the
 * same frozen definitions. The All lens's badges are the worst of everything
 * that applied, types included.
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

  const defsOf = (team: string) => frozen.filter((c) => c.team_code === team);
  // The team's checks recorded for this row that applied, in catalog order.
  const recorded = (r: PrintRow, defs: CatalogCheck[]): [string, CheckStatus][] =>
    defs.flatMap((c) => {
      const cell = r.readiness_at_submission?.[c.code];
      return cell && applies(cell, c) ? [[c.code, cell.status] as [string, CheckStatus]] : [];
    });

  if (lens === ALL_LENS) {
    return rows.map((r) => {
      const summary: Record<string, CheckStatus> = {};
      const gates = r.well_project ? Object.values(r.readiness ?? {}) : [];
      const gatesWorst = worstStatus(gates);
      if (gatesWorst) summary[PROJECTS_TEAM] = gatesWorst;
      for (const team of teams) {
        if (team.code === PROJECTS_TEAM) continue;
        const worst = worstStatus(recorded(r, defsOf(team.code)).map(([, status]) => status));
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

  // The lens's frozen definitions in catalog order (a category wears its first
  // type's icon), and the strip they print: core checks, then one per category.
  const defs = lensChecksOf(frozen, lens);
  const strip = stripChecksOf(defs);
  const perWell = defs.some((c) => c.applies_well);
  return rows.map((r) => {
    const cells = withCategoryCells(defs, r.readiness_at_submission ?? {});
    const values: Record<string, CheckStatus> = Object.fromEntries(
      strip.flatMap((c) => {
        const cell = cells[c.code];
        return cell && applies(cell, c) ? [[c.code, cell.status] as [string, CheckStatus]] : [];
      }),
    );
    const any = Object.keys(values).length > 0;
    return {
      ...r,
      readiness: any ? values : undefined,
      readiness_required: any ? r.readiness_required : false,
      readiness_key: perWell ? wellKeyOf(r) : r.well_project,
    };
  });
}
