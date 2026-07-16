import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/api/dashboard", () => ({ fetchDashboard: vi.fn() }));

import { fetchDashboard, type DashboardResponse } from "@/api/dashboard";
import { ProjectDashboard } from "@/components/dashboard/ProjectDashboard";

const routerFuture = { v7_startTransition: true, v7_relativeSplatPath: true };

function makeData(overrides: Partial<DashboardResponse> = {}): DashboardResponse {
  return {
    generated_at: "2026-05-31",
    plan: { start: "2026-01-01", end: "2035-12-31" },
    activities: {
      total: 10, completed_this_quarter: 2, completed_ytd: 9, overdue: 3, starting_soon: 1,
      by_plan_type: { Firm: 6, Option: 4 },
      by_activity_type: { "Oil Development": 5, "Gas Development": 3 },
    },
    readiness: {
      focus_count: 4, overall_pct: 62, behind_cells: 1, ready: 2,
      by_gate: [
        { code: "BUD", completed: 2, on_track: 2, behind: 0, na: 0 },
        { code: "FID", completed: 0, on_track: 3, behind: 1, na: 0 },
      ],
    },
    rigs: {
      in_use: 5, hwus_in_use: 2, planned_rigs: 3, planned_hwus: 1,
      conflicts: 0, total_idle_days: 120, per_rig: [],
    },
    contracts: { expired: 0, critical: 0, soon: 1, healthy: 3, activities_past_contract: 0 },
    approval: { current_status: "pending_approval", signed: 1, approvers: 3, pending_days: 9, drift_since_approved: 4 },
    risk: { flood: 2, flood_near_term: 1 },
    watchlist: {
      near_term_not_ready: 2, overdue: 3, past_contract: 0, contracts_expiring: 1,
      flood_risk_near_term: 1, stale_approval: 1, conflicts: 0, drift_since_approved: 4,
      unprocured_slots: 2,
    },
    ...overrides,
  };
}

function renderDash() {
  return render(
    <MemoryRouter future={routerFuture}>
      <ProjectDashboard projectId="p1" />
    </MemoryRouter>,
  );
}

describe("ProjectDashboard", () => {
  beforeEach(() => vi.mocked(fetchDashboard).mockReset());

  it("renders hero tiles from the dashboard data", async () => {
    vi.mocked(fetchDashboard).mockResolvedValue(makeData());
    renderDash();
    expect(await screen.findByText("Fleet in use")).toBeInTheDocument();
    expect(screen.getByText("Completed YTD")).toBeInTheDocument();
    expect(screen.getByText("9")).toBeInTheDocument(); // completed_ytd value
    expect(screen.getByText("62%")).toBeInTheDocument();
    expect(screen.getByText("Pending approval")).toBeInTheDocument();
  });

  it("splits the fleet tile by kind and procurement", async () => {
    vi.mocked(fetchDashboard).mockResolvedValue(makeData());
    renderDash();
    await screen.findByText("Fleet in use");
    // A 2×2: one column per kind — procured count headlines, that kind's
    // planned (no awarded unit yet) count sits beneath it.
    expect(screen.getByText("rigs")).toBeInTheDocument(); // 5 rigs
    expect(screen.getByText("HWUs")).toBeInTheDocument(); // 2 HWUs
    expect(screen.getByText("3 planned")).toBeInTheDocument(); // rig column
    expect(screen.getByText("1 planned")).toBeInTheDocument(); // HWU column
  });

  it("shows watchlist rows that drill through to the right tab", async () => {
    vi.mocked(fetchDashboard).mockResolvedValue(makeData());
    renderDash();
    const overdue = await screen.findByText(/overdue/i);
    expect(overdue.closest("a")).toHaveAttribute("href", "/projects/p1/data?focus=overdue");
    // Unprocured slots drill through to the Fleet registry, TBD-filtered.
    const unprocured = screen.getByText(/no awarded rig/i);
    expect(unprocured.closest("a")).toHaveAttribute("href", "/projects/p1/fleet?focus=tbd");
  });

  it("renders the breakdown panel (plan firmness and idle gaps retired)", async () => {
    vi.mocked(fetchDashboard).mockResolvedValue(makeData());
    renderDash();
    expect(await screen.findByText("Activity-type mix")).toBeInTheDocument();
    expect(screen.getByText(/Readiness by gate/i)).toBeInTheDocument();
    expect(screen.getByText("Oil Development")).toBeInTheDocument();
    expect(screen.queryByText("Plan firmness")).not.toBeInTheDocument();
    expect(screen.queryByText(/Rig idle gaps/i)).not.toBeInTheDocument();
  });

  it("shows an all-clear when the watchlist is empty", async () => {
    vi.mocked(fetchDashboard).mockResolvedValue(
      makeData({
        watchlist: {
          near_term_not_ready: 0, overdue: 0, past_contract: 0, contracts_expiring: 0,
          flood_risk_near_term: 0, stale_approval: 0, conflicts: 0, drift_since_approved: 0,
          unprocured_slots: 0,
        },
      }),
    );
    renderDash();
    expect(await screen.findByText(/all clear/i)).toBeInTheDocument();
  });
});
