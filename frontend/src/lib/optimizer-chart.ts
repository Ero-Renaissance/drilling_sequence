import type { Activity } from "@/api/activities";
import type { TerrainResult, Terrain } from "@/api/optimizer";

/** Chart terrain band per optimizer terrain — SWO (Shallow Offshore) rides the
 *  sequence chart's OFFSHORE band so the row ordering (Land → Swamp → Offshore)
 *  matches every other Gantt in the app. */
const TERRAIN_LOCATION: Record<Terrain, string> = {
  Land: "LAND",
  Swamp: "SWAMP",
  SWO: "OFFSHORE",
};

const GAP_TEXT: Record<string, string> = {
  inter_well: "after a 2-week rig move",
  batch: "after a 4-week batch gap",
  project_move: "after a 45-day project move",
};

/** Dress the optimizer's rig schedules up as synthetic activities so the real
 *  sequence chart (DrillChart) renders them: one Y-row per rig ("LAND – Land
 *  Rig 1"), bars colored like drilling activities, project filter intact.
 *  Display-only objects — they never touch any campaign API. */
export function optimizerResultsToActivities(results: TerrainResult[]): Activity[] {
  const activities: Activity[] = [];
  for (const tr of results) {
    for (const rig of tr.rigs) {
      rig.wells.forEach((w, i) => {
        // Engine labels are "Project · Year · Well N" — reuse the well part.
        const wellPart = w.label.split("·").pop()?.trim() || `Well ${i + 1}`;
        activities.push({
          id: `opt-${tr.terrain}-${rig.name}-${i}`,
          project_id: "optimizer",
          activity_type: "Oil Well Drilling",
          start_date: w.start,
          end_date: w.end,
          well_name: `${wellPart} · ${w.year}`,
          rig_name: rig.name,
          hwu_name: null,
          well_project: w.project,
          project_group: w.project,
          location: TERRAIN_LOCATION[tr.terrain],
          risk: null,
          comment: GAP_TEXT[w.gap_kind] ?? null,
          plan_type: null,
          completed_at: null,
          updated_at: w.start,
          updated_by_name: null,
          locked_by_revision_id: null,
        });
      });
    }
  }
  return activities;
}
