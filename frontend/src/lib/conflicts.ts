import type { Activity } from "@/api/activities";

export interface RigConflict {
  rig: string;
  a: Activity;
  b: Activity;
  overlapDays: number;
}

function toDay(dateStr: string): number {
  return Math.floor(new Date(dateStr + "T00:00:00").getTime() / 86_400_000);
}

export function detectRigConflicts(activities: Activity[]): RigConflict[] {
  const byRig = new Map<string, Activity[]>();
  for (const act of activities) {
    if (!act.rig_name) continue;
    // A completed activity is finished work — the rig is released, so it can't
    // double-book a later/overlapping activity. Excluding it avoids false conflicts.
    if (act.completed_at) continue;
    const bucket = byRig.get(act.rig_name) ?? [];
    bucket.push(act);
    byRig.set(act.rig_name, bucket);
  }

  const conflicts: RigConflict[] = [];
  for (const [rig, acts] of byRig) {
    for (let i = 0; i < acts.length; i++) {
      for (let j = i + 1; j < acts.length; j++) {
        const a = acts[i];
        const b = acts[j];
        const overlapStart = Math.max(toDay(a.start_date), toDay(b.start_date));
        const overlapEnd = Math.min(toDay(a.end_date), toDay(b.end_date));
        if (overlapEnd > overlapStart) {
          conflicts.push({ rig, a, b, overlapDays: overlapEnd - overlapStart });
        }
      }
    }
  }

  return conflicts.sort((x, y) => y.overlapDays - x.overlapDays);
}
