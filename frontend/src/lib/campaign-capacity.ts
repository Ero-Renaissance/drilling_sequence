/**
 * Per-campaign "rigs & well spuds" aggregation for the overview comparison chart.
 *
 *  - Rigs: distinct rigs *active* in a year (any activity overlapping it), counted
 *    per location — the stacked bars.
 *  - Spuds: distinct *wells*, each counted once in the year its earliest oil/gas
 *    drilling activity starts — the oil/gas lines.
 *
 * Pure + side-effect free so it's unit-tested directly.
 */
import type { Activity } from "@/api/activities";
import { resolveSpudClass, type SpudMap } from "./spud-classification";

export const CAPACITY_LOCATIONS = ["LAND", "SWAMP", "OFFSHORE"] as const;
export type CapacityLocation = (typeof CAPACITY_LOCATIONS)[number];

export interface CapacityData {
  /** Contiguous year axis, min start year … max end year across all activities. */
  years: number[];
  /** Distinct rigs active each year, per location (each array parallel to `years`). */
  rigsByLocation: Record<CapacityLocation, number[]>;
  /** Distinct wells whose first oil-spud activity starts each year. */
  oilSpuds: number[];
  /** Exploration spuds — oil and gas exploration combined (no market split:
   *  a prospecting well has no committed market). */
  explorationSpuds: number[];
  /** Gas spuds split by the project's Market assignment (Domestic vs Export).
   *  A gas spud whose project carries no gas market (unset, Oil or Not
   *  Applicable) lands in `unassignedGasSpuds` — shown, never guessed. */
  domesticGasSpuds: number[];
  exportGasSpuds: number[];
  unassignedGasSpuds: number[];
}

function yearOf(iso: string | null): number | null {
  if (!iso) return null;
  const y = Number(iso.slice(0, 4));
  return Number.isInteger(y) && y > 1900 ? y : null;
}

function isCapacityLocation(loc: string | null): loc is CapacityLocation {
  return loc === "LAND" || loc === "SWAMP" || loc === "OFFSHORE";
}

const empty = (): CapacityData => ({
  years: [],
  rigsByLocation: { LAND: [], SWAMP: [], OFFSHORE: [] },
  oilSpuds: [],
  explorationSpuds: [],
  domesticGasSpuds: [],
  exportGasSpuds: [],
  unassignedGasSpuds: [],
});

type GasKind = "domestic" | "export" | "unassigned";

/** A gas spud's market bucket: the activity's own Market, else its project's
 *  (rows of one project share the assignment; older rows may predate it). */
function gasKindOf(a: Activity, marketByProject: Map<string, string>): GasKind {
  const market = a.market ?? (a.well_project ? marketByProject.get(a.well_project) : null);
  if (market === "Domestic Gas") return "domestic";
  if (market === "Export Gas") return "export";
  return "unassigned";
}

