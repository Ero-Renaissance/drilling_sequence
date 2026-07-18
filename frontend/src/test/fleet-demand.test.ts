import { describe, expect, it } from "vitest";

import type { Activity } from "@/api/activities";
import type { ResourceRecord } from "@/api/resources";
import { computeFleetDemand } from "@/lib/fleet-demand";

function act(over: Partial<Activity>): Activity {
  return {
    id: "a?",
    project_id: "p",
    activity_type: "Drilling",
    start_date: "2026-01-10",
    end_date: "2026-03-01",
    well_name: "W",
    rig_name: null,
    hwu_name: null,
    well_project: null,
    project_group: null,
    location: null,
    risk: null,
    comment: null,
    plan_type: null,
    market: null,
    readiness_required: true,
    completed_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    updated_by_name: null,
    locked_by_revision_id: null,
    ...over,
  } as Activity;
}

function unit(over: Partial<ResourceRecord>): ResourceRecord {
  return {
    id: "r?",
    project_id: "p",
    kind: "rig",
    terrain: "LAND",
    name: "Rig A",
    capability_class: null,
    is_placeholder: false,
    updated_at: "2026-07-01T00:00:00Z",
    ...over,
  } as ResourceRecord;
}

describe("computeFleetDemand", () => {
  it("counts distinct units per year, split awarded vs planned", () => {
    const activities = [
      // Awarded rig busy 2026 → 2027 (spans the year boundary).
      act({ rig_name: "Rig A", location: "LAND", start_date: "2026-06-01", end_date: "2027-02-01" }),
      // Same rig again in 2026 — still ONE distinct unit that year.
      act({ rig_name: "Rig A", location: "LAND", start_date: "2026-01-05", end_date: "2026-02-05" }),
      // Placeholder rig in 2027 only.
      act({ rig_name: "TBD Rig 1", location: "SWAMP", start_date: "2027-03-01", end_date: "2027-09-01" }),
    ];
    const registry = [
      unit({ name: "Rig A", terrain: "LAND" }),
      unit({ name: "TBD Rig 1", terrain: "SWAMP", is_placeholder: true }),
    ];

    const d = computeFleetDemand("rig", activities, registry);
    expect(d.years).toEqual([2026, 2027]);
    expect(d.awarded).toEqual([1, 1]);
    expect(d.planned).toEqual([0, 1]);
    expect(d.unscheduled).toEqual([]);
  });

  it("keeps rigs and HWUs apart and lists registered-but-unscheduled units", () => {
    const activities = [
      act({ rig_name: "Rig A", location: "LAND", start_date: "2026-01-01", end_date: "2026-04-01" }),
      act({ hwu_name: "HWU-1", start_date: "2026-02-01", end_date: "2026-05-01" }),
    ];
    const registry = [
      unit({ name: "Rig A", terrain: "LAND" }),
      unit({ name: "Spare Rig", terrain: "OFFSHORE" }),
      unit({ kind: "hwu", terrain: "", name: "HWU-1" }),
      unit({ kind: "hwu", terrain: "", name: "HWU-Future", is_placeholder: true }),
    ];

    const rigs = computeFleetDemand("rig", activities, registry);
    expect(rigs.awarded).toEqual([1]);
    expect(rigs.unscheduled).toEqual(["Spare Rig"]);

    const hwus = computeFleetDemand("hwu", activities, registry);
    expect(hwus.years).toEqual([2026]);
    expect(hwus.awarded).toEqual([1]);
    expect(hwus.planned).toEqual([0]);
    expect(hwus.unscheduled).toEqual(["HWU-Future (planned)"]);
  });

  it("treats a scheduled unit missing from the registry as awarded (auto-registration catches up)", () => {
    const activities = [
      act({ rig_name: "Ghost Rig", location: "LAND", start_date: "2026-01-01", end_date: "2026-02-01" }),
    ];
    const d = computeFleetDemand("rig", activities, []);
    expect(d.awarded).toEqual([1]);
    expect(d.planned).toEqual([0]);
  });

  it("matches lanes case-insensitively (registry vs schedule spelling)", () => {
    const activities = [
      act({ rig_name: "tbd rig 1", location: "SWAMP", start_date: "2026-01-01", end_date: "2026-02-01" }),
    ];
    const registry = [unit({ name: "TBD Rig 1", terrain: "SWAMP", is_placeholder: true })];
    const d = computeFleetDemand("rig", activities, registry);
    expect(d.planned).toEqual([1]);
    expect(d.unscheduled).toEqual([]);
  });

  it("returns empty years when nothing is dated", () => {
    const d = computeFleetDemand("rig", [], [unit({})]);
    expect(d.years).toEqual([]);
    expect(d.unscheduled).toEqual(["Rig A"]);
  });
});
