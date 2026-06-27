import { describe, it, expect } from "vitest";
import { activitiesToChartData } from "@/lib/chart-utils";
import type { Activity } from "@/api/activities";

function act(partial: Partial<Activity>): Activity {
  return {
    id: "x",
    project_id: "p",
    activity_type: "Drilling",
    start_date: "2026-01-01",
    end_date: "2026-02-01",
    well_name: null,
    rig_name: null,
    hwu_name: null,
    well_project: null,
    project_group: null,
    location: null,
    risk: null,
    comment: null,
    plan_type: null,
    readiness_required: true,
    completed_at: null,
    updated_at: "2026-01-01T00:00:00Z",
    updated_by_name: null,
    locked_by_revision_id: null,
    ...partial,
  } as Activity;
}

describe("chart Y-axis row labels", () => {
  it("labels a rig activity 'LOCATION – Rig'", () => {
    const { categories } = activitiesToChartData([
      act({ id: "a", location: "LAND", rig_name: "Rig-1" }),
    ]);
    expect(categories).toContain("LAND – Rig-1");
  });

  it("tags an HWU activity row distinctly from a rig", () => {
    const { categories } = activitiesToChartData([
      act({ id: "b", location: "SWAMP", hwu_name: "Unit-9" }),
    ]);
    expect(categories).toContain("SWAMP – HWU · Unit-9");
  });

  it("labels a resource-less activity 'LOCATION – activity type' (not the well name)", () => {
    const { categories } = activitiesToChartData([
      act({
        id: "c",
        location: "LAND",
        activity_type: "Site Survey",
        well_name: "SURV-1",
        rig_name: null,
        hwu_name: null,
      }),
    ]);
    expect(categories).toContain("LAND – Site Survey");
    expect(categories).not.toContain("LAND – SURV-1");
  });

  it("falls back to the activity type when a resource-less activity has no location", () => {
    const { categories } = activitiesToChartData([
      act({ id: "d", location: null, activity_type: "Mobilization" }),
    ]);
    expect(categories).toContain("Mobilization");
  });
});
