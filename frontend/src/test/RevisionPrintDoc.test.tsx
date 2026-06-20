import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";

import { RevisionPrintDoc, type PrintRow } from "@/components/revisions/RevisionPrintDoc";
import type { RevisionDetail } from "@/api/revisions";

// A revision shell — only the handful of fields the print doc reads on the
// readiness path need to be present; the rest is cast away for the test.
const revision = {
  id: "rev-1",
  rev_number: 1,
  status: "draft",
  integrity_digest: null,
  reviewer_status: [],
  approver_status: [],
  signatures: [],
} as unknown as RevisionDetail;

// Two activities on the SAME rig row in a sparse 2033 year. Once the readiness
// window fits to ~Jan–Oct, "Alpha Well" is a ~2-week sliver (too narrow to label
// inside → spills beside) while "Bravo Well" runs ~4 months (wide → stays inside).
const rows: PrintRow[] = [
  {
    id: "a",
    activity_type: "Drilling",
    start_date: "2033-01-05",
    end_date: "2033-01-20",
    well_name: "Alpha Well",
    well_project: null,
    rig_name: "RIG1",
    location: "LAND",
    plan_type: null,
    risk: null,
    readiness: {},
  },
  {
    id: "b",
    activity_type: "Drilling",
    start_date: "2033-05-01",
    end_date: "2033-09-01",
    well_name: "Bravo Well",
    well_project: null,
    rig_name: "RIG1",
    location: "LAND",
    plan_type: null,
    risk: null,
    readiness: {},
  },
];

describe("RevisionPrintDoc — readiness chart short-bar labels", () => {
  it("spills a narrow bar's well name beside the bar and keeps a wide bar's name inside", () => {
    render(
      <RevisionPrintDoc
        revision={revision}
        project={null}
        rows={rows}
        chart="readiness"
        includeSchedule={false}
        signatures="wetink"
      />,
    );

    // Narrow bar → the name is its own spilled label: positioned in the gutter
    // (inline left/maxWidth), with no bar fill behind it.
    const alpha = screen.getByText("Alpha Well");
    expect(alpha.style.maxWidth).toMatch(/%$/);
    expect(alpha.style.left).toMatch(/%$/);
    expect(alpha.style.backgroundColor).toBe("");

    // Wide bar → the name rides inside the coloured bar: a .truncate span whose
    // parent carries the activity-colour background.
    const bravo = screen.getByText("Bravo Well");
    expect(bravo.className).toContain("truncate");
    expect(bravo.parentElement?.style.backgroundColor).not.toBe("");
  });
});
