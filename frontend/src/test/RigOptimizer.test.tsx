import { MemoryRouter } from "react-router-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const run = vi.fn();
const parseSchedule = vi.fn();
vi.mock("@/api/optimizer", async () => {
  const actual = await vi.importActual<object>("@/api/optimizer");
  return {
    ...actual,
    optimizerApi: {
      run: (payload: unknown) => run(payload),
      parseSchedule: (f: File) => parseSchedule(f),
    },
  };
});

// The sequence chart is echarts-based — stub it; the adapter's output is what
// matters here, not canvas rendering.
const chartSpy = vi.fn();
vi.mock("@/components/chart/DrillChart", () => ({
  DrillChart: (props: { activities: unknown[] }) => {
    chartSpy(props.activities);
    return <div data-testid="drill-chart">{props.activities.length} bars</div>;
  },
}));

import { RigOptimizer } from "@/pages/RigOptimizer";

describe("RigOptimizer", () => {
  beforeEach(() => {
    run.mockReset();
    parseSchedule.mockReset();
  });

  it("renders assumptions with the agreed Scenario 1 defaults", () => {
    render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><RigOptimizer /></MemoryRouter>);
    expect(screen.getByDisplayValue("76")).toBeInTheDocument(); // well duration
    expect(screen.getByDisplayValue("45")).toBeInTheDocument(); // project move
    expect(screen.getByDisplayValue("28")).toBeInTheDocument(); // batch gap
  });

  it("submits demand rows and shows the per-terrain rig answer", async () => {
    run.mockResolvedValue({
      run_id: "r1",
      engine: "heuristic",
      warning: null,
      results: [
        {
          terrain: "Land",
          feasible: true,
          rig_count: 2,
          rigs: [
            {
              name: "Land Rig 1",
              wells: [
                {
                  project: "P1",
                  year: 2027,
                  label: "P1 · 2027 · Well 1",
                  start: "2027-01-01",
                  end: "2027-03-18",
                  gap_before_days: 0,
                  gap_kind: "none",
                },
              ],
            },
          ],
          rigs_active_per_year: { 2027: 2 },
          utilization_per_rig: { "Land Rig 1": 0.5 },
          binding: { project: "P1", year: 2027 },
          infeasible_wells: [],
        },
      ],
    });
    render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><RigOptimizer /></MemoryRouter>);

    fireEvent.change(screen.getByPlaceholderText("Project name"), {
      target: { value: "P1" },
    });
    // Volume inputs carry data-testids; the remaining centered spinbuttons are
    // the year columns (2027 first).
    fireEvent.change(screen.getByTestId("oil_volume-0"), { target: { value: "12" } });
    const yearInputs = screen
      .getAllByRole("textbox")
      .filter(
        (el) =>
          (el as HTMLInputElement).className.includes("text-center") &&
          !(el as HTMLElement).getAttribute("data-testid"),
      );
    fireEvent.change(yearInputs[0], { target: { value: "5" } });

    fireEvent.click(screen.getByRole("button", { name: /optimize/i }));

    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    const payload = run.mock.calls[0][0] as {
      demand: { project: string; wells_by_year: Record<string, number> }[];
    };
    expect(payload.demand).toEqual([
      {
        terrain: "Land",
        project: "P1",
        oil_volume: 12,
        domestic_gas_volume: 0,
        export_gas_volume: 0,
        wells_by_year: { "2027": 5 },
      },
    ]);

    // KPI card: terrain label + rig count + binding constraint.
    await screen.findByText("2");
    expect(screen.getByText(/set by P1 in 2027/)).toBeInTheDocument();
    // The rig sequence renders through the real sequence chart (stubbed here),
    // fed by the adapter — one bar per scheduled well.
    await screen.findByTestId("drill-chart");
    expect(chartSpy).toHaveBeenCalled();
    const activities = chartSpy.mock.calls[chartSpy.mock.calls.length - 1][0] as {
      rig_name: string;
      location: string;
      project_group: string;
      well_name: string;
    }[];
    expect(activities).toHaveLength(1);
    expect(activities[0].rig_name).toBe("Land Rig 1");
    expect(activities[0].location).toBe("LAND");
    expect(activities[0].project_group).toBe("P1");
    // Bar label is just the well — no year suffix (the axis + tooltip carry it).
    expect(activities[0].well_name).toBe("Well 1");
  });

  it("shows infeasibility loudly instead of a wrong number", async () => {
    run.mockResolvedValue({
      run_id: "r2",
      engine: "heuristic",
      warning: null,
      results: [
        {
          terrain: "SWO",
          feasible: false,
          rig_count: 0,
          rigs: [],
          rigs_active_per_year: {},
          utilization_per_rig: {},
          binding: null,
          infeasible_wells: [{ project: "P9", year: 2028 }],
        },
      ],
    });
    render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><RigOptimizer /></MemoryRouter>);
    fireEvent.change(screen.getByPlaceholderText("Project name"), {
      target: { value: "P9" },
    });
    const yearInputs = screen
      .getAllByRole("textbox")
      .filter(
        (el) =>
          (el as HTMLInputElement).className.includes("text-center") &&
          !(el as HTMLElement).getAttribute("data-testid"),
      );
    fireEvent.change(yearInputs[0], { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: /optimize/i }));

    await screen.findByText("Infeasible");
    expect(screen.getByText(/P9 \(2028\)/)).toBeInTheDocument();
  });

  function fillRow(project = "P1", wells = "2") {
    fireEvent.change(screen.getByPlaceholderText("Project name"), {
      target: { value: project },
    });
    const yearInputs = screen
      .getAllByRole("textbox")
      .filter(
        (el) =>
          (el as HTMLInputElement).className.includes("text-center") &&
          !(el as HTMLElement).getAttribute("data-testid"),
      );
    fireEvent.change(yearInputs[0], { target: { value: wells } });
  }

  it("rejects non-numeric text in volume fields — no silent zero, no desync", async () => {
    run.mockResolvedValue({ run_id: "rx", engine: "heuristic", warning: null, results: [] });
    render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><RigOptimizer /></MemoryRouter>);
    fillRow();

    // "e5" used to sit visibly in the box while the state read empty — the
    // priority control stayed greyed and the run silently sent 0. Now the
    // characters never land at all.
    const oil = screen.getByTestId("oil_volume-0");
    fireEvent.change(oil, { target: { value: "e5" } });
    expect(oil).toHaveValue("");
    expect(screen.getByTestId("priority-hint")).toBeInTheDocument();

    fireEvent.change(oil, { target: { value: "-50" } });
    expect(oil).toHaveValue("");

    fireEvent.change(oil, { target: { value: "12" } });
    expect(oil).toHaveValue("12");
    expect(screen.queryByTestId("priority-hint")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /optimize/i }));
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    const payload = run.mock.calls[0][0] as { demand: { oil_volume: number }[] };
    expect(payload.demand[0].oil_volume).toBe(12);
  });

  it("greys value priority behind a hint until a volume is captured", () => {
    render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><RigOptimizer /></MemoryRouter>);
    expect(screen.getByTestId("priority-global")).toBeDisabled();
    expect(screen.getByTestId("priority-hint")).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("domestic_gas_volume-0"), {
      target: { value: "30" },
    });
    expect(screen.getByTestId("priority-global")).toBeEnabled();
    expect(screen.queryByTestId("priority-hint")).not.toBeInTheDocument();
  });

  it("sends the global ordering for each terrain in the demand", async () => {
    run.mockResolvedValue({ run_id: "r3", engine: "heuristic", warning: null, results: [] });
    render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><RigOptimizer /></MemoryRouter>);
    fillRow();
    fireEvent.change(screen.getByTestId("oil_volume-0"), { target: { value: "12" } });
    fireEvent.change(screen.getByTestId("priority-global"), {
      target: { value: "domestic_gas,export_gas,oil" },
    });
    fireEvent.click(screen.getByRole("button", { name: /optimize/i }));

    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    const payload = run.mock.calls[0][0] as {
      stream_priority_by_terrain?: Record<string, string[]>;
    };
    expect(payload.stream_priority_by_terrain).toEqual({
      Land: ["domestic_gas", "export_gas", "oil"],
    });
  });

  it("per-terrain override prefills from the global and sends the adjusted order", async () => {
    run.mockResolvedValue({ run_id: "r4", engine: "heuristic", warning: null, results: [] });
    render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><RigOptimizer /></MemoryRouter>);
    fillRow();
    fireEvent.change(screen.getByTestId("oil_volume-0"), { target: { value: "12" } });
    fireEvent.change(screen.getByTestId("priority-global"), {
      target: { value: "oil,domestic_gas,export_gas" },
    });
    fireEvent.click(screen.getByTestId("priority-per-terrain-toggle"));

    // Expanded selects replace the global one, prefilled from it.
    expect(screen.queryByTestId("priority-global")).not.toBeInTheDocument();
    expect(screen.getByTestId("priority-Land")).toHaveValue("oil,domestic_gas,export_gas");
    fireEvent.change(screen.getByTestId("priority-Land"), {
      target: { value: "export_gas,oil,domestic_gas" },
    });
    fireEvent.click(screen.getByRole("button", { name: /optimize/i }));

    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    const payload = run.mock.calls[0][0] as {
      stream_priority_by_terrain?: Record<string, string[]>;
    };
    // Only Land is in the demand — Swamp/Offshore selects don't leak in.
    expect(payload.stream_priority_by_terrain).toEqual({
      Land: ["export_gas", "oil", "domestic_gas"],
    });
  });

  it("omits priority entirely when no ordering is chosen", async () => {
    run.mockResolvedValue({ run_id: "r5", engine: "heuristic", warning: null, results: [] });
    render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><RigOptimizer /></MemoryRouter>);
    fillRow();
    fireEvent.change(screen.getByTestId("oil_volume-0"), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: /optimize/i }));

    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    const payload = run.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.stream_priority_by_terrain).toBeUndefined();
  });

  it("echoes the priority the engine used on the terrain card", async () => {
    run.mockResolvedValue({
      run_id: "r6",
      engine: "milp",
      warning: null,
      results: [
        {
          terrain: "Land",
          feasible: true,
          rig_count: 1,
          rigs: [],
          rigs_active_per_year: { 2027: 1 },
          utilization_per_rig: {},
          binding: null,
          infeasible_wells: [],
          priority_used: ["export_gas", "domestic_gas", "oil"],
        },
      ],
    });
    render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><RigOptimizer /></MemoryRouter>);
    fillRow();
    fireEvent.click(screen.getByRole("button", { name: /optimize/i }));

    await screen.findByText("Priority: Export gas › Domestic gas › Oil");
  });
});
