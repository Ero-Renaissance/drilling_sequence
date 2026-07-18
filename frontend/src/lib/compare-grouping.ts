/**
 * Grouping logic for the Compare views' change list — pure functions so the
 * "which bucket does a change land in" decisions are unit-tested without
 * rendering the editor.
 *
 * Two groupings exist: by RESOURCE (rig / HWU / no-resource — the forensic
 * view) and by TERRAIN (LAND / SWAMP / OFFSHORE — the default rollup, since a
 * per-rig list scales linearly with fleet size while terrains stay at three).
 */
import type { ChangeNote, ChangeNoteKind } from "@/api/change-notes";
import type { ActivityDiff, ContractDiff } from "@/api/compare";

export type CompareGrouping = "terrain" | "resource";

export const TERRAINS = ["LAND", "SWAMP", "OFFSHORE"] as const;

export interface DiffGroup {
  /** Note key for the group's change note; "unassigned" groups carry no note
   *  (an activity without a terrain is a data-quality gap, not a bucket the
   *  planner narrates). */
  kind: ChangeNoteKind | "unassigned";
  resourceName: string | null;
  label: string;
  activities: ActivityDiff[];
  contracts: ContractDiff[];
  /** Distinct rigs/HWUs contributing — header context for terrain groups. */
  resourceCount: number;
}

export const groupKey = (kind: string, name: string | null) => `${kind}:${name ?? ""}`;

export const labelFor = (kind: ChangeNoteKind, name: string | null) =>
  kind === "hwu"
    ? `HWU · ${name ?? ""}`
    : kind === "general"
      ? "No resource"
      : kind === "terrain"
        ? (name ?? "")
        : (name ?? "");

export function resourceOf(a: ActivityDiff): {
  kind: ChangeNoteKind;
  name: string | null;
  label: string;
} {
  if (a.rig_name) return { kind: "rig", name: a.rig_name, label: a.rig_name };
  if (a.hwu_name) return { kind: "hwu", name: a.hwu_name, label: `HWU · ${a.hwu_name}` };
  return { kind: "general", name: null, label: "No resource" };
}

/** A ContractDiff.resource is the rig name, or "HWU · <name>". */
export function parseContractResource(resource: string): { kind: ChangeNoteKind; name: string } {
  return resource.startsWith("HWU · ")
    ? { kind: "hwu", name: resource.slice("HWU · ".length) }
    : { kind: "rig", name: resource };
}

function distinctResources(group: DiffGroup): number {
  const set = new Set<string>();
  for (const a of group.activities) set.add(resourceOf(a).label);
  for (const c of group.contracts) set.add(c.resource);
  return set.size;
}

/** The per-resource grouping (the "By rig" tab) — changed activities, then
 *  resources with only a contract change or a (stale) note folded in. */
export function buildResourceGroups(
  activities: ActivityDiff[],
  contracts: ContractDiff[],
  notes: ChangeNote[],
  filterActive: boolean,
): DiffGroup[] {
  const groups = new Map<string, DiffGroup>();
  const ensure = (kind: ChangeNoteKind, name: string | null, label: string) => {
    const k = groupKey(kind, name);
    if (!groups.has(k)) {
      groups.set(k, {
        kind,
        resourceName: name,
        label,
        activities: [],
        contracts: [],
        resourceCount: 0,
      });
    }
    return groups.get(k)!;
  };
  for (const a of activities) {
    const r = resourceOf(a);
    ensure(r.kind, r.name, r.label).activities.push(a);
  }
  for (const c of contracts) {
    const { kind, name } = parseContractResource(c.resource);
    ensure(kind, name, c.resource).contracts.push(c);
  }
  if (!filterActive) {
    // Fold in note-only resources — but not while filtering, where a row-less
    // group would read as a false match. Terrain notes belong to the other tab.
    for (const n of notes) {
      if (n.kind === "terrain") continue;
      ensure(n.kind, n.resource_name, labelFor(n.kind, n.resource_name));
    }
  }
  const ordered = [...groups.values()].sort((a, b) => a.label.localeCompare(b.label));
  for (const g of ordered) g.resourceCount = distinctResources(g);
  return ordered;
}

/** The by-terrain rollup (default tab): the same change entries bucketed by the
 *  activity's location. Contract changes ride the terrain their rig appears in
 *  within this diff; a contract whose rig has no changed activity lands in the
 *  Unassigned bucket rather than vanishing. */
export function buildTerrainGroups(
  activities: ActivityDiff[],
  contracts: ContractDiff[],
  notes: ChangeNote[],
  filterActive: boolean,
): DiffGroup[] {
  const groups = new Map<string, DiffGroup>();
  const ensureTerrain = (terrain: string) => {
    const known = (TERRAINS as readonly string[]).includes(terrain);
    const k = known ? groupKey("terrain", terrain) : groupKey("unassigned", null);
    if (!groups.has(k)) {
      groups.set(k, {
        kind: known ? "terrain" : "unassigned",
        resourceName: known ? terrain : null,
        label: known ? terrain : "Unassigned terrain",
        activities: [],
        contracts: [],
        resourceCount: 0,
      });
    }
    return groups.get(k)!;
  };

  // Where each resource's changes live — routes contract diffs to a terrain.
  const terrainByResource = new Map<string, string>();
  for (const a of activities) {
    const terrain = a.location ?? "";
    ensureTerrain(terrain).activities.push(a);
    const label = resourceOf(a).label;
    if (!terrainByResource.has(label)) terrainByResource.set(label, terrain);
  }
  for (const c of contracts) {
    ensureTerrain(terrainByResource.get(c.resource) ?? "").contracts.push(c);
  }
  if (!filterActive) {
    for (const n of notes) {
      if (n.kind === "terrain" && n.resource_name) ensureTerrain(n.resource_name);
    }
  }

  // Fixed vocabulary order (Land → Swamp → Offshore), Unassigned last.
  const rank = (g: DiffGroup) =>
    g.kind === "unassigned"
      ? TERRAINS.length
      : (TERRAINS as readonly string[]).indexOf(g.resourceName ?? "");
  const ordered = [...groups.values()].sort((a, b) => rank(a) - rank(b));
  for (const g of ordered) g.resourceCount = distinctResources(g);
  return ordered;
}

const GROUPING_KEY = "ds.compare-grouping";

/** The persisted tab choice; TERRAIN is the default view. */
export function loadCompareGrouping(): CompareGrouping {
  try {
    return window.localStorage.getItem(GROUPING_KEY) === "resource" ? "resource" : "terrain";
  } catch {
    return "terrain";
  }
}

export function saveCompareGrouping(value: CompareGrouping): void {
  try {
    window.localStorage.setItem(GROUPING_KEY, value);
  } catch {
    // storage unavailable — the in-session choice still applies
  }
}
