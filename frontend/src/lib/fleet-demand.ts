/**
 * Per-year fleet demand for the Fleet tab's procurement chart: how many
 * distinct units the plan occupies each year, split AWARDED vs PLANNED
 * (placeholder slots with no awarded unit behind them) — the "when do we need
 * awards, and how hard" instrument. Pure and unit-tested.
 */
import type { Activity } from "@/api/activities";
import type { ResourceRecord } from "@/api/resources";
import { rigLaneKey } from "@/lib/resource-identity";

export interface FleetDemand {
  years: number[];
  /** Parallel to years: distinct AWARDED units active that year. */
  awarded: number[];
  /** Parallel to years: distinct PLANNED (placeholder) units active. */
  planned: number[];
  /** Registered units with no dated activity at all — visible in the registry
   *  and the counts' future, but on no chart lane yet. */
  unscheduled: string[];
}

/** Lane identity shared by the demand chart and the registry's year filter. */
export const unitLaneKey = (kind: "rig" | "hwu", name: string, terrain: string | null) =>
  kind === "hwu" ? `hwu|${name.trim().toLowerCase()}` : `rig|${rigLaneKey(terrain, name)}`;

function yearOf(iso: string | null): number | null {
  if (!iso) return null;
  const y = Number(iso.slice(0, 4));
  return Number.isInteger(y) && y > 1900 ? y : null;
}

/**
 * Calendar years each unit lane (rig AND HWU) has scheduled work in — drives
 * the registry's "active in year" filter. One map for both kinds; keys are
 * kind-prefixed so they can't collide.
 */
export function computeLaneYears(activities: Activity[]): Map<string, Set<number>> {
  const out = new Map<string, Set<number>>();
  for (const a of activities) {
    const sy = yearOf(a.start_date);
    const ey = yearOf(a.end_date);
    if (sy === null || ey === null) continue;
    const lanes: string[] = [];
    if (a.rig_name) lanes.push(unitLaneKey("rig", a.rig_name, a.location ?? null));
    if (a.hwu_name) lanes.push(unitLaneKey("hwu", a.hwu_name, null));
    for (const lane of lanes) {
      const set = out.get(lane) ?? new Set<number>();
      for (let y = sy; y <= ey; y++) set.add(y);
      out.set(lane, set);
    }
  }
  return out;
}

export function computeFleetDemand(
  kind: "rig" | "hwu",
  activities: Activity[],
  registry: ResourceRecord[],
  opts: { terrain?: "LAND" | "SWAMP" | "OFFSHORE" } = {},
): FleetDemand {
  // Terrain scoping applies to rigs only — HWUs are mobile (no terrain).
  const terrain = kind === "rig" ? opts.terrain : undefined;

  const placeholderByLane = new Map<string, boolean>();
  for (const r of registry) {
    if (r.kind !== kind) continue;
    if (terrain && r.terrain !== terrain) continue;
    placeholderByLane.set(unitLaneKey(r.kind, r.name, r.terrain || null), r.is_placeholder);
  }

  // Which lanes are active in which years.
  const yearsByLane = new Map<string, Set<number>>();
  let minYear = Infinity;
  let maxYear = -Infinity;
  for (const a of activities) {
    const name = kind === "rig" ? a.rig_name : a.hwu_name;
    if (!name) continue;
    if (terrain && a.location !== terrain) continue;
    const sy = yearOf(a.start_date);
    const ey = yearOf(a.end_date);
    if (sy === null || ey === null) continue;
    const lane = unitLaneKey(kind, name, kind === "rig" ? (a.location ?? null) : null);
    const set = yearsByLane.get(lane) ?? new Set<number>();
    for (let y = sy; y <= ey; y++) set.add(y);
    yearsByLane.set(lane, set);
    minYear = Math.min(minYear, sy);
    maxYear = Math.max(maxYear, ey);
  }

  const years: number[] = [];
  if (Number.isFinite(minYear)) for (let y = minYear; y <= maxYear; y++) years.push(y);

  const awarded = years.map(() => 0);
  const planned = years.map(() => 0);
  for (const [lane, active] of yearsByLane) {
    const isPlanned = placeholderByLane.get(lane) ?? false;
    for (const y of active) {
      const i = years.indexOf(y);
      if (i === -1) continue;
      if (isPlanned) planned[i] += 1;
      else awarded[i] += 1;
    }
  }

  const unscheduled = registry
    .filter((r) => r.kind === kind && (!terrain || r.terrain === terrain))
    .filter((r) => !yearsByLane.has(unitLaneKey(r.kind, r.name, r.terrain || null)))
    .map((r) => (r.is_placeholder ? `${r.name} (planned)` : r.name))
    .sort((a, b) => a.localeCompare(b));

  return { years, awarded, planned, unscheduled };
}
