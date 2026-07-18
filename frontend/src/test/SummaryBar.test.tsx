import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { RevisionDiff } from "@/api/compare";
import { SummaryBar } from "@/components/revisions/diff-shared";

const removedRow = (i: number, completed: boolean) => ({
  change: "removed" as const,
  activity_id: `r${i}-${completed}`,
  activity_type: "Oil Development",
  well_name: `W${i}`,
  well_project: completed ? "P1" : "P2",
  location: "LAND",
  rig_name: completed ? "RIG_1" : "RIG_2",
  hwu_name: null,
  comment: null,
  start_date: null,
  end_date: null,
  fields: [],
  removal_reason: (completed ? "completed" : null) as "completed" | null,
  completed,
});

const diff = {
  base: { kind: "revision", label: "Rev 1" },
  summary: {
    added: 1, modified: 0, removed: 8, unchanged: 40,
    base_count: 47, target_count: 40,
    base_readiness_pct: 10, target_readiness_pct: 12,
  },
  activities: [
    ...Array.from({ length: 6 }, (_, i) => removedRow(i, true)),
    ...Array.from({ length: 2 }, (_, i) => removedRow(10 + i, false)),
    {
      change: "added" as const, activity_id: "a1", activity_type: "Gas Development",
      well_name: "Y1", well_project: "P3", location: "SWAMP", rig_name: "RIG_3",
      hwu_name: null, comment: null, start_date: "2026-01-01", end_date: "2026-02-01",
      fields: [], removal_reason: null, completed: false,
    },
  ],
  contracts: [],
} as unknown as RevisionDiff;

describe("SummaryBar", () => {
  it("names the unit, shows scale, and splits completed removals", () => {
    render(<SummaryBar diff={diff} />);
    // The tiles count ACTIVITIES — said once for all four.
    expect(screen.getByText("Activity changes")).toBeInTheDocument();
    // Scale context across the changed set.
    expect(screen.getByText(/across 3 rigs · 3 projects/)).toBeInTheDocument();
    // Removed splits out routine completed-and-dropped work.
    expect(screen.getByText("6 completed")).toBeInTheDocument();
    // Tooltips carry the matched-by-lineage semantics.
    expect(screen.getByText("Added").parentElement).toHaveAttribute(
      "title",
      expect.stringContaining("lineage"),
    );
  });
});
