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
    activities: { total: 10, completed_this_quarter: 2, overdue: 3, starting_soon: 1, by_plan_type: {} },
    readiness: { focus_count: 4, overall_pct: 62, behind_cells: 1, ready: 2 },
    rigs: { in_use: 5, conflicts: 0, total_idle_days: 120, per_rig: [] },
    contracts: { expired: 0, critical: 0, soon: 1, healthy: 3, activities_past_contract: 0 },
    approval: { current_status: "pending_approval", signed: 1, approvers: 3, pending_days: 9, drift_since_approved: 4 },
    risk: { high: 2, high_near_term: 1 },
    watchlist: {
      near_term_not_ready: 2, overdue: 3, past_contract: 0, contracts_expiring: 1,
      high_risk_near_term: 1, stale_approval: 1, conflicts: 0, drift_since_approved: 4,
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
    expect(await screen.findByText("Rigs in use")).toBeInTheDocument();
    expect(screen.getByText("62%")).toBeInTheDocument();
    expect(screen.getByText("Pending approval")).toBeInTheDocument();
  });

  it("shows watchlist rows that drill through to the right tab", async () => {
    vi.mocked(fetchDashboard).mockResolvedValue(makeData());
    renderDash();
    const overdue = await screen.findByText(/overdue/i);
    expect(overdue.closest("a")).toHaveAttribute("href", "/projects/p1/data?focus=overdue");
  });

  it("shows an all-clear when the watchlist is empty", async () => {
    vi.mocked(fetchDashboard).mockResolvedValue(
      makeData({
        watchlist: {
          near_term_not_ready: 0, overdue: 0, past_contract: 0, contracts_expiring: 0,
          high_risk_near_term: 0, stale_approval: 0, conflicts: 0, drift_since_approved: 0,
        },
      }),
    );
    renderDash();
    expect(await screen.findByText(/all clear/i)).toBeInTheDocument();
  });
});
