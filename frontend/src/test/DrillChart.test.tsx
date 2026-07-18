import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

// Mock echarts-for-react to avoid canvas in jsdom; capture the last option so
// tests can assert on the chart's declarative shape (axes, zoom, marklines).
const captured = vi.hoisted(() => ({ option: undefined as unknown }));
vi.mock("echarts-for-react/lib/core", () => ({
  default: ({ option, style }: { option?: unknown; style?: React.CSSProperties }) => {
    captured.option = option;
    return <div data-testid="echarts-instance" style={style} />;
  },
}));

vi.mock("@/lib/auth", () => ({
  getAccessToken: async () => "test-token",
  msalInstance: { getAllAccounts: () => [], logoutRedirect: vi.fn() },
  loginRequest: {},
}));

import type { Activity } from "@/api/activities";
import { http, HttpResponse } from "msw";
import { DrillChart } from "@/components/chart/DrillChart";
import { ImportDialog } from "@/components/chart/ImportDialog";
import { server } from "./mocks/server";

const routerFuture = { v7_startTransition: true, v7_relativeSplatPath: true };

const MOCK_ACTIVITIES: Activity[] = [
  {
    id: "act-001",
    project_id: "proj-001",
    activity_type: "Oil Development",
    start_date: "2026-01-01",
    end_date: "2026-03-31",
    well_name: "Well-A1",
    rig_name: "Rig Alpha",
    well_project: null,
    location: "OFFSHORE",
    project_group: null,
    risk: null,
    comment: null,
    plan_type: "Firm",
    completed_at: null,
    updated_at: "2026-05-25T08:00:00Z",
    updated_by_name: null,
    locked_by_revision_id: null,
  },
  {
    id: "act-002",
    project_id: "proj-001",
    activity_type: "Gas Development",
    start_date: "2026-04-01",
    end_date: "2026-06-30",
    well_name: "Well-B2",
    rig_name: "Rig Beta",
    well_project: null,
    location: "LAND",
    project_group: null,
    risk: null,
    comment: null,
    plan_type: "Option",
    completed_at: null,
    updated_at: "2026-05-25T09:00:00Z",
    updated_by_name: null,
    locked_by_revision_id: null,
  },
];

// A campaign spanning three calendar years (2026 → 2028) for the focus-year strip.
const MULTI_YEAR_ACTIVITIES: Activity[] = [
  {
    ...MOCK_ACTIVITIES[0],
    id: "act-y1",
    start_date: "2026-02-01",
    end_date: "2026-08-31",
  },
  {
    ...MOCK_ACTIVITIES[1],
    id: "act-y3",
    start_date: "2028-03-01",
    end_date: "2028-09-30",
  },
];

// Two distinct projects (and a flood-risk well) for the project filter.
const FILTER_ACTIVITIES: Activity[] = [
  { ...MOCK_ACTIVITIES[0], id: "act-pa", well_project: "Project Alpha", risk: "Flood Risk" },
  { ...MOCK_ACTIVITIES[1], id: "act-pb", well_project: "Project Beta", risk: "No Flood Risk" },
];

// ─── DrillChart ─────────────────────────────────────────────────────────────

