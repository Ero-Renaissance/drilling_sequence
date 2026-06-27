import type { Activity } from "@/api/activities";

export interface ResourceConflict {
  /** The double-booked resource's name (rig or HWU). */
  resource: string;
  kind: "rig" | "hwu";
  a: Activity;
  b: Activity;
  overlapDays: number;
}

function toDay(dateStr: string): number {
  return Math.floor(new Date(dateStr + "T00:00:00").getTime() / 86_400_000);
}

function resourceOf(a: Activity): { kind: "rig" | "hwu"; name: string } | null {
  if (a.rig_name) return { kind: "rig", name: a.rig_name };
  if (a.hwu_name) return { kind: "hwu", name: a.hwu_name };
  return null;
}

export function detectResourceConflicts(activities: Activity[]): ResourceConflict[] {
  // Group by (kind, name) so a rig and an HWU that share a name are never conflated.
  const byResource = new Map<
    string,
    { kind: "rig" | "hwu"; name: string; acts: Activity[] }
  >();
  for (const act of activities) {
    // A completed activity is finished work — the resource is released, so it
    // can't double-book a later/overlapping activity. Excluding it avoids false
    // conflicts.
    if (act.completed_at) continue;
    const r = resourceOf(act);
    if (!r) continue;
    const key = `${r.kind}:${r.name}`;
    const bucket = byResource.get(key) ?? { ...r, acts: [] };
    bucket.acts.push(act);
    byResource.set(key, bucket);
  }

  const conflicts: ResourceConflict[] = [];
  for (const { kind, name, acts } of byResource.values()) {
    for (let i = 0; i < acts.length; i++) {
      for (let j = i + 1; j < acts.length; j++) {
        const a = acts[i];
        const b = acts[j];
        const overlapStart = Math.max(toDay(a.start_date), toDay(b.start_date));
        const overlapEnd = Math.min(toDay(a.end_date), toDay(b.end_date));
        if (overlapEnd > overlapStart) {
          conflicts.push({ resource: name, kind, a, b, overlapDays: overlapEnd - overlapStart });
        }
      }
    }
  }

  return conflicts.sort((x, y) => y.overlapDays - x.overlapDays);
}
