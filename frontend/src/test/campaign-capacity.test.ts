import { describe, it, expect } from "vitest";

import { aggregateCapacity, windowCapacity } from "@/lib/campaign-capacity";
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
    // W2 has no Market assigned → its gas spud is honest about that.
    expect(d.unassignedGasSpuds).toEqual([0, 1]);
    expect(d.domesticGasSpuds).toEqual([0, 0]);
    expect(d.exportGasSpuds).toEqual([0, 0]);
  });

  it("respects an override that reclassifies a type", () => {
    const acts = [
      act({ well_name: "W1", activity_type: "Oil Development", start_date: "2026-02-01", end_date: "2026-08-01" }),
    ];
    expect(aggregateCapacity(acts, {}).oilSpuds).toEqual([1]);
    expect(
      aggregateCapacity(acts, { "Oil Development": "gas" }).unassignedGasSpuds,
    ).toEqual([1]);
    expect(aggregateCapacity(acts, { "Oil Development": "exclude" }).oilSpuds).toEqual([0]);
  });

  it("returns empty data when there are no dated activities", () => {
    expect(aggregateCapacity([], {}).years).toEqual([]);
  });
});


describe("gas spuds split by project Market", () => {
  it("buckets gas spuds by the activity's market, inheriting the project's", () => {
    const d = aggregateCapacity(
      [
        act({ well_name: "W1", activity_type: "Gas Development", well_project: "Dom",
              market: "Domestic Gas", start_date: "2026-02-01", end_date: "2026-08-01" }),
        // Same project, market cell empty on this row → inherits Domestic Gas.
        act({ well_name: "W2", activity_type: "Gas Development", well_project: "Dom",
              market: null, start_date: "2026-03-01", end_date: "2026-09-01" }),
        act({ well_name: "W3", activity_type: "Gas Development", well_project: "Exp",
              market: "Export Gas", start_date: "2027-01-01", end_date: "2027-06-01" }),
        // No project, no market → honest "no market" bucket.
        act({ well_name: "W4", activity_type: "Gas Development",
              start_date: "2027-02-01", end_date: "2027-07-01" }),
      ],
      {},
    );
    expect(d.years).toEqual([2026, 2027]);
    expect(d.domesticGasSpuds).toEqual([2, 0]);
    expect(d.exportGasSpuds).toEqual([0, 1]);
    expect(d.unassignedGasSpuds).toEqual([0, 1]);
    expect(d.oilSpuds).toEqual([0, 0]);
  });

  it("a non-gas market (Oil / Not Applicable) on a gas spud is not guessed into a bucket", () => {
    const d = aggregateCapacity(
      [
        act({ well_name: "W1", activity_type: "Gas Development", well_project: "P",
              market: "Not Applicable", start_date: "2026-02-01", end_date: "2026-08-01" }),
      ],
      {},
    );
    expect(d.unassignedGasSpuds).toEqual([1]);
  });
});

describe("windowCapacity (horizon filter)", () => {
  const data = aggregateCapacity(
    [
      act({ well_name: "W1", activity_type: "Oil Development", rig_name: "R1", location: "LAND",
            start_date: "2026-02-01", end_date: "2026-08-01" }),
      act({ well_name: "W2", activity_type: "Oil Development", rig_name: "R1", location: "LAND",
            start_date: "2029-02-01", end_date: "2030-08-01" }),
    ],
    {},
  );

  it("clips every parallel series to the first N years", () => {
    const w = windowCapacity(data, 3);
    expect(w.years).toEqual([2026, 2027, 2028]);
    expect(w.rigsByLocation.LAND).toEqual([1, 0, 0]);
    expect(w.oilSpuds).toEqual([1, 0, 0]); // the 2029 spud falls outside the window
  });

  it("null or an over-long horizon returns the data unchanged", () => {
    expect(windowCapacity(data, null)).toBe(data);
    expect(windowCapacity(data, 99)).toBe(data);
    expect(data.years).toEqual([2026, 2027, 2028, 2029, 2030]);
  });
});

describe("exploration spuds", () => {
  it("moves exploration wells out of the oil/gas market lines — no double count", async () => {
    const { aggregateCapacity } = await import("@/lib/campaign-capacity");
    const acts = [
      { well_name: "X-1", activity_type: "Oil Exploration", start_date: "2026-02-01", end_date: "2026-04-01", location: "LAND", rig_name: "R1", well_project: "P1", market: "Oil" },
      { well_name: "X-2", activity_type: "Gas Exploration (Including HPHT)", start_date: "2026-03-01", end_date: "2026-05-01", location: "LAND", rig_name: "R1", well_project: "P2", market: "Export Gas" },
      { well_name: "D-1", activity_type: "Oil Development", start_date: "2026-06-01", end_date: "2026-08-01", location: "LAND", rig_name: "R1", well_project: "P1", market: "Oil" },
    ] as never[];
    const d = aggregateCapacity(acts, {});
    expect(d.explorationSpuds).toEqual([2]);
    expect(d.oilSpuds).toEqual([1]);
    // The gas-exploration well is NOT in any gas/market line despite its
    // project's Export Gas market.
    expect(d.exportGasSpuds).toEqual([0]);
    expect(d.domesticGasSpuds).toEqual([0]);
    expect(d.unassignedGasSpuds).toEqual([0]);
  });
});