describe("DrillChart", () => {
  it("renders the chart container", () => {
    render(<DrillChart activities={MOCK_ACTIVITIES} />);
    expect(screen.getByTestId("drill-chart")).toBeInTheDocument();
  });

  it("mounts the ECharts instance", () => {
    render(<DrillChart activities={MOCK_ACTIVITIES} />);
    expect(screen.getByTestId("echarts-instance")).toBeInTheDocument();
  });

  it("renders with empty activities without crashing", () => {
    render(<DrillChart activities={[]} />);
    expect(screen.getByTestId("drill-chart")).toBeInTheDocument();
  });

  it("renders legendExtra in the right rail, ahead of the legend", () => {
    render(
      <DrillChart
        activities={MOCK_ACTIVITIES}
        legendPosition="right"
        legendExtra={<div data-testid="rail-extra">Change notes</div>}
      />,
    );
    const extra = screen.getByTestId("rail-extra");
    // Pinned alongside the legend: the shared rail is the sticky element…
    const rail = extra.closest('div[class*="lg:sticky"]');
    expect(rail).not.toBeNull();
    // …notes come FIRST (talking points before glance-reference), and on wide
    // screens the rail lays the two side by side.
    expect(rail?.firstElementChild?.contains(extra)).toBe(true);
    expect(rail?.className).toContain("2xl:flex-row");
  });

  it("timescale reads at the top, echoed at the bottom, Today label on top", () => {
    render(<DrillChart activities={MOCK_ACTIVITIES} />);
    const opt = captured.option as {
      xAxis: { position: string; min: number; max: number; splitLine: { show: boolean } }[];
      dataZoom: { xAxisIndex: number[] }[];
      series: { id?: string; markLine?: { label: { show: boolean } } }[];
    };
    expect(Array.isArray(opt.xAxis)).toBe(true);
    expect(opt.xAxis[0].position).toBe("top");
    expect(opt.xAxis[1].position).toBe("bottom");
    // The echo has no bound series — it must share the primary's exact bounds,
    // and the single inside-zoom must drive both so they can't drift apart.
    expect(opt.xAxis[1].min).toBe(opt.xAxis[0].min);
    expect(opt.xAxis[1].max).toBe(opt.xAxis[0].max);
    expect(opt.dataZoom[0].xAxisIndex).toEqual([0, 1]);
    // Gridlines are drawn once (primary only).
    expect(opt.xAxis[0].splitLine.show).toBe(true);
    expect(opt.xAxis[1].splitLine.show).toBe(false);
    // The Today text is a dedicated pixel-placed series (markLine labels
    // anchor in the axis band and collide with the month ticks), so the line
    // itself carries no label.
    expect(opt.series[0].markLine?.label.show).toBe(false);
    expect(opt.series.some((sr) => sr.id === "today-flag")).toBe(true);
  });

  it("shows a focus-year strip spanning every year the campaign covers", () => {
    render(<DrillChart activities={MULTI_YEAR_ACTIVITIES} />);
    expect(screen.getByRole("button", { name: "All" })).toBeInTheDocument();
    // Inclusive 2026..2028 — the gap year 2027 must appear too.
    for (const y of ["2026", "2027", "2028"]) {
      expect(screen.getByRole("button", { name: y })).toBeInTheDocument();
    }
  });

  it("highlights the focused year on click and deselects All", async () => {
    render(<DrillChart activities={MULTI_YEAR_ACTIVITIES} />);
    const all = screen.getByRole("button", { name: "All" });
    const y2027 = screen.getByRole("button", { name: "2027" });
    expect(all).toHaveAttribute("aria-pressed", "true");
    expect(y2027).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(y2027);
    expect(y2027).toHaveAttribute("aria-pressed", "true");
    expect(all).toHaveAttribute("aria-pressed", "false");

    // "All" resets the highlight back to the full span.
    await userEvent.click(all);
    expect(all).toHaveAttribute("aria-pressed", "true");
    expect(y2027).toHaveAttribute("aria-pressed", "false");
  });

  it("multi-selects years into one contiguous window, middle years included", async () => {
    render(<DrillChart activities={MULTI_YEAR_ACTIVITIES} />);
    const y2026 = screen.getByRole("button", { name: "2026" });
    const y2027 = screen.getByRole("button", { name: "2027" });
    const y2028 = screen.getByRole("button", { name: "2028" });

    // Select the two OUTER years — the chart must window 2026→2028 inclusive
    // (a time axis can't skip 2027), and the 2027 chip shows as included.
    await userEvent.click(y2026);
    await userEvent.click(y2028);
    expect(y2026).toHaveAttribute("aria-pressed", "true");
    expect(y2028).toHaveAttribute("aria-pressed", "true");
    expect(y2027).toHaveAttribute("aria-pressed", "false");
    expect(y2027).toHaveAttribute("data-included", "true");

    const zoomed = captured.option as {
      dataZoom: { startValue?: number; endValue?: number }[];
    };
    expect(zoomed.dataZoom[0].startValue).toBe(new Date(2026, 0, 1).getTime());
    expect(zoomed.dataZoom[0].endValue).toBe(new Date(2029, 0, 1).getTime());

    // Deselecting an edge year shrinks the window to what remains selected.
    await userEvent.click(y2028);
    expect(y2027).not.toHaveAttribute("data-included");
    const shrunk = captured.option as {
      dataZoom: { startValue?: number; endValue?: number }[];
    };
    expect(shrunk.dataZoom[0].startValue).toBe(new Date(2026, 0, 1).getTime());
    expect(shrunk.dataZoom[0].endValue).toBe(new Date(2027, 0, 1).getTime());

    // Deselecting the last year returns to All (no zoom window).
    await userEvent.click(y2026);
    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
    const cleared = captured.option as {
      dataZoom: { startValue?: number; endValue?: number }[];
    };
    expect(cleared.dataZoom[0].startValue).toBeUndefined();
  });

  it("hides the year strip for a single-year campaign", () => {
    render(<DrillChart activities={MOCK_ACTIVITIES} />);
    expect(screen.queryByRole("button", { name: "All" })).not.toBeInTheDocument();
  });

  it("shows the project filter only when enabled and >1 project exists", () => {
    // Off by default…
    const { rerender } = render(<DrillChart activities={FILTER_ACTIVITIES} />);
    expect(screen.queryByRole("button", { name: /All projects/i })).not.toBeInTheDocument();
    // …on when enabled.
    rerender(<DrillChart activities={FILTER_ACTIVITIES} enableFilters />);
    expect(screen.getByRole("button", { name: /All projects/i })).toBeInTheDocument();
  });

  it("does not show the project filter when only one project exists", () => {
    render(<DrillChart activities={[FILTER_ACTIVITIES[0]]} enableFilters />);
    expect(screen.queryByRole("button", { name: /All projects/i })).not.toBeInTheDocument();
  });

  it("multi-selects projects and reflects the count in the trigger", async () => {
    render(<DrillChart activities={FILTER_ACTIVITIES} enableFilters />);
    await userEvent.click(screen.getByRole("button", { name: /All projects/i }));
    const alpha = await screen.findByRole("menuitemcheckbox", { name: "Project Alpha" });
    await userEvent.click(alpha);
    expect(alpha).toHaveAttribute("aria-checked", "true");
    // The menu stays open for multi-select; close it to read the trigger, which
    // the open menu marks aria-hidden.
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: /1 selected/i })).toBeInTheDocument();
  });

  it("shows the location filter only when enabled and >1 location exists", () => {
    // FILTER_ACTIVITIES spans two terrains (OFFSHORE + LAND).
    const { rerender } = render(<DrillChart activities={FILTER_ACTIVITIES} />);
    expect(
      screen.queryByRole("button", { name: /All locations/i }),
    ).not.toBeInTheDocument();
    rerender(<DrillChart activities={FILTER_ACTIVITIES} enableFilters />);
    expect(screen.getByRole("button", { name: /All locations/i })).toBeInTheDocument();
  });

  it("does not show the location filter when only one location exists", () => {
    render(<DrillChart activities={[FILTER_ACTIVITIES[0]]} enableFilters />);
    expect(
      screen.queryByRole("button", { name: /All locations/i }),
    ).not.toBeInTheDocument();
  });

  it("multi-selects locations and reflects the count in the trigger", async () => {
    render(<DrillChart activities={FILTER_ACTIVITIES} enableFilters />);
    await userEvent.click(screen.getByRole("button", { name: /All locations/i }));
    const land = await screen.findByRole("menuitemcheckbox", { name: "LAND" });
    await userEvent.click(land);
    expect(land).toHaveAttribute("aria-checked", "true");
    // Menu stays open for multi-select; close it to read the trigger.
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: /1 selected/i })).toBeInTheDocument();
  });

  it("removes rows outside the selected location (hard filter, not dim)", async () => {
    render(<DrillChart activities={FILTER_ACTIVITIES} enableFilters />);
    // Both terrains' activity types show in the legend up front.
    expect(screen.getByText("Oil Development")).toBeInTheDocument(); // act-pa · OFFSHORE
    expect(screen.getByText("Gas Development")).toBeInTheDocument(); // act-pb · LAND

    await userEvent.click(screen.getByRole("button", { name: /All locations/i }));
    await userEvent.click(
      await screen.findByRole("menuitemcheckbox", { name: "OFFSHORE" }),
    );
    await userEvent.keyboard("{Escape}");

    // The LAND row is gone entirely — its activity type drops from the legend
    // (a dimming filter would have kept it present).
    expect(screen.getByText("Oil Development")).toBeInTheDocument();
    expect(screen.queryByText("Gas Development")).not.toBeInTheDocument();
  });
});

