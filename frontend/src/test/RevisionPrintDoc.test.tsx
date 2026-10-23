import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";

import { RevisionPrintDoc, type PrintRow } from "@/components/revisions/RevisionPrintDoc";
import type { RevisionDetail } from "@/api/revisions";
import type { CatalogCheck } from "@/api/readiness";
import {
  BUILTIN_PROJECT_GATES,
  FrozenCatalogProvider,
  ReadinessLensProvider,
} from "@/components/readiness/catalog";

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
    // Any in-force dated contract renders the key — the marker is the
    // expiration DATE as a fact, not an urgency alert.
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

    // One key row: the red badge plus the four-word label — no section header,
    // no urgency vocabulary.
    expect(screen.getByText("Contract expiration date")).toBeInTheDocument();
  });

  it("draws the expiration marker as a solid badge with a row tick", () => {
    // The date must fall INSIDE the chart's fitted window to render a marker;
    // the whole fixture lives in 2020: the well drills Jan–Apr, the contract
    // ends mid-February.
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

    // A SOLID badge (filled red circle, white glyph) with a row tick below.
    const marker = screen.getByTitle(/^Contract expiration /);
    const badge = marker.firstElementChild as HTMLElement;
    expect(badge.style.backgroundColor).not.toBe("");
    expect(badge.className).toContain("rounded-full");
    const tick = marker.lastElementChild as HTMLElement;
    expect(tick.style.backgroundColor).not.toBe("");
  });

  it("marks a contract ending FAR IN THE FUTURE too — the date is a fact, not an alarm", () => {
    // Pre-change, only expired contracts printed a marker; a healthy far-off
    // contract must now mark its end date exactly the same way.
    const future: PrintRow[] = [
      {
        ...rows[0],
        start_date: "2090-01-05",
        end_date: "2090-04-01",
        rig_contract_status: "Completed",
        rig_contract_end: "2090-02-15",
      },
    ];

    render(
      <RevisionPrintDoc
        revision={revision}
        project={null}
        rows={future}
        chart="readiness"
        includeSchedule={false}
        signatures="wetink"
      />,
    );
    expect(screen.getByTitle(/^Contract expiration .*2090/)).toBeInTheDocument();
  });

  it("shows the contract-expiration key for a healthy dated contract too", () => {
    // The retired #5 rule hid the key unless a contract had EXPIRED. The
    // marker now states the expiration date for every in-force contract, so
    // a far-future end date renders the key like any other.
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
    expect(screen.getByText("Contract expiration date")).toBeInTheDocument();
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

  it("anchors per readiness key: a well-level lens prints one strip per well", () => {
    // Same field project, two wells: the project gates share one strip, but a
    // well lens (readiness_key = the well) gives each well its own.
    const w1 = { ...projRow("w1", "Bonga Phase 3", "2033-01-05", "2033-02-20"), readiness_key: "W-1" };
    const w2 = { ...projRow("w2", "Bonga Phase 3", "2033-05-01", "2033-07-01"), readiness_key: "W-2" };
    renderReadiness([w1, w2]);
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

  it("prints no gates for an activity with no field project (spec §3.7)", () => {
    // Snapshots from phase 5 on record an empty block for such an activity.
    renderReadiness([
      { ...projRow("np", null, "2033-01-05", "2033-02-20"), readiness: {} },
      projRow("real", "Bonga Phase 3", "2033-05-01", "2033-07-01"),
    ]);
    expect(screen.getAllByTestId("gantt-readiness-strip")).toHaveLength(1);
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

// ── Team lenses print only the checks that applied (phase 6, spec §8.4) ──────

describe("RevisionPrintDoc — team-lens strips", () => {
  const teamCheck = (code: string, sort_order: number): CatalogCheck => ({
    code, label: code, team_code: "logistics", applies_project: true, applies_well: true,
    status_set: "standard", icon_key: "receipt", locks_with_plan: false, sort_order,
  });
  const frozen = [...BUILTIN_PROJECT_GATES, teamCheck("PO", 10), teamCheck("NAV", 20), teamCheck("CTR", 30)];

  function renderLens(lens: string, readiness: PrintRow["readiness"]) {
    return render(
      <FrozenCatalogProvider checks={frozen}>
        <ReadinessLensProvider lens={lens}>
          <RevisionPrintDoc
            revision={revision}
            project={null}
            rows={[{ ...projRow("w1", "Bonga Phase 3", "2033-01-05", "2033-02-20"), readiness }]}
            chart="readiness"
            includeSchedule={false}
            signatures="wetink"
          />
        </ReadinessLensProvider>
      </FrozenCatalogProvider>,
    );
  }

  it("packs the checks that applied to the left, sized by the lens's check count", () => {
    // PO and CTR didn't apply (the snapshot rows already dropped them).
    renderLens("logistics", { NAV: "Behind" });
    const strip = screen.getByTestId("gantt-readiness-strip");
    expect(strip.querySelectorAll("svg")).toHaveLength(1);
    const grid = strip.querySelector<HTMLElement>(".grid")!;
    expect(grid.style.gridTemplateColumns).toBe("repeat(3, minmax(0, 1fr))");
  });

  it("the Project gates still print every gate, N/A included", () => {
    renderLens("projects", { FDP: "N/A", LLI: "N/A" });
    const strip = screen.getByTestId("gantt-readiness-strip");
    expect(strip.querySelectorAll("svg")).toHaveLength(BUILTIN_PROJECT_GATES.length);
  });
});

// ── The readiness key lists the statuses its icons can show (spec §8.4) ──────

describe("RevisionPrintDoc — readiness key", () => {
  const teamCheck = (code: string, over: Partial<CatalogCheck> = {}): CatalogCheck => ({
    code, label: code, team_code: "logistics", applies_project: true, applies_well: true,
    status_set: "standard", icon_key: "receipt", locks_with_plan: false, sort_order: 10, ...over,
  });
  // Nominated Equipment as a pre-phase-6 revision froze it (history only).
  const NEQ = teamCheck("NEQ", {
    status_set: "availability", icon_key: "forklift", tag_list: "equipment", sort_order: 30,
  });

  function statusKey(lens: string, frozen: CatalogCheck[], readiness: PrintRow["readiness"]): string {
    render(
      <FrozenCatalogProvider checks={frozen}>
        <ReadinessLensProvider lens={lens}>
          <RevisionPrintDoc
            revision={revision}
            project={null}
            rows={[{ ...projRow("w1", "Bonga Phase 3", "2033-01-05", "2033-02-20"), readiness }]}
            chart="readiness"
            includeSchedule={false}
            signatures="wetink"
          />
        </ReadinessLensProvider>
      </FrozenCatalogProvider>,
    );
    const label = Array.from(document.querySelectorAll("span")).find(
      (s) => s.textContent === "Status" && s.className.includes("w-16"),
    )!;
    return label.parentElement!.textContent ?? "";
  }

  it("a team lens keys no N/A", () => {
    expect(statusKey("logistics", [...BUILTIN_PROJECT_GATES, teamCheck("PO")], { PO: "Behind" })).toBe(
      "StatusOn TrackBehindCompleted",
    );
  });

  it("the Project gates and All keep N/A", () => {
    const frozen = [...BUILTIN_PROJECT_GATES, teamCheck("PO")];
    expect(statusKey("projects", frozen, { FDP: "N/A" })).toBe("StatusOn TrackBehindCompletedN/A");
  });

  it("a revision that recorded Nominated Equipment keys its history statuses", () => {
    expect(
      statusKey("logistics", [...BUILTIN_PROJECT_GATES, teamCheck("PO"), NEQ], { PO: "Completed", NEQ: "Not available" }),
    ).toBe("StatusOn TrackBehindCompletedPendingAvailableNot available");
  });

  it("also keys any other known status the rows draw", () => {
    // A lens whose frozen catalog lost the definition still keys what it drew.
    expect(statusKey("projects", [...BUILTIN_PROJECT_GATES], { FDP: "Completed", LLI: "Pending" })).toBe(
      "StatusOn TrackBehindCompletedN/APending",
    );
  });
});

describe("RevisionPrintDoc — years per page", () => {
  it("readinessYears=3 fits a two-year project on ONE page (one strip)", () => {
    render(
      <RevisionPrintDoc
        revision={revision}
        project={null}
        rows={[
          projRow("y1", "Bonga Phase 3", "2033-02-01", "2033-06-01"),
          projRow("y2", "Bonga Phase 3", "2034-02-01", "2034-06-01"),
        ]}
        chart="readiness"
        includeSchedule={false}
        signatures="wetink"
        readinessYears={3}
      />,
    );
    // Same project, one 3-year window → a single page-local anchor strip
    // (the default 1-year pagination puts these on two pages → two strips,
    // asserted by the re-anchoring test above).
    expect(screen.getAllByTestId("gantt-readiness-strip")).toHaveLength(1);
  });
});

describe("Terrain-major sections", () => {
  const terrainRows: PrintRow[] = [
    { id: "o1", activity_type: "Drilling", start_date: "2033-02-01", end_date: "2033-05-01",
      well_name: "OFF-1", well_project: null, rig_name: "Deep Rig", location: "OFFSHORE",
      plan_type: null, risk: null, readiness: {} },
    { id: "l1", activity_type: "Drilling", start_date: "2033-01-05", end_date: "2033-04-01",
      well_name: "LAND-1", well_project: null, rig_name: "RIG1", location: "LAND",
      plan_type: null, risk: null, readiness: {} },
    { id: "s1", activity_type: "Drilling", start_date: "2033-03-01", end_date: "2033-06-01",
      well_name: "SW-1", well_project: null, rig_name: "Barge 2", location: "SWAMP",
      plan_type: null, risk: null, readiness: {} },
  ];

  it("prints the complete Land terrain, then Swamp, then Offshore — old Sequence heading gone", () => {
    render(
      <RevisionPrintDoc revision={revision} project={null} rows={terrainRows} chart="standard" />,
    );
    const heads = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    const land = heads.indexOf("Land terrain");
    const swamp = heads.indexOf("Swamp terrain");
    const offshore = heads.indexOf("Offshore terrain");
    expect(land).toBeGreaterThanOrEqual(0);
    expect(swamp).toBeGreaterThan(land);
    expect(offshore).toBeGreaterThan(swamp);
    // The superseded chart headings are gone.
    expect(heads).not.toContain("Sequence");
    expect(heads).not.toContain("Sequence readiness");
  });

  it("skips empty terrains and adds Unassigned only when location-less rows exist", () => {
    const landOnly = terrainRows.filter((r) => r.location === "LAND");
    const { unmount } = render(
      <RevisionPrintDoc revision={revision} project={null} rows={landOnly} chart="standard" />,
    );
    let heads = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(heads).toContain("Land terrain");
    expect(heads).not.toContain("Swamp terrain");
    expect(heads).not.toContain("Unassigned");
    unmount();

    render(
      <RevisionPrintDoc
        revision={revision}
        project={null}
        rows={[...landOnly, { ...landOnly[0], id: "u1", rig_name: "Float", location: null }]}
        chart="standard"
      />,
    );
    heads = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(heads).toContain("Unassigned");
  });
});

describe("completed activities render grey — the frozen at-submit status", () => {
  const withCompleted: PrintRow[] = [
    { ...rows[0], id: "done", well_name: "Done Well", completed_at: "2033-01-21T00:00:00Z" },
    { ...rows[1], id: "open", well_name: "Open Well" },
  ];

  it("greys a completed bar, keeps the open bar's legend colour, and keys the legend", () => {
    const { container } = render(
      <RevisionPrintDoc
        revision={revision}
        project={null}
        rows={withCompleted}
        chart="standard"
        includeSchedule={false}
        signatures="wetink"
      />,
    );

    const bars = [...container.querySelectorAll<HTMLElement>("span[title]")];
    const done = bars.find((b) => b.title.includes("Done Well"));
    const open = bars.find((b) => b.title.includes("Open Well"));
    expect(done?.style.backgroundColor).toBe("rgb(148, 163, 184)"); // #94a3b8
    expect(done?.title).toContain("· completed");
    expect(open?.style.backgroundColor).not.toBe("rgb(148, 163, 184)");
    expect(open?.title).not.toContain("· completed");

    // The legend decodes the grey; nothing was dropped from the record.
    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(done).toBeDefined();
  });

  it("shows no Completed legend when nothing is completed", () => {
    render(
      <RevisionPrintDoc
        revision={revision}
        project={null}
        rows={rows}
        chart="standard"
        includeSchedule={false}
        signatures="wetink"
      />,
    );
    expect(screen.queryByText("Completed")).not.toBeInTheDocument();
  });
});
