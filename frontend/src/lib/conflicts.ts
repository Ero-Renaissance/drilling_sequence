import type { Activity } from "@/api/activities";

export interface ResourceConflict {
  /** Terrain-qualified lane label (e.g. "SWAMP – 10K Rig 1") — names the
   *  physical unit unambiguously in banners and dialogs. */
  resource: string;
  kind: "rig" | "hwu";
  /** The lane's terrain (activity location), or null when unset. */
  terrain: string | null;
  a: Activity;
  b: Activity;
  overlapDays: number;
}

function toDay(dateStr: string): number {
  return Math.floor(new Date(dateStr + "T00:00:00").getTime() / 86_400_000);
}

function resourceOf(
  a: Activity,
): { kind: "rig" | "hwu"; name: string; terrain: string | null } | null {
  if (a.rig_name) return { kind: "rig", name: a.rig_name, terrain: a.location ?? null };
  if (a.hwu_name) return { kind: "hwu", name: a.hwu_name, terrain: a.location ?? null };
  return null;
}

export function detectResourceConflicts(activities: Activity[]): ResourceConflict[] {
  // Resource identity is (kind, TERRAIN, name) — mirrors the backend
  // (app/services/conflicts.py): rig classes are terrain-locked and the fleet
  // reuses class-style names per terrain, so a LAND "10K Rig 1" and a SWAMP
  // "10K Rig 1" are two different physical rigs, never a conflict pair.
  const byResource = new Map<
    string,
    { kind: "rig" | "hwu"; name: string; terrain: string | null; acts: Activity[] }
  >();
  for (const act of activities) {
    // A completed activity is finished work — the resource is released, so it
    // can't double-book a later/overlapping activity. Excluding it avoids false
    // conflicts.
    if (act.completed_at) continue;
    const r = resourceOf(act);
    if (!r) continue;
    const key = `${r.kind}:${r.terrain ?? ""}:${r.name}`;
    const bucket = byResource.get(key) ?? { ...r, acts: [] };
    bucket.acts.push(act);
    byResource.set(key, bucket);
  }

  const conflicts: ResourceConflict[] = [];
  for (const { kind, name, terrain, acts } of byResource.values()) {
    for (let i = 0; i < acts.length; i++) {
      for (let j = i + 1; j < acts.length; j++) {
        const a = acts[i];
        const b = acts[j];
        const overlapStart = Math.max(toDay(a.start_date), toDay(b.start_date));
        const overlapEnd = Math.min(toDay(a.end_date), toDay(b.end_date));
        if (overlapEnd > overlapStart) {
          conflicts.push({
            resource: terrain ? `${terrain} – ${name}` : name,
            kind,
            terrain,
            a,
            b,
            overlapDays: overlapEnd - overlapStart,
          });
        }
      }
    }
  }

  return conflicts.sort((x, y) => y.overlapDays - x.overlapDays);
}
