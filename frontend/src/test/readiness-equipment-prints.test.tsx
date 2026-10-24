/**
 * Phase 7 on the prints (docs/readiness-framework-spec.md §8.4, §8.8): a
 * category prints ONE icon — the worst of its types that apply — and a strip's
 * column count is the lens's checks with no category plus its categories (the
 * frozen catalog on a revision print). The readiness key names each category
 * once, with its types.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { http, HttpResponse } from "msw";

vi.mock("@/lib/auth", () => ({
  getAccessToken: async () => "test-token",
  msalInstance: { getAllAccounts: () => [], logoutRedirect: vi.fn() },
  loginRequest: {},
}));

import type { Activity } from "@/api/activities";
import type { RevisionDetail } from "@/api/revisions";
import { SequencePrintControl } from "@/components/chart/SequencePrintControl";
import {
  BUILTIN_PROJECT_GATES,
  BUILTIN_TEAMS,
  FrozenCatalogProvider,
  ReadinessCatalogProvider,
  ReadinessLensProvider,
} from "@/components/readiness/catalog";
import { RevisionPrintDoc, type PrintRow } from "@/components/revisions/RevisionPrintDoc";
import { categoryCode, stripColumnCount } from "@/lib/chart-layout";
import { snapshotRowsForLens } from "@/lib/readiness-snapshot";
import { LOGISTICS, LOGISTICS_CHECKS, W1_CELLS, equipmentTeam } from "./equipment-fixtures";
import { mockProject } from "./mocks/handlers";
import { server } from "./mocks/server";

const revision = {
  id: "rev-1",
  rev_number: 1,
  status: "draft",
  integrity_digest: null,
  reviewer_status: [],
  approver_status: [],
  signatures: [],
} as unknown as RevisionDetail;

const FROZEN = [...BUILTIN_PROJECT_GATES, ...LOGISTICS_CHECKS];

function row(over: Partial<PrintRow> = {}): PrintRow {
  return {
    id: "w1",
    activity_type: "Drilling",
    start_date: "2033-01-05",
    end_date: "2033-02-20",
    well_name: "W-1",
    well_project: "Bonga Phase 3",
    rig_name: "RIG1",
    location: "LAND",
    plan_type: null,
    risk: null,
    readiness: {},
    ...over,
  };
}

function renderRevisionPrint(rows: PrintRow[], lens = "logistics") {
  return render(
    <FrozenCatalogProvider checks={FROZEN}>
      <ReadinessLensProvider lens={lens}>
        <RevisionPrintDoc
          revision={revision}
          project={null}
          rows={rows}
          chart="readiness"
          includeSchedule
          signatures="wetink"
        />
      </ReadinessLensProvider>
    </FrozenCatalogProvider>,
  );
}

describe("revision print — categories from the frozen catalog", () => {
  it("prints the core checks that applied and one icon per category, in a 7-column strip", () => {
    // What the submitted snapshot recorded for W-1 (not-selected types aren't
    // recorded at all; NAV is N/A — it didn't apply).
    const at_submission = Object.fromEntries(
      Object.entries(W1_CELLS)
        .filter(([, c]) => !(c.applies === false && c.applies_source === "default"))
        .map(([code, c]) => [code, { status: c.applies ? c.status : ("N/A" as const), source: c.source }]),
    );
    const [printed] = snapshotRowsForLens(
      [row({ readiness_at_submission: at_submission, readiness: { FDP: "Completed" } })],
      "logistics",
      FROZEN,
      [...BUILTIN_TEAMS, LOGISTICS],
    );
    expect(printed.readiness).toEqual({
      "L-BUD": "Completed",
      CTR: "On Track",
      PO: "On Track",
      [categoryCode("Vessels")]: "Behind",
      [categoryCode("Lifting")]: "Completed",
    });

    renderRevisionPrint([printed]);
    const strip = screen.getByTestId("gantt-readiness-strip");
    expect(strip.querySelectorAll("svg")).toHaveLength(5);
    // 4 core checks + 3 categories — not 10 columns.
    expect(stripColumnCount(LOGISTICS_CHECKS)).toBe(7);
    expect(strip.querySelector<HTMLElement>(".grid")!.style.gridTemplateColumns).toBe(
      "repeat(7, minmax(0, 1fr))",
    );
    // Vessels prints red (PSV Behind).
    expect(strip.querySelectorAll(".text-red-500")).toHaveLength(1);
  });

  it("the key names each category once, with its types", () => {
    renderRevisionPrint([row({ readiness: { [categoryCode("Vessels")]: "Behind" } })]);
    const entries = screen.getAllByTestId("print-key-category").map((e) => e.textContent);
    // The key repeats per chart page and above the schedule table; each lists
    // the same three categories.
    expect(entries.slice(0, 3)).toEqual([
      "Vessels(DSV, PSV, PC)",
      "Barges(JUB, CBG)",
      "Lifting(CR)",
    ]);
    // No equipment type has a key entry of its own.
    expect(screen.queryByText("Platform Support Vessel")).not.toBeInTheDocument();
  });

  it("a catalog frozen before categories prints each check on its own", () => {
    const pre039 = FROZEN.map(({ category: _c, applies_by_default: _a, ...rest }) => rest);
    render(
      <FrozenCatalogProvider checks={pre039}>
        <ReadinessLensProvider lens="logistics">
          <RevisionPrintDoc
            revision={revision}
            project={null}
            rows={[row({ readiness: { "L-BUD": "Completed", PSV: "Behind" } })]}
            chart="readiness"
            includeSchedule={false}
            signatures="wetink"
          />
        </ReadinessLensProvider>
      </FrozenCatalogProvider>,
    );
    const strip = screen.getByTestId("gantt-readiness-strip");
    expect(strip.querySelectorAll("svg")).toHaveLength(2);
    expect(strip.querySelector<HTMLElement>(".grid")!.style.gridTemplateColumns).toBe(
      "repeat(10, minmax(0, 1fr))",
    );
    expect(screen.queryByTestId("print-key-category")).not.toBeInTheDocument();
  });

  it("the Project gates print as before", () => {
    renderRevisionPrint([row({ readiness: { FDP: "N/A", LLI: "Completed" } })], "projects");
    const strip = screen.getByTestId("gantt-readiness-strip");
    expect(strip.querySelectorAll("svg")).toHaveLength(BUILTIN_PROJECT_GATES.length);
    expect(screen.queryByTestId("print-key-category")).not.toBeInTheDocument();
  });

  it("escapes admin-entered category names in the key (React text, never HTML)", () => {
    const evil = FROZEN.map((c) => (c.code === "CR" ? { ...c, category: "<b>Lift</b>" } : c));
    render(
      <FrozenCatalogProvider checks={evil}>
        <ReadinessLensProvider lens="logistics">
          <RevisionPrintDoc
            revision={revision}
            project={null}
            rows={[row({ readiness: { [categoryCode("<b>Lift</b>")]: "Completed" } })]}
            chart="readiness"
            includeSchedule={false}
            signatures="wetink"
          />
        </ReadinessLensProvider>
      </FrozenCatalogProvider>,
    );
    expect(screen.getAllByText("<b>Lift</b>").length).toBeGreaterThan(0);
    expect(document.querySelector("b")).toBeNull();
  });
});

describe("sequence print (live) — categories roll up like the chart", () => {
  beforeEach(() => {
    window.print = vi.fn();
  });
  afterEach(() => {
    document.body.classList.remove("ds-printing-revision");
  });

  it("prints one icon per category, sized by core checks + categories", async () => {
    const act = {
      id: "a1", project_id: "p1", activity_type: "Oil Development", start_date: "2026-01-01",
      end_date: "2026-06-01", well_name: "W-1", rig_name: "Rig 1", hwu_name: null,
      well_project: "Bonga Phase 3", project_group: null, location: "LAND", risk: null, comment: null,
      plan_type: "Firm", completed_at: null, updated_at: "", updated_by_name: null,
      locked_by_revision_id: null, readiness_required: true,
    } as unknown as Activity;
    server.use(
      http.get("/api/readiness/catalog", () =>
        HttpResponse.json({ teams: [...BUILTIN_TEAMS, LOGISTICS], checks: FROZEN, status_sets: {} }),
      ),
      http.get("/api/projects/:projectId/readiness/teams/:team", () => {
        const data = equipmentTeam();
        data.well_rows = [{ ...data.well_rows[0], well_project: "Bonga Phase 3" }];
        return HttpResponse.json(data);
      }),
    );
    render(
      <ReadinessCatalogProvider>
        <SequencePrintControl projectId={mockProject.id} activities={[act]} lens="logistics" />
      </ReadinessCatalogProvider>,
    );
    await userEvent.click(screen.getByTestId("sequence-print"));
    await userEvent.click(await screen.findByText("Sequence with Readiness Icons"));
    await screen.findByText("All teams (one badge each)");
    await userEvent.click(await screen.findByText("Print working copy"));
    await waitFor(() => {
      expect(document.body.querySelector(":scope > .ds-print-doc")).not.toBeNull();
    });
    const bundle = document.body.querySelector<HTMLElement>(":scope > .ds-print-doc")!;
    const strip = bundle.querySelector<HTMLElement>('[data-testid="gantt-readiness-strip"]')!;
    // L-BUD, CTR, PO + Vessels + Lifting.
    expect(strip.querySelectorAll("svg")).toHaveLength(5);
    expect(strip.querySelector<HTMLElement>(".grid")!.style.gridTemplateColumns).toBe(
      "repeat(7, minmax(0, 1fr))",
    );
    expect(strip.querySelectorAll(".text-red-500")).toHaveLength(1);
    expect(bundle.querySelectorAll('[data-testid="print-key-category"]').length).toBeGreaterThan(0);

    window.dispatchEvent(new Event("afterprint"));
  });
});