// ─── chart-utils unit tests ──────────────────────────────────────────────────

describe("activitiesToChartData", () => {
  it("sorts LAND before OFFSHORE", async () => {
    const { activitiesToChartData } = await import("@/lib/chart-utils");
    const { categories } = activitiesToChartData(MOCK_ACTIVITIES);
    // LAND → SWAMP → OFFSHORE ordering (matches original domain convention)
    expect(categories[0]).toContain("LAND");
    expect(categories[1]).toContain("OFFSHORE");
  });

  it("builds composite labels from location and rig", async () => {
    const { activitiesToChartData } = await import("@/lib/chart-utils");
    const { categories } = activitiesToChartData(MOCK_ACTIVITIES);
    expect(categories.some((c) => c.includes("Rig Alpha"))).toBe(true);
  });

  it("returns one data item per activity", async () => {
    const { activitiesToChartData } = await import("@/lib/chart-utils");
    const { data } = activitiesToChartData(MOCK_ACTIVITIES);
    expect(data).toHaveLength(2);
  });

  it("suppresses readiness checks for an opt-out activity (readiness_required=false)", async () => {
    const { activitiesToChartData } = await import("@/lib/chart-utils");
    // Readiness is keyed by field project (well_project), not activity id (cast:
    // the chart only reads the status off it).
    const readinessMap = new Map([
      ["Bonga Phase 3", { FDP: { status: "Completed" } }],
    ]) as unknown as Parameters<typeof activitiesToChartData>[1];

    // Both belong to the same field project; only the opt-out one drops its gates.
    const optOut: Activity = { ...MOCK_ACTIVITIES[0], well_project: "Bonga Phase 3", readiness_required: false };
    const normal: Activity = { ...MOCK_ACTIVITIES[1], well_project: "Bonga Phase 3" }; // required → gates kept
    const { data } = activitiesToChartData([optOut, normal], readinessMap);
    const byId = Object.fromEntries(data.map((d) => [d.activityId, d]));

    expect(byId["act-001"].tooltip.checks).toBeNull(); // opt-out → gates suppressed
    expect(byId["act-002"].tooltip.checks).not.toBeNull(); // default → gates kept
  });

  it("tags HWU rows and maps the category to the HWU resource", async () => {
    const { activitiesToChartData } = await import("@/lib/chart-utils");
    const hwu: Activity = {
      ...MOCK_ACTIVITIES[0],
      rig_name: null,
      hwu_name: "Unit-1",
      location: "LAND",
    };
    const { categories, categoryToResource } = activitiesToChartData([hwu]);
    // The Y-axis label tags the HWU so it reads distinctly from a rig.
    expect(categories.some((c) => c.includes("HWU · Unit-1"))).toBe(true);
    // HWUs are mobile units — terrain is deliberately not part of their identity.
    expect(categoryToResource.get(categories[0])).toEqual({
      kind: "hwu",
      name: "Unit-1",
      terrain: null,
    });
  });
});

