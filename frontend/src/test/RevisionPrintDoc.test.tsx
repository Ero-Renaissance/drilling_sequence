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

describe("RevisionPrintDoc — contract-expiry legend", () => {
  it("labels the contract-expiry key 'Contract Expiration'", () => {
    // A rig whose contract is "Completed" with an end date in the PAST → an
    // "expired" urgency → the contract-expiry key renders. #5: only expired
    // contracts are flagged on the print. The far-past date keeps it expired no
    // matter when the suite runs.
    const withContract: PrintRow[] = [
      { ...rows[1], rig_contract_status: "Completed", rig_contract_end: "2020-01-01" },
    ];

    render(
      <RevisionPrintDoc
        revision={revision}
        project={null}
        rows={withContract}
        chart="readiness"
        includeSchedule={false}
        signatures="wetink"
      />,
    );

    // The expiry-key section header now reads the full label, and it's the
    // styled header (uppercase, like the "Activity"/"Flood risk" headers), not
    // stray text. We assert the styled header rather than a global text search.
    const header = screen.getByText("Contract Expiration");
    expect(header.className).toContain("uppercase");
  });

  it("draws the expiry marker as a solid badge with a row tick", () => {
    // The expiry must fall INSIDE the chart's fitted window to render a marker,
    // and be in the past to classify as expired — so the whole fixture lives in
    // 2020: the well drills Jan–Apr, the contract lapsed mid-February.
    const past: PrintRow[] = [
      {
        ...rows[0],
        start_date: "2020-01-05",
        end_date: "2020-04-01",
        rig_contract_status: "Completed",
        rig_contract_end: "2020-02-15",
      },
    ];

    render(
      <RevisionPrintDoc
        revision={revision}
        project={null}
        rows={past}
        chart="readiness"
        includeSchedule={false}
        signatures="wetink"
      />,
    );

    // A SOLID badge (filled urgency circle, white glyph) with a row tick below —
    // not the old white circle with a thin outline icon.
    const marker = screen.getByTitle(/^Contract expired /);
    const badge = marker.firstElementChild as HTMLElement;
    expect(badge.style.backgroundColor).not.toBe("");
    expect(badge.className).toContain("rounded-full");
    const tick = marker.lastElementChild as HTMLElement;
    expect(tick.style.backgroundColor).not.toBe("");
  });

  it("hides the contract-expiry key for a non-expired contract (#5)", () => {
    // A "Completed" contract with a far-FUTURE end date → "healthy", not expired
    // → the print flags nothing, so the key is absent.
    const healthy: PrintRow[] = [
      { ...rows[1], rig_contract_status: "Completed", rig_contract_end: "2099-12-31" },
    ];

    render(
      <RevisionPrintDoc
        revision={revision}
        project={null}
        rows={healthy}
        chart="readiness"
        includeSchedule={false}
        signatures="wetink"
      />,
    );

    expect(screen.queryByText("Contract Expiration")).not.toBeInTheDocument();
  });
});

// ── Readiness strips: one per PROJECT per PAGE (anchor-only print) ────────────

function projRow(id: string, project: string | null, start: string, end: string): PrintRow {
  return {
    id,
    activity_type: "Drilling",
    start_date: start,
    end_date: end,
    well_name: `W-${id}`,
    well_project: project,
    rig_name: "RIG1",
    location: "LAND",
    plan_type: null,
    risk: null,
    readiness: { FDP: "On Track" },
  };
}

function renderReadiness(rows: PrintRow[]) {
  return render(
    <RevisionPrintDoc
      revision={revision}
      project={null}
      rows={rows}
      chart="readiness"
      includeSchedule={false}
      signatures="wetink"
    />,
  );
}

describe("RevisionPrintDoc — page-local readiness anchors", () => {
  it("renders ONE strip per project per page, under its first bar in the window", () => {
    renderReadiness([
      projRow("late", "Bonga Phase 3", "2033-05-01", "2033-07-01"),
      projRow("first", "Bonga Phase 3", "2033-01-05", "2033-02-20"),
      projRow("other", "Egina North", "2033-03-01", "2033-04-01"),
    ]);
    // Same window/page: Bonga's two bars share ONE strip; Egina gets its own.
    expect(screen.getAllByTestId("gantt-readiness-strip")).toHaveLength(2);
  });

  it("re-anchors on every page: a project spanning two windows gets a strip on each", () => {
    // windowYears=1 on the readiness chart → 2033 and 2034 are separate pages.
    renderReadiness([
      projRow("y1", "Bonga Phase 3", "2033-02-01", "2033-06-01"),
      projRow("y2", "Bonga Phase 3", "2034-02-01", "2034-06-01"),
    ]);
    expect(screen.getAllByTestId("gantt-readiness-strip")).toHaveLength(2);
  });

  it("keeps per-bar strips for legacy rows with no field project", () => {
    renderReadiness([
      projRow("a", null, "2033-01-05", "2033-02-20"),
      projRow("b", null, "2033-05-01", "2033-07-01"),
    ]);
    // Old per-activity snapshots: readers stay faithful — a strip per bar.
    expect(screen.getAllByTestId("gantt-readiness-strip")).toHaveLength(2);
  });

  it("never anchors on an opt-out bar", () => {
    renderReadiness([
      { ...projRow("opt", "Bonga Phase 3", "2033-01-05", "2033-02-20"), readiness_required: false },
      projRow("real", "Bonga Phase 3", "2033-05-01", "2033-07-01"),
    ]);
    const strips = screen.getAllByTestId("gantt-readiness-strip");
    expect(strips).toHaveLength(1);
  });
});
