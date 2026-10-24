/**
 * Shared fixtures for the phase 7 "Equipment checks" UI tests
 * (docs/readiness-framework-spec.md §3.9, §8.8): a Logistics team with four
 * core checks and six equipment types in three categories, each starting
 * unticked, and one campaign's team rows as the server serves them.
 *
 * Bonga Phase 3 (field project) unticked NAV and nominated DSV (On Track) and
 * PSV (Behind); nothing nominated PC, JUB, CBG or CR there.
 * - W-1 follows Bonga, and ticked CR (Completed) itself.
 * - W-2 follows Bonga, but unticked DSV itself — "Not applicable", not "not
 *   selected".
 */
import type {
  CatalogCheck,
  CatalogTeam,
  CheckSource,
  CheckStatus,
  EffectiveCheckState,
  TeamCheckState,
  TeamReadiness,
} from "@/api/readiness";

export const PID = "cccccccc-0000-0000-0000-000000000001";

export const LOGISTICS: CatalogTeam = {
  code: "logistics", name: "Logistics", editor_source: "team_grant", icon_key: "truck", sort_order: 20,
};

export const core = (
  code: string,
  label: string,
  sort_order: number,
  over: Partial<CatalogCheck> = {},
): CatalogCheck => ({
  code, label, team_code: "logistics", applies_project: true, applies_well: true,
  status_set: "standard", icon_key: "receipt", locks_with_plan: false, sort_order,
  category: "", applies_by_default: true, ...over,
});

export const equip = (
  code: string,
  label: string,
  category: string,
  icon_key: string,
  sort_order: number,
): CatalogCheck => core(code, label, sort_order, { category, icon_key, applies_by_default: false });

export const LBUD = core("L-BUD", "Budget Availability", 10, { icon_key: "hand-coins" });
export const CTR = core("CTR", "Contract Availability", 20, { icon_key: "file-signature" });
export const PO = core("PO", "Purchase Order", 50, { icon_key: "receipt" });
export const NAV = core("NAV", "Naval Clearance", 60, { icon_key: "ship" });
export const DSV = equip("DSV", "Diving Support Vessel", "Vessels", "anchor", 101);
export const PSV = equip("PSV", "Platform Support Vessel", "Vessels", "anchor", 105);
export const PC = equip("PC", "Personnel Carrier", "Vessels", "anchor", 108);
export const JUB = equip("JUB", "Jack-up Barge", "Barges", "container", 109);
export const CBG = equip("CBG", "Crane Barge", "Barges", "container", 112);
export const CR = equip("CR", "Crane", "Lifting", "construction", 120);

/** The Logistics checks in catalog order: 4 core + 6 equipment types. */
export const LOGISTICS_CHECKS: CatalogCheck[] = [LBUD, CTR, PO, NAV, DSV, PSV, PC, JUB, CBG, CR];

/** A field-project cell: applies (`source` of the tick), or not. */
export function pcell(status: CheckStatus, applies = true, applies_source: CheckSource = "default"): TeamCheckState {
  return { status, notes: null, updated_at: null, applies, applies_source };
}
/** Applies because a ROW says so (the field project nominated it). */
export const nominated = (status: CheckStatus) => pcell(status, true, "project");
/** Doesn't apply because a row says so — "Not applicable". */
export const unticked = (status: CheckStatus, source: CheckSource = "project") => pcell(status, false, source);
/** Starts unticked and nothing nominated it — NOT SELECTED. */
export const notSelectedCell = (): TeamCheckState => pcell("On Track", false, "default");

/** A well's cell — `source` is where its STATUS comes from. */
export function wcell(
  status: CheckStatus,
  applies: boolean,
  applies_source: CheckSource,
  source: CheckSource,
): EffectiveCheckState {
  return { ...pcell(status, applies, applies_source), source };
}

export const BONGA_CELLS: Record<string, TeamCheckState> = {
  "L-BUD": pcell("Completed"),
  CTR: pcell("On Track"),
  PO: pcell("On Track"),
  NAV: unticked("Completed"),
  DSV: nominated("On Track"),
  PSV: nominated("Behind"),
  PC: notSelectedCell(),
  JUB: notSelectedCell(),
  CBG: notSelectedCell(),
  CR: notSelectedCell(),
};

export const W1_CELLS: Record<string, EffectiveCheckState> = {
  "L-BUD": wcell("Completed", true, "default", "project"),
  CTR: wcell("On Track", true, "default", "project"),
  PO: wcell("On Track", true, "default", "project"),
  NAV: wcell("Completed", false, "project", "project"),
  DSV: wcell("On Track", true, "project", "project"),
  PSV: wcell("Behind", true, "project", "project"),
  PC: wcell("On Track", false, "default", "default"),
  JUB: wcell("On Track", false, "default", "default"),
  CBG: wcell("On Track", false, "default", "default"),
  CR: wcell("Completed", true, "well", "well"),
};

export const W2_CELLS: Record<string, EffectiveCheckState> = {
  ...W1_CELLS,
  DSV: wcell("On Track", false, "well", "project"),
  CR: wcell("On Track", false, "default", "default"),
};

export function equipmentTeam(): TeamReadiness {
  return {
    team: LOGISTICS,
    checks: LOGISTICS_CHECKS,
    locked: false,
    project_rows: [
      {
        well_project: "Bonga Phase 3", activity_count: 2, focus_start: "2026-11-01",
        checks: BONGA_CELLS,
      },
    ],
    well_rows: [
      {
        well_project: "Bonga Phase 3", well_name: "W-1", activity_type: "Oil Development", activity_count: 1,
        location: "SWAMP", start_date: "2026-11-01", focus_start: "2026-11-01",
        checks: W1_CELLS,
      },
      {
        well_project: "Bonga Phase 3", well_name: "W-2", activity_type: "Oil Development", activity_count: 1,
        location: "SWAMP", start_date: "2026-12-01", focus_start: "2026-12-01",
        checks: W2_CELLS,
      },
    ],
  };
}
