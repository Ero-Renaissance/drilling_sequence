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
  /** Distinct wells whose first gas-spud activity starts each year. */
  gasSpuds: number[];
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
  gasSpuds: [],
});

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
  for (const a of activities) {
    if (!a.rig_name || !isCapacityLocation(a.location)) continue;
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
  const wellSpud = new Map<string, { year: number; cls: "oil" | "gas" }>();
  for (const a of activities) {
    if (!a.well_name) continue;
    const cls = resolveSpudClass(a.activity_type, spudMap);
    if (cls === "exclude") continue;
    const y = yearOf(a.start_date);
    if (y === null) continue;
    const prev = wellSpud.get(a.well_name);
    if (!prev || y < prev.year) wellSpud.set(a.well_name, { year: y, cls });
  }
  const oilSpuds = years.map(() => 0);
  const gasSpuds = years.map(() => 0);
  for (const { year, cls } of wellSpud.values()) {
    const i = idxOf.get(year);
    if (i === undefined) continue;
    if (cls === "oil") oilSpuds[i] += 1;
    else gasSpuds[i] += 1;
  }

  return { years, rigsByLocation, oilSpuds, gasSpuds };
}
