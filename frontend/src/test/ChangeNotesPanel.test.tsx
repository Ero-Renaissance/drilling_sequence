import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";

import { ChangeNotesPanel } from "@/components/revisions/ChangeNotesPanel";
import type { ChangeNote } from "@/api/change-notes";

const note = (over: Partial<ChangeNote>): ChangeNote => ({
  kind: "rig",
  resource_name: "RIG_2",
  body: "Spud moved to Jul.",
  updated_at: "2026-06-27",
  ...over,
});

describe("ChangeNotesPanel", () => {
  it("renders resource + note for each non-empty note", () => {
    render(
      <ChangeNotesPanel
        notes={[note({}), note({ kind: "hwu", resource_name: "HWU_1", body: "Workover added." })]}
      />,
    );
    expect(screen.getByText("RIG_2")).toBeInTheDocument();
    expect(screen.getByText("Spud moved to Jul.")).toBeInTheDocument();
    expect(screen.getByText("HWU · HWU_1")).toBeInTheDocument();
    expect(screen.getByText("Workover added.")).toBeInTheDocument();
  });

  it("skips empty notes and shows emptyText when there are none", () => {
    render(<ChangeNotesPanel notes={[note({ body: "   " })]} emptyText="No change notes." />);
    expect(screen.getByText("No change notes.")).toBeInTheDocument();
    expect(screen.queryByText("RIG_2")).not.toBeInTheDocument();
  });

  it("renders nothing when empty and no emptyText", () => {
    const { container } = render(<ChangeNotesPanel notes={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
