import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

// Mock echarts-for-react to avoid canvas in jsdom
vi.mock("echarts-for-react", () => ({
  default: ({ style }: { style?: React.CSSProperties }) => (
    <div data-testid="echarts-instance" style={style} />
  ),
}));

vi.mock("@/lib/auth", () => ({
  getAccessToken: async () => "test-token",
  msalInstance: { getAllAccounts: () => [], logoutRedirect: vi.fn() },
  loginRequest: {},
}));

import type { Activity } from "@/api/activities";
import { DrillChart } from "@/components/chart/DrillChart";
import { ImportDialog } from "@/components/chart/ImportDialog";

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
    location: "OFFSHORE",
    project_group: null,
    readiness_check: null,
    readiness_check_status: null,
    risk: null,
    comment: null,
    plan_type: "Firm",
    rig_contract_expiry_date: null,
    rig_contract_days_remaining: null,
  },
  {
    id: "act-002",
    project_id: "proj-001",
    activity_type: "Gas Development",
    start_date: "2026-04-01",
    end_date: "2026-06-30",
    well_name: "Well-B2",
    rig_name: "Rig Beta",
    location: "LAND",
    project_group: null,
    readiness_check: null,
    readiness_check_status: null,
    risk: null,
    comment: null,
    plan_type: "Option",
    rig_contract_expiry_date: null,
    rig_contract_days_remaining: null,
  },
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
});
