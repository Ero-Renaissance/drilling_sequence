import { describe, it, expect } from "vitest";
import { activitiesToChartData, type ReadinessMap } from "@/lib/chart-utils";
import type { Activity } from "@/api/activities";
import type { CheckCode, CheckStatus } from "@/api/readiness";

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

describe("readiness anchor-plus-exception roles", () => {
  const GATES = Object.fromEntries(
    ["FDP", "LLI", "LOC", "FE", "FID", "EIA", "BUD"].map((c) => [
      c,
      { status: "On Track" as const },
    ]),
  ) as Record<CheckCode, { status: CheckStatus }>;

  function mapFor(project: string, gates = GATES): ReadinessMap {
    return new Map([[project, gates]]);
  }

  it("anchors the full strip on the project's earliest pending bar; the rest are siblings", () => {
    const { data } = activitiesToChartData(
      [
        act({ id: "late", well_project: "P1", start_date: "2026-06-01", end_date: "2026-07-01" }),
        act({ id: "early", well_project: "P1", start_date: "2026-01-01", end_date: "2026-02-01" }),
        act({ id: "mid", well_project: "P1", start_date: "2026-03-01", end_date: "2026-04-01" }),
      ],
      mapFor("P1"),
    );
    const roles = Object.fromEntries(data.map((d) => [d.activityId, d.readinessRole]));
    expect(roles).toEqual({ early: "anchor", mid: "sibling", late: "sibling" });
    // Detail stays reachable everywhere: every bar's tooltip carries the gates.
    expect(data.every((d) => d.tooltip.checks !== null)).toBe(true);
  });

  it("moves the anchor to the next pending bar when the earliest is completed", () => {
    const { data } = activitiesToChartData(
      [
        act({
          id: "done",
          well_project: "P1",
          start_date: "2026-01-01",
          end_date: "2026-02-01",
          completed_at: "2026-02-02T00:00:00Z",
        }),
        act({ id: "next", well_project: "P1", start_date: "2026-03-01", end_date: "2026-04-01" }),
      ],
      mapFor("P1"),
    );
    const roles = Object.fromEntries(data.map((d) => [d.activityId, d.readinessRole]));
    expect(roles).toEqual({ done: "none", next: "anchor" });
  });

  it("never anchors on an opt-out bar (readiness_required false) and gives it no gates", () => {
    const { data } = activitiesToChartData(
      [
        act({
          id: "optout",
          well_project: "P1",
          start_date: "2026-01-01",
          end_date: "2026-02-01",
          readiness_required: false,
        }),
        act({ id: "real", well_project: "P1", start_date: "2026-03-01", end_date: "2026-04-01" }),
      ],
      mapFor("P1"),
    );
    const roles = Object.fromEntries(data.map((d) => [d.activityId, d.readinessRole]));
    expect(roles).toEqual({ optout: "none", real: "anchor" });
  });

  it("gives activities with no field project role none", () => {
    const { data } = activitiesToChartData(
      [act({ id: "solo", well_project: null })],
      mapFor("P1"),
    );
    expect(data[0].readinessRole).toBe("none");
    expect(data[0].tooltip.checks).toBeNull();
  });

  it("each project gets its own independent anchor", () => {
    const map: ReadinessMap = new Map([
      ["P1", GATES],
      ["P2", GATES],
    ]);
    const { data } = activitiesToChartData(
      [
        act({ id: "p1a", well_project: "P1", start_date: "2026-01-01", end_date: "2026-02-01" }),
        act({ id: "p2a", well_project: "P2", start_date: "2026-01-15", end_date: "2026-02-15" }),
        act({ id: "p1b", well_project: "P1", start_date: "2026-05-01", end_date: "2026-06-01" }),
      ],
      map,
    );
    const roles = Object.fromEntries(data.map((d) => [d.activityId, d.readinessRole]));
    expect(roles).toEqual({ p1a: "anchor", p2a: "anchor", p1b: "sibling" });
  });
});
