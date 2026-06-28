import { describe, it, expect } from "vitest";

import { aggregateCapacity } from "@/lib/campaign-capacity";
import type { Activity } from "@/api/activities";

let seq = 0;
function act(over: Partial<Activity>): Activity {
  return {
    id: `a${seq++}`,
    project_id: "p",
    activity_type: "Oil Development",
    start_date: "2026-01-01",
    end_date: "2026-06-01",
    well_name: null,
    rig_name: null,
    hwu_name: null,
    well_project: null,
    project_group: null,
    location: null,
    risk: null,
    comment: null,
    plan_type: null,
    completed_at: null,
    updated_at: "",
    updated_by_name: null,
    locked_by_revision_id: null,
    ...over,
  };
}

describe("aggregateCapacity", () => {
  it("counts distinct rigs active each year, by location (overlap-based)", () => {
    const d = aggregateCapacity(
      [
        act({ rig_name: "R1", location: "LAND", start_date: "2026-01-01", end_date: "2027-06-01" }),
        act({ rig_name: "R2", location: "LAND", start_date: "2026-03-01", end_date: "2026-09-01" }),
        act({ rig_name: "R3", location: "SWAMP", start_date: "2027-01-01", end_date: "2027-12-01" }),
      ],
      {},
    );
    expect(d.years).toEqual([2026, 2027]);
    expect(d.rigsByLocation.LAND).toEqual([2, 1]); // R1+R2 active in 2026; only R1 in 2027
    expect(d.rigsByLocation.SWAMP).toEqual([0, 1]);
    expect(d.rigsByLocation.OFFSHORE).toEqual([0, 0]);
  });

  it("does not double-count a rig with two activities in the same year/location", () => {
    const d = aggregateCapacity(
      [
        act({ rig_name: "R1", location: "OFFSHORE", start_date: "2026-01-01", end_date: "2026-03-01" }),
        act({ rig_name: "R1", location: "OFFSHORE", start_date: "2026-06-01", end_date: "2026-09-01" }),
      ],
      {},
    );
    expect(d.rigsByLocation.OFFSHORE).toEqual([1]);
  });

  it("ignores rigs with no location and HWU/no-resource activities", () => {
    const d = aggregateCapacity(
      [
        act({ rig_name: "R1", location: null, start_date: "2026-01-01", end_date: "2026-03-01" }),
        act({ hwu_name: "HWU1", location: "LAND", start_date: "2026-01-01", end_date: "2026-03-01" }),
      ],
      {},
    );
    expect(d.rigsByLocation.LAND).toEqual([0]);
  });

  it("counts each well once, in the year of its earliest oil/gas spud", () => {
    const d = aggregateCapacity(
      [
        act({ well_name: "W1", activity_type: "Oil Development", start_date: "2026-02-01", end_date: "2026-08-01" }),
        // A later workover on the same well is not a spud and must not recount it.
        act({ well_name: "W1", activity_type: "Oil Workover", start_date: "2027-01-01", end_date: "2027-03-01" }),
        act({ well_name: "W2", activity_type: "Gas Development", start_date: "2027-05-01", end_date: "2027-09-01" }),
      ],
      {},
    );
    expect(d.years).toEqual([2026, 2027]);
    expect(d.oilSpuds).toEqual([1, 0]); // W1 oil-spud in 2026 only
    expect(d.gasSpuds).toEqual([0, 1]); // W2 gas-spud in 2027
  });

  it("respects an override that reclassifies a type", () => {
    const acts = [
      act({ well_name: "W1", activity_type: "Oil Development", start_date: "2026-02-01", end_date: "2026-08-01" }),
    ];
    expect(aggregateCapacity(acts, {}).oilSpuds).toEqual([1]);
    expect(aggregateCapacity(acts, { "Oil Development": "gas" }).gasSpuds).toEqual([1]);
    expect(aggregateCapacity(acts, { "Oil Development": "exclude" }).oilSpuds).toEqual([0]);
  });

  it("returns empty data when there are no dated activities", () => {
    expect(aggregateCapacity([], {}).years).toEqual([]);
  });
});
