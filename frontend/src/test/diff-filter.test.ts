import { describe, it, expect } from "vitest";
import { matchesDiffFilter, matchesContractFilter } from "@/components/revisions/diff-shared";
import type { ActivityDiff, ContractDiff } from "@/api/compare";

function act(overrides: Partial<ActivityDiff>): ActivityDiff {
  return {
    change: "modified",
    activity_id: "a1",
    activity_type: "Oil Development",
    well_name: "ESCB006",
    well_project: "Gbaran Phase II",
    rig_name: "Deepsea Aberdeen",
    hwu_name: null,
    comment: null,
    start_date: "2026-01-01",
    end_date: "2026-02-01",
    fields: [],
    removal_reason: null,
    completed: false,
    ...overrides,
  };
}

describe("matchesDiffFilter", () => {
  it("filters by change type", () => {
    expect(matchesDiffFilter(act({ change: "added" }), "added", "")).toBe(true);
    expect(matchesDiffFilter(act({ change: "modified" }), "added", "")).toBe(false);
    expect(matchesDiffFilter(act({}), null, "")).toBe(true);
  });

  it("searches rig, HWU, well, project and activity type (case-insensitive)", () => {
    expect(matchesDiffFilter(act({}), null, "aberdeen")).toBe(true);
    expect(matchesDiffFilter(act({}), null, "escb")).toBe(true);
    expect(matchesDiffFilter(act({}), null, "gbaran")).toBe(true);
    expect(matchesDiffFilter(act({}), null, "oil dev")).toBe(true);
    expect(matchesDiffFilter(act({ rig_name: null, hwu_name: "HWU-1" }), null, "hwu-1")).toBe(true);
    expect(matchesDiffFilter(act({}), null, "nonexistent")).toBe(false);
  });

  it("combines type filter and search (both must match)", () => {
    expect(matchesDiffFilter(act({ change: "added" }), "added", "aberdeen")).toBe(true);
    expect(matchesDiffFilter(act({ change: "added" }), "modified", "aberdeen")).toBe(false);
    expect(matchesDiffFilter(act({ change: "added" }), "added", "elsewhere")).toBe(false);
  });
});

describe("matchesContractFilter", () => {
  const contract: ContractDiff = { resource: "Deepsea Aberdeen", fields: [] };

  it("hides contract rows under a change-type filter (they are not activity rows)", () => {
    expect(matchesContractFilter(contract, "added", "")).toBe(false);
    expect(matchesContractFilter(contract, null, "")).toBe(true);
  });

  it("matches search against the resource label", () => {
    expect(matchesContractFilter(contract, null, "aberdeen")).toBe(true);
    expect(matchesContractFilter(contract, null, "hl19")).toBe(false);
  });
});
