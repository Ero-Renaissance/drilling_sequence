import { describe, it, expect } from "vitest";
import { detectRigConflicts } from "@/lib/conflicts";
import type { Activity } from "@/api/activities";

function act(overrides: Partial<Activity>): Activity {
  return {
    id: "a",
    project_id: "p",
    activity_type: "Oil Development",
    start_date: "2026-01-01",
    end_date: "2026-01-31",
    well_name: null,
    rig_name: "Rig Alpha",
    project_group: null,
    location: null,
    readiness_check: null,
    readiness_check_status: null,
    risk: null,
    comment: null,
    plan_type: null,
    completed_at: null,
    updated_at: "2026-01-01T00:00:00Z",
    updated_by_name: null,
    locked_by_revision_id: null,
    ...overrides,
  };
}

describe("detectRigConflicts", () => {
  it("flags overlapping activities on the same rig", () => {
    const conflicts = detectRigConflicts([
      act({ id: "a", start_date: "2026-01-01", end_date: "2026-02-01" }),
      act({ id: "b", start_date: "2026-01-15", end_date: "2026-03-01" }),
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].rig).toBe("Rig Alpha");
  });

  it("ignores a completed activity — the rig is released", () => {
    const conflicts = detectRigConflicts([
      act({
        id: "a",
        start_date: "2026-01-01",
        end_date: "2026-02-01",
        completed_at: "2026-02-01T00:00:00Z",
      }),
      act({ id: "b", start_date: "2026-01-15", end_date: "2026-03-01" }),
    ]);
    expect(conflicts).toHaveLength(0);
  });

  it("does not flag non-overlapping activities", () => {
    const conflicts = detectRigConflicts([
      act({ id: "a", start_date: "2026-01-01", end_date: "2026-01-31" }),
      act({ id: "b", start_date: "2026-02-01", end_date: "2026-02-28" }),
    ]);
    expect(conflicts).toHaveLength(0);
  });

  it("does not flag activities on different rigs", () => {
    const conflicts = detectRigConflicts([
      act({ id: "a", rig_name: "Rig Alpha", start_date: "2026-01-01", end_date: "2026-02-01" }),
      act({ id: "b", rig_name: "Rig Beta", start_date: "2026-01-15", end_date: "2026-03-01" }),
    ]);
    expect(conflicts).toHaveLength(0);
  });
});
