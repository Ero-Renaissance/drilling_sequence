import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  getAccessToken: async () => "test-token",
  msalInstance: { getAllAccounts: () => [], logoutRedirect: vi.fn() },
  loginRequest: {},
}));

import { ChangeNotesEditor } from "@/components/revisions/ChangeNotesEditor";
import type { ActivityDiff } from "@/api/compare";
import type { ChangeNote } from "@/api/change-notes";

function diffActivity(over: Partial<ActivityDiff>): ActivityDiff {
  return {
    change: "modified",
    activity_id: "a1",
    activity_type: "Oil Development",
    well_name: "Well-23",
    well_project: "Bonga Ph3",
    rig_name: "RIG_2",
    hwu_name: null,
    comment: "spud slipped",
    start_date: "2026-07-01",
    end_date: "2026-09-01",
    fields: [],
    removal_reason: null,
    completed: false,
    ...over,
  };
}

describe("ChangeNotesEditor", () => {
  it("renders a per-resource table with project/well/activity and a pre-filled note", () => {
    const notes: ChangeNote[] = [
      { kind: "rig", resource_name: "RIG_2", body: "Spud moved to Jul.", updated_at: "2026-06-27" },
    ];
    render(
      <ChangeNotesEditor
        projectId="p1"
        activities={[diffActivity({})]}
        contracts={[]}
        notes={notes}
        canEdit
        locked={false}
      />,
    );
    expect(screen.getByText("RIG_2")).toBeInTheDocument();
    expect(screen.getByText("Modified")).toBeInTheDocument();
    expect(screen.getByText("Bonga Ph3")).toBeInTheDocument();
    expect(screen.getByText("Well-23")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Spud moved to Jul.")).toBeInTheDocument();
  });

  it("labels HWU activities as a resource group", () => {
    render(
      <ChangeNotesEditor
        projectId="p1"
        activities={[diffActivity({ rig_name: null, hwu_name: "HWU_1", activity_id: "a2" })]}
        contracts={[]}
        notes={[]}
        canEdit
        locked={false}
      />,
    );
    expect(screen.getByText("HWU · HWU_1")).toBeInTheDocument();
  });

  it("shows the finish-date shift in days for a slipped activity", () => {
    const slipped = diffActivity({
      end_date: "2026-10-01",
      fields: [{ field: "End date", old: "2026-09-01", new: "2026-10-01" }],
    });
    render(
      <ChangeNotesEditor
        projectId="p1"
        activities={[slipped]}
        contracts={[]}
        notes={[]}
        canEdit
        locked={false}
      />,
    );
    expect(screen.getByText("+30d")).toBeInTheDocument();
  });

  it("shows a locked hint and read-only notes when locked", () => {
    render(
      <ChangeNotesEditor
        projectId="p1"
        activities={[diffActivity({})]}
        contracts={[]}
        notes={[{ kind: "rig", resource_name: "RIG_2", body: "x", updated_at: "2026-06-27" }]}
        canEdit={false}
        locked
      />,
    );
    expect(screen.getByText(/locked with the plan/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue("x")).toHaveAttribute("readonly");
  });

  it("read-only mode renders notes as plain text, without the editor or header", () => {
    render(
      <ChangeNotesEditor
        projectId="p1"
        activities={[diffActivity({})]}
        contracts={[]}
        // No updated_at — the shape of a note snapshotted into a revision.
        notes={[{ kind: "rig", resource_name: "RIG_2", body: "Spud moved to Jul." }]}
        canEdit={false}
        locked={false}
        readOnly
      />,
    );
    // The per-resource table still renders…
    expect(screen.getByText("RIG_2")).toBeInTheDocument();
    expect(screen.getByText("Modified")).toBeInTheDocument();
    // …but the note is plain text (no editable box), and the authoring header is gone.
    expect(screen.getByText("Spud moved to Jul.")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByText("Change notes")).not.toBeInTheDocument();
  });
});