// ─── ImportDialog ────────────────────────────────────────────────────────────

describe("ImportDialog", () => {
  const projectId = "cccccccc-0000-0000-0000-000000000001";

  function renderDialog(onImported = vi.fn()) {
    return render(
      <MemoryRouter future={routerFuture}>
        <ImportDialog projectId={projectId} onImported={onImported} />
      </MemoryRouter>,
    );
  }

  it("opens when trigger button is clicked", async () => {
    renderDialog();
    await userEvent.click(screen.getByRole("button", { name: /import csv/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("closes when Cancel is clicked", async () => {
    renderDialog();
    await userEvent.click(screen.getByRole("button", { name: /import csv/i }));
    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Import button is disabled when no file is selected", async () => {
    renderDialog();
    await userEvent.click(screen.getByRole("button", { name: /import csv/i }));
    expect(screen.getByRole("button", { name: /^import$/i })).toBeDisabled();
  });

  it("calls onImported after successful upload", async () => {
    const onImported = vi.fn();
    renderDialog(onImported);
    await userEvent.click(screen.getByRole("button", { name: /import csv/i }));
    const file = new File(
      ["Activity Type,Start Date,End Date\nOil Development,2026-01-01,2026-03-31"],
      "activities.csv",
      { type: "text/csv" },
    );
    await userEvent.upload(screen.getByTestId("file-input"), file);
    await userEvent.click(screen.getByRole("button", { name: /^import$/i }));
    await waitFor(() => expect(onImported).toHaveBeenCalledWith(2));
  });

  it("downloads the server-generated .xlsx template", async () => {
    // The template comes from the backend (sample rows + Guidance sheet +
    // dropdowns — things a client-side CSV cannot carry).
    server.use(
      http.get("/api/projects/:projectId/activities/import-template", () =>
        HttpResponse.arrayBuffer(new ArrayBuffer(8), {
          headers: {
            "Content-Type":
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          },
        }),
      ),
    );
    // jsdom doesn't implement these — provide them so the download handler runs.
    const createObjectURL = vi.fn(() => "blob:mock");
    URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL;
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    renderDialog();
    await userEvent.click(screen.getByRole("button", { name: /import csv/i }));
    await userEvent.click(
      screen.getByRole("button", { name: /download a blank template/i }),
    );

    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    expect(clickSpy).toHaveBeenCalled();
    clickSpy.mockRestore();
  });

  it("shows a results summary listing skipped wells on a partial import", async () => {
    server.use(
      http.post("/api/projects/:projectId/activities/import", ({ request }) => {
        const dryRun = new URL(request.url).searchParams.get("dry_run") === "true";
        return HttpResponse.json({
          imported: 1,
          replaced: !dryRun,
          skipped: 1,
          skipped_rows: [{ well: "WELL_BAD", reason: "end date is before start date" }],
          warnings: [],
          dry_run: dryRun,
          unknown_types: [],
          applied_mappings: [],
        });
      }),
    );
    const onImported = vi.fn();
    renderDialog(onImported);
    await userEvent.click(screen.getByRole("button", { name: /import csv/i }));
    await userEvent.upload(
      screen.getByTestId("file-input"),
      new File(["x"], "schedule.csv", { type: "text/csv" }),
    );
    await userEvent.click(screen.getByRole("button", { name: /^import$/i }));

    await waitFor(() => expect(screen.getByText("WELL_BAD")).toBeInTheDocument());
    expect(screen.getByText("end date is before start date")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /download skipped/i })).toBeInTheDocument();
    expect(onImported).toHaveBeenCalledWith(1);
  });
});
