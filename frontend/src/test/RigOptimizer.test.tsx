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
    // 2027 is the first year column input in the row
    const yearInputs = screen
      .getAllByRole("spinbutton")
      .filter((el) => (el as HTMLInputElement).className.includes("text-center"));
    fireEvent.change(yearInputs[0], { target: { value: "5" } });

    fireEvent.click(screen.getByRole("button", { name: /optimize/i }));

    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    const payload = run.mock.calls[0][0] as {
      demand: { project: string; wells_by_year: Record<string, number> }[];
    };
    expect(payload.demand).toEqual([
      { terrain: "Land", project: "P1", wells_by_year: { "2027": 5 } },
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
      .getAllByRole("spinbutton")
      .filter((el) => (el as HTMLInputElement).className.includes("text-center"));
    fireEvent.change(yearInputs[0], { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: /optimize/i }));

    await screen.findByText("Infeasible");
    expect(screen.getByText(/P9 \(2028\)/)).toBeInTheDocument();
  });
});
