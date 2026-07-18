import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChangeNotesEditor } from "@/components/revisions/ChangeNotesEditor";
import type { ActivityDiff } from "@/api/compare";

vi.mock("@/api/change-notes", () => ({
  upsertChangeNote: vi.fn(),
}));

function act(i: number, rig: string): ActivityDiff {
  return {
    change: "added",
    activity_id: `a${i}`,
    activity_type: "Oil Development",
    well_name: `W-${i}`,
    well_project: "PX",
    rig_name: rig,
    hwu_name: null,
    comment: null,
    start_date: "2026-01-01",
    end_date: "2026-02-01",
    fields: [],
    removal_reason: null,
    completed: false,
  };
}

const props = {
  projectId: "p1",
  contracts: [],
  notes: [],
  canEdit: false,
  locked: false,
  readOnly: true,
};

describe("ChangeNotesEditor progressive disclosure", () => {
  it("collapses per-rig groups to headers with counts on a large diff", async () => {
    const activities = Array.from({ length: 10 }, (_, i) => act(i, `Rig ${i}`));
    render(<ChangeNotesEditor {...props} activities={activities} />);
    // The forensic per-rig view lives behind the "By rig" tab (terrain is the
    // default rollup).
    await userEvent.click(screen.getByTestId("grouping-resource"));
    // 10 groups > threshold → headers with counts, tables closed.
    expect(screen.getAllByTestId("diff-group-toggle")).toHaveLength(10);
    expect(screen.getAllByText("1 change")).toHaveLength(10);
    expect(screen.queryByText("W-0")).not.toBeInTheDocument();
  });

  it("expands a collapsed group on click — nothing is more than a click away", async () => {
    const activities = Array.from({ length: 10 }, (_, i) => act(i, `Rig ${i}`));
    render(<ChangeNotesEditor {...props} activities={activities} />);
    await userEvent.click(screen.getByTestId("grouping-resource"));
    await userEvent.click(screen.getAllByTestId("diff-group-toggle")[0]);
    expect(screen.getByText("W-0")).toBeInTheDocument();
  });

  it("stays fully expanded on a small diff (the common case is unchanged)", () => {
    const activities = [act(1, "Rig A"), act(2, "Rig B")];
    render(<ChangeNotesEditor {...props} activities={activities} />);
    expect(screen.getByText("W-1")).toBeInTheDocument();
    expect(screen.getByText("W-2")).toBeInTheDocument();
  });

  it("auto-expands matches while a filter is active", () => {
    const activities = Array.from({ length: 10 }, (_, i) => act(i, `Rig ${i}`));
    render(<ChangeNotesEditor {...props} activities={activities} filterActive />);
    expect(screen.getByText("W-0")).toBeInTheDocument();
  });
});


describe("ChangeNotesEditor terrain grouping", () => {
  const withLoc = (i: number, rig: string, location: string | null): ActivityDiff => ({
    ...act(i, rig),
    location,
  });

  it("defaults to the terrain rollup: three buckets however many rigs", () => {
    window.localStorage.removeItem("ds.compare-grouping");
    const activities = [
      withLoc(0, "Rig A", "LAND"),
      withLoc(1, "Rig B", "LAND"),
      withLoc(2, "Barge 1", "SWAMP"),
      withLoc(3, "DS Rig", "OFFSHORE"),
      withLoc(4, "Rig X", null),
    ];
    render(<ChangeNotesEditor {...props} activities={activities} />);
    const headers = screen.getAllByTestId("diff-group-toggle").map((el) => el.textContent ?? "");
    expect(headers[0]).toContain("LAND");
    expect(headers[1]).toContain("SWAMP");
    expect(headers[2]).toContain("OFFSHORE");
    expect(headers[3]).toContain("Unassigned terrain");
    // Terrain headers carry the rig context the rollup would otherwise hide.
    expect(headers[0]).toContain("across 2 resources");
  });
});
