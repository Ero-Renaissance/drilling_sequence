import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

// Capture the ECharts option instead of rendering canvas in jsdom.
const captured = vi.hoisted(() => ({ option: undefined as unknown }));
vi.mock("echarts-for-react/lib/core", () => ({
  default: ({ option }: { option?: unknown }) => {
    captured.option = option;
    return <div data-testid="echarts-instance" />;
  },
}));

vi.mock("@/lib/auth", () => ({
  getAccessToken: async () => "test-token",
  msalInstance: { getAllAccounts: () => [], logoutRedirect: vi.fn() },
  loginRequest: {},
}));

import { http, HttpResponse } from "msw";
import { FleetDemandChart } from "@/components/resources/FleetDemandChart";
import { server } from "./mocks/server";

interface CapturedOption {
  xAxis: { data: string[] };
  series: { name: string; data: { value: number }[] }[];
}

function activity(over: Record<string, unknown>) {
  return {
    id: crypto.randomUUID(),
    project_id: "p1",
    activity_type: "Oil Development",
    start_date: "2026-01-01",
    end_date: "2026-06-30",
    well_name: "W",
    rig_name: null,
    hwu_name: null,
    well_project: null,
    project_group: null,
    location: null,
    risk: null,
    comment: null,
    plan_type: null,
    market: null,
    readiness_required: true,
    completed_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    updated_by_name: null,
    locked_by_revision_id: null,
    ...over,
  };
}

describe("FleetDemandChart", () => {
  it("charts awarded vs planned per year and lists unscheduled units", async () => {
    server.use(
      http.get("/api/projects/:projectId/activities", () =>
        HttpResponse.json([
          activity({ rig_name: "Rig A", location: "LAND", start_date: "2026-02-01", end_date: "2027-03-01" }),
          activity({ rig_name: "TBD Rig 1", location: "SWAMP", start_date: "2027-01-01", end_date: "2027-06-01" }),
        ]),
      ),
      http.get("/api/projects/:projectId/resources", () =>
        HttpResponse.json([
          { id: "r1", project_id: "p1", kind: "rig", terrain: "LAND", name: "Rig A", capability_class: null, is_placeholder: false, updated_at: "2026-07-01T00:00:00Z" },
          { id: "r2", project_id: "p1", kind: "rig", terrain: "SWAMP", name: "TBD Rig 1", capability_class: null, is_placeholder: true, updated_at: "2026-07-01T00:00:00Z" },
          { id: "r3", project_id: "p1", kind: "rig", terrain: "OFFSHORE", name: "Spare Rig", capability_class: null, is_placeholder: false, updated_at: "2026-07-01T00:00:00Z" },
        ]),
      ),
    );

    render(<FleetDemandChart projectId="p1" />);
    await screen.findByTestId("echarts-instance");

    const opt = captured.option as CapturedOption;
    expect(opt.xAxis.data).toEqual(["2026", "2027"]);
    const byName = new Map(opt.series.map((s) => [s.name, s.data.map((d) => d.value)]));
    expect(byName.get("In use")).toEqual([1, 1]);
    expect(byName.get("Planned")).toEqual([0, 1]);

    expect(screen.getByText(/Registered, not yet scheduled/)).toHaveTextContent("Spare Rig");
  });

  it("switches to the HWU view with its own empty state", async () => {
    server.use(
      http.get("/api/projects/:projectId/activities", () =>
        HttpResponse.json([
          activity({ rig_name: "Rig A", location: "LAND" }),
        ]),
      ),
      http.get("/api/projects/:projectId/resources", () => HttpResponse.json([])),
    );

    render(<FleetDemandChart projectId="p1" />);
    await screen.findByTestId("echarts-instance");

    await userEvent.click(screen.getByTestId("fleet-demand-hwu"));
    await waitFor(() =>
      expect(screen.getByText(/No dated HWU activities to chart/)).toBeInTheDocument(),
    );
  });
});

describe("FleetDemandChart filters", () => {
  const nowYear = new Date().getFullYear();

  function mockData() {
    server.use(
      http.get("/api/projects/:projectId/activities", () =>
        HttpResponse.json([
          activity({
            rig_name: "Rig A",
            location: "LAND",
            start_date: `${nowYear}-01-10`,
            end_date: `${nowYear + 4}-03-01`,
          }),
          activity({
            rig_name: "Rig S",
            location: "SWAMP",
            start_date: `${nowYear}-02-01`,
            end_date: `${nowYear}-09-01`,
          }),
        ]),
      ),
      http.get("/api/projects/:projectId/resources", () => HttpResponse.json([])),
    );
  }

  it("scopes bars to the selected terrain and disables the filter on the HWU view", async () => {
    mockData();
    render(<FleetDemandChart projectId="p1" />);
    await screen.findByTestId("echarts-instance");

    let opt = captured.option as CapturedOption;
    expect(opt.xAxis.data).toHaveLength(5);

    await userEvent.click(screen.getByTestId("fleet-demand-terrain-swamp"));
    await waitFor(() => {
      opt = captured.option as CapturedOption;
      expect(opt.xAxis.data).toEqual([String(nowYear)]);
    });

    await userEvent.click(screen.getByTestId("fleet-demand-hwu"));
    expect(screen.getByTestId("fleet-demand-terrain-swamp")).toBeDisabled();
    // Back on rigs: the terrain reset to All while on HWUs.
    await userEvent.click(screen.getByTestId("fleet-demand-rig"));
    await waitFor(() => {
      opt = captured.option as CapturedOption;
      expect(opt.xAxis.data).toHaveLength(5);
    });
  });

  it("applies and persists the duration horizon", async () => {
    window.localStorage.removeItem("ds.fleet-demand-horizon");
    mockData();
    render(<FleetDemandChart projectId="p1" />);
    await screen.findByTestId("echarts-instance");

    await userEvent.selectOptions(screen.getByLabelText("Demand horizon"), "3");
    await waitFor(() => {
      const opt = captured.option as CapturedOption;
      expect(opt.xAxis.data).toEqual([String(nowYear), String(nowYear + 1), String(nowYear + 2)]);
    });
    expect(window.localStorage.getItem("ds.fleet-demand-horizon")).toBe("3");
    window.localStorage.removeItem("ds.fleet-demand-horizon");
  });
});