export function aggregateCapacity(activities: Activity[], spudMap: SpudMap): CapacityData {
  // ── Year span ──
  let minYear = Infinity;
  let maxYear = -Infinity;
  for (const a of activities) {
    for (const y of [yearOf(a.start_date), yearOf(a.end_date)]) {
      if (y !== null) {
        minYear = Math.min(minYear, y);
        maxYear = Math.max(maxYear, y);
      }
    }
  }
  if (!Number.isFinite(minYear) || !Number.isFinite(maxYear)) return empty();

  const years: number[] = [];
  for (let y = minYear; y <= maxYear; y++) years.push(y);
  const idxOf = new Map(years.map((y, i) => [y, i]));

  // ── Rigs active per year, per location ──
  const rigSets: Record<CapacityLocation, Set<string>[]> = {
    LAND: years.map(() => new Set<string>()),
    SWAMP: years.map(() => new Set<string>()),
    OFFSHORE: years.map(() => new Set<string>()),
  };
  // Mobilisation / intake is preparation, not deployed drilling capacity: a
  // rig whose ONLY presence in a year is mobilisation (the classic Nov–Dec
  // move before a January spud) must not inflate that year's rig count. Such
  // activities simply don't contribute rig-years; a rig that also drills in
  // the year is still counted through its other activities. Deliberately
  // scoped to THIS chart — the Fleet views answer "is the unit occupied/on
  // contract?", where mobilisation rightly counts.
  const isMobilisation = (t: string) => /mobilis|mobiliz|intake/i.test(t);
  for (const a of activities) {
    if (!a.rig_name || !isCapacityLocation(a.location)) continue;
    if (isMobilisation(a.activity_type)) continue;
    const sy = yearOf(a.start_date);
    const ey = yearOf(a.end_date);
    if (sy === null || ey === null) continue;
    for (let y = Math.max(sy, minYear); y <= Math.min(ey, maxYear); y++) {
      rigSets[a.location][idxOf.get(y)!].add(a.rig_name);
    }
  }
  const rigsByLocation: Record<CapacityLocation, number[]> = {
    LAND: rigSets.LAND.map((s) => s.size),
    SWAMP: rigSets.SWAMP.map((s) => s.size),
    OFFSHORE: rigSets.OFFSHORE.map((s) => s.size),
  };

  // ── Well spuds: each well's earliest oil/gas drilling activity ──
  // Market is assigned per project; resolve each project's value first (first
  // non-empty wins — the import enforces one per project) so a spud row that
  // predates the assignment still inherits its project's market.
  const marketByProject = new Map<string, string>();
  for (const a of activities) {
    if (a.well_project && a.market && !marketByProject.has(a.well_project)) {
      marketByProject.set(a.well_project, a.market);
    }
  }

  const wellSpud = new Map<string, { year: number; cls: "oil" | "gas" | "exploration"; gas: GasKind }>();
  for (const a of activities) {
    if (!a.well_name) continue;
    const cls = resolveSpudClass(a.activity_type, spudMap);
    if (cls === "exclude") continue;
    const y = yearOf(a.start_date);
    if (y === null) continue;
    const prev = wellSpud.get(a.well_name);
    if (!prev || y < prev.year) {
      wellSpud.set(a.well_name, { year: y, cls, gas: gasKindOf(a, marketByProject) });
    }
  }
  const oilSpuds = years.map(() => 0);
  const explorationSpuds = years.map(() => 0);
  const domesticGasSpuds = years.map(() => 0);
  const exportGasSpuds = years.map(() => 0);
  const unassignedGasSpuds = years.map(() => 0);
  for (const { year, cls, gas } of wellSpud.values()) {
    const i = idxOf.get(year);
    if (i === undefined) continue;
    if (cls === "oil") oilSpuds[i] += 1;
    else if (cls === "exploration") explorationSpuds[i] += 1;
    else if (gas === "domestic") domesticGasSpuds[i] += 1;
    else if (gas === "export") exportGasSpuds[i] += 1;
    else unassignedGasSpuds[i] += 1;
  }

  return {
    years,
    rigsByLocation,
    oilSpuds,
    explorationSpuds,
    domesticGasSpuds,
    exportGasSpuds,
    unassignedGasSpuds,
  };
}

/**
 * Clip a campaign's series to its first `horizon` years (the planner's chosen
 * view span). `null` = the full span. Pure slice — parallel arrays stay aligned.
 */
export function windowCapacity(data: CapacityData, horizon: number | null): CapacityData {
  if (horizon === null || data.years.length <= horizon) return data;
  const cut = <T,>(arr: T[]) => arr.slice(0, horizon);
  return {
    years: cut(data.years),
    rigsByLocation: {
      LAND: cut(data.rigsByLocation.LAND),
      SWAMP: cut(data.rigsByLocation.SWAMP),
      OFFSHORE: cut(data.rigsByLocation.OFFSHORE),
    },
    oilSpuds: cut(data.oilSpuds),
    explorationSpuds: cut(data.explorationSpuds),
    domesticGasSpuds: cut(data.domesticGasSpuds),
    exportGasSpuds: cut(data.exportGasSpuds),
    unassignedGasSpuds: cut(data.unassignedGasSpuds),
  };
}
