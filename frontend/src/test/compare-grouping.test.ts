import { describe, expect, it } from "vitest";

import type { ChangeNote } from "@/api/change-notes";
import type { ActivityDiff, ContractDiff } from "@/api/compare";
import { buildResourceGroups, buildTerrainGroups } from "@/lib/compare-grouping";

const act = (over: Partial<ActivityDiff>): ActivityDiff => ({
  change: "added",
  activity_id: Math.random().toString(36).slice(2),
  activity_type: "Oil Development",
  well_name: "W",
  well_project: "P",
  location: "LAND",
  rig_name: "RIG_1",
  hwu_name: null,
  comment: null,
  start_date: "2026-01-01",
  end_date: "2026-02-01",
  fields: [],
  removal_reason: null,
  completed: false,
  ...over,
});

const note = (over: Partial<ChangeNote>): ChangeNote => ({
  kind: "rig",
  resource_name: "RIG_1",
  body: "x",
  updated_at: "2026-01-01T00:00:00Z",
  ...over,
});

const contract = (resource: string): ContractDiff => ({
  resource,
  fields: [{ field: "Contract end", old: "2030-01-01", new: "2031-01-01" }],
});

describe("buildTerrainGroups", () => {
  it("buckets by location in vocabulary order, Unassigned last, with resource counts", () => {
    const groups = buildTerrainGroups(
      [
        act({ location: "OFFSHORE", rig_name: "DS-1" }),
        act({ location: "LAND", rig_name: "R1" }),
        act({ location: "LAND", rig_name: "R2" }),
        act({ location: null, rig_name: "R9" }),
      ],
      [],
      [],
      false,
    );
    expect(groups.map((g) => g.label)).toEqual(["LAND", "OFFSHORE", "Unassigned terrain"]);
    expect(groups[0].resourceCount).toBe(2);
    expect(groups[0].kind).toBe("terrain");
    expect(groups[2].kind).toBe("unassigned");
  });

  it("routes a contract change to the terrain its rig's changes live in", () => {
    const groups = buildTerrainGroups(
      [act({ location: "SWAMP", rig_name: "Barge 1" })],
      [contract("Barge 1"), contract("Mystery Rig")],
      [],
      false,
    );
    const swamp = groups.find((g) => g.label === "SWAMP")!;
    expect(swamp.contracts.map((c) => c.resource)).toEqual(["Barge 1"]);
    // A contract whose rig has no changed activity lands in Unassigned, not lost.
    const unassigned = groups.find((g) => g.kind === "unassigned")!;
    expect(unassigned.contracts.map((c) => c.resource)).toEqual(["Mystery Rig"]);
  });

  it("folds note-only terrains in (except while filtering)", () => {
    const notes = [note({ kind: "terrain", resource_name: "OFFSHORE" })];
    expect(
      buildTerrainGroups([], [], notes, false).map((g) => g.label),
    ).toEqual(["OFFSHORE"]);
    expect(buildTerrainGroups([], [], notes, true)).toEqual([]);
  });
});

describe("buildResourceGroups", () => {
  it("keeps terrain notes out of the per-resource tab", () => {
    const notes = [
      note({ kind: "terrain", resource_name: "LAND" }),
      note({ kind: "rig", resource_name: "RIG_9" }),
    ];
    const groups = buildResourceGroups([], [], notes, false);
    expect(groups.map((g) => g.label)).toEqual(["RIG_9"]);
  });

  it("attaches contract changes to their resource group", () => {
    const groups = buildResourceGroups(
      [act({ rig_name: "RIG_1" })],
      [contract("RIG_1"), contract("HWU · Unit 5")],
      [],
      false,
    );
    expect(groups.find((g) => g.label === "RIG_1")!.contracts).toHaveLength(1);
    expect(groups.find((g) => g.label === "HWU · Unit 5")!.kind).toBe("hwu");
  });
});

