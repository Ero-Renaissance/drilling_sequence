import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/api/dashboard", () => ({ fetchDashboard: vi.fn() }));

import { fetchDashboard, type DashboardResponse } from "@/api/dashboard";
import { ProjectDashboard } from "@/components/dashboard/ProjectDashboard";

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
      focus_count: 4, overall_pct: 62, on_track_pct: 89, behind_cells: 1, ready: 2, ready_of: 4,
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
    <MemoryRouter>
      <ProjectDashboard projectId="p1" />
    </MemoryRouter>,
  );
}

describe("ProjectDashboard", () => {
  beforeEach(() => {
    vi.mocked(fetchDashboard).mockReset();
    // Both horizons persist as viewing habits — isolate tests from each other.
    window.localStorage.clear();
  });

  it("renders hero tiles from the dashboard data", async () => {
    vi.mocked(fetchDashboard).mockResolvedValue(makeData());
    renderDash();
    expect(await screen.findByText("Fleet status")).toBeInTheDocument();
    expect(screen.getByText("Completed YTD")).toBeInTheDocument();
    expect(screen.getByText("9")).toBeInTheDocument(); // completed_ytd value
    // The Project gates card: the three figures (spec §3.7) and what it counts —
    // no ready count on the card (that lives on the Readiness tab).
    const gates = screen.getByRole("link", { name: /Project gates/ });
    expect(gates).toHaveTextContent("62%complete");
    expect(gates).toHaveTextContent("89% on track · 1 behind");
    expect(gates).toHaveTextContent("4 field projects");
    expect(gates).not.toHaveTextContent(/ready/);
    // The Approval tile is retired — plan state lives in the header chip and
    // the lock banner, not the KPI row.
    expect(screen.queryByText("Approval")).not.toBeInTheDocument();
    expect(screen.queryByText("Pending approval")).not.toBeInTheDocument();
  });

  it("every tile is a door into the tab that acts on it", async () => {
    vi.mocked(fetchDashboard).mockResolvedValue(makeData());
    renderDash();
    await screen.findByText("Fleet status");
    const href = (label: string | RegExp) =>
      screen.getByRole("link", { name: label }).getAttribute("href");
    expect(href(/Completed YTD/)).toBe("/projects/p1/data");
    // The tile opens the tab on its own lens and window (spec §3.7).
    expect(href(/Project gates/)).toBe("/projects/p1/readiness?lens=projects&horizon=12");
    expect(href(/Fleet status/)).toBe("/projects/p1/fleet");
    expect(href(/Contracts at risk/)).toBe("/projects/p1/fleet?focus=contracts");
  });

  it("splits the fleet tile by kind and procurement", async () => {
    vi.mocked(fetchDashboard).mockResolvedValue(makeData());
    renderDash();
    await screen.findByText("Fleet status");
    // A 2×2: one column per kind — procured count headlines, that kind's
    // planned (no awarded unit yet) count sits beneath it.
    expect(screen.getByText("rigs in use")).toBeInTheDocument(); // 5 rigs
    expect(screen.getByText("HWUs in use")).toBeInTheDocument(); // 2 HWUs
    expect(screen.getByText("3 rigs planned")).toBeInTheDocument();
    expect(screen.getByText("1 HWU planned")).toBeInTheDocument();
  });

  it("removed the needs-attention section from the overview", async () => {
    vi.mocked(fetchDashboard).mockResolvedValue(makeData());
    renderDash();
    await screen.findByText("Fleet status");
    expect(screen.queryByText("Needs attention")).not.toBeInTheDocument();
    expect(screen.queryByText(/overdue \(past due/i)).not.toBeInTheDocument();
  });

  it("shows per-PROJECT counts inside the gate segments", async () => {
    vi.mocked(fetchDashboard).mockResolvedValue(makeData());
    renderDash();
    await screen.findByText("Fleet status");
    // Fixture gates: BUD completed 2 / on_track 2; FID on_track 3 / behind 1.
    // Each segment carries its project count and a named tooltip.
    const completedSeg = screen.getByTitle("Completed: 2 projects");
    expect(completedSeg).toHaveTextContent("2");
    expect(screen.getByTitle("Behind: 1 project")).toBeInTheDocument();
    expect(screen.getByTitle("On track: 3 projects")).toHaveTextContent("3");
  });

  it("readiness horizon select refetches with the chosen window and relabels", async () => {
    vi.mocked(fetchDashboard).mockResolvedValue(makeData());
    renderDash();
    await screen.findByText("Fleet status");
    const readinessHref = () =>
      screen.getByRole("link", { name: /Project gates/ }).getAttribute("href");
    expect(vi.mocked(fetchDashboard)).toHaveBeenLastCalledWith("p1", 12, 0);
    expect(screen.getByText(/Readiness · next 12 months/i)).toBeInTheDocument();
    // The tile deep-links into the readiness page pre-filtered to its window.
    expect(readinessHref()).toBe("/projects/p1/readiness?lens=projects&horizon=12");

    fireEvent.change(screen.getByLabelText("Readiness horizon"), { target: { value: "6" } });
    await waitFor(() =>
      expect(vi.mocked(fetchDashboard)).toHaveBeenLastCalledWith("p1", 6, 0),
    );
    expect(await screen.findByText(/Readiness · next 6 months/i)).toBeInTheDocument();
    expect(readinessHref()).toBe("/projects/p1/readiness?lens=projects&horizon=6");

    fireEvent.change(screen.getByLabelText("Readiness horizon"), { target: { value: "0" } });
    await waitFor(() =>
      expect(vi.mocked(fetchDashboard)).toHaveBeenLastCalledWith("p1", 0, 0),
    );
    expect(await screen.findByText(/Readiness · all duration/i)).toBeInTheDocument();
    // "All duration" is not a finite window — the tile links to the unfiltered page.
    expect(readinessHref()).toBe("/projects/p1/readiness?lens=projects");
  });

  it("activity-mix horizon select refetches with its own window and relabels", async () => {
    vi.mocked(fetchDashboard).mockResolvedValue(makeData());
    renderDash();
    await screen.findByText("Fleet status");
    // Defaults: readiness 12, mix 0 (whole plan — the card's historical view).
    expect(vi.mocked(fetchDashboard)).toHaveBeenLastCalledWith("p1", 12, 0);
    expect(screen.getByText(/Activity-type mix · all duration/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Activity mix horizon"), { target: { value: "6" } });
    await waitFor(() =>
      expect(vi.mocked(fetchDashboard)).toHaveBeenLastCalledWith("p1", 12, 6),
    );
    expect(await screen.findByText(/Activity-type mix · next 6 months/i)).toBeInTheDocument();
    // The readiness block keeps its own window — the two filters are independent.
    expect(screen.getByText(/Readiness by gate · next 12 months/i)).toBeInTheDocument();
    expect(window.localStorage.getItem("ds.activity-mix-horizon")).toBe("6");
  });

  it("renders the breakdown panel (plan firmness and idle gaps retired)", async () => {
    vi.mocked(fetchDashboard).mockResolvedValue(makeData());
    renderDash();
    expect(await screen.findByText(/Activity-type mix · all duration/i)).toBeInTheDocument();
    expect(screen.getByText(/Readiness by gate/i)).toBeInTheDocument();
    expect(screen.getByText("Oil Development")).toBeInTheDocument();
    expect(screen.queryByText("Plan firmness")).not.toBeInTheDocument();
    expect(screen.queryByText(/Rig idle gaps/i)).not.toBeInTheDocument();
  });

  it("shows a readiness tile per team, linking to that team's view", async () => {
    vi.mocked(fetchDashboard).mockResolvedValue(
      makeData({
        team_readiness: [
          {
            team_code: "logistics",
            name: "Logistics",
            icon_key: "truck",
            unit: "wells",
            focus_count: 4,
            overall_pct: 25,
            on_track_pct: 70,
            behind_cells: 3,
            ready: 1,
            ready_of: 4,
          },
        ],
      }),
    );
    renderDash();
    const tile = await screen.findByRole("link", { name: /Logistics/ });
    expect(tile).toHaveAttribute("href", "/projects/p1/readiness?lens=logistics&horizon=12");
    // Reads exactly like the Project gates card: no "wells ready" count.
    expect(tile).toHaveTextContent("25%complete");
    expect(tile).toHaveTextContent("70% on track · 3 behind");
    expect(tile).toHaveTextContent("4 wells");
    expect(tile).not.toHaveTextContent(/ready/);
    expect(tile.getAttribute("title")).toMatch(/Completed or On Track \(nothing behind\)/);
  });

  it("groups the readiness cards under one window picked in the group header", async () => {
    vi.mocked(fetchDashboard).mockResolvedValue(
      makeData({
        team_readiness: [
          {
            team_code: "logistics", name: "Logistics", icon_key: "truck", unit: "wells",
            focus_count: 4, overall_pct: 25, on_track_pct: 70, behind_cells: 3, ready: 1, ready_of: 4,
          },
        ],
      }),
    );
    renderDash();
    const group = await screen.findByRole("region", { name: "Readiness" });
    // Project gates first, then each team — side by side in one group…
    expect(
      within(group).getAllByRole("link").map((a) => a.getAttribute("href")),
    ).toEqual([
      "/projects/p1/readiness?lens=projects&horizon=12",
      "/projects/p1/readiness?lens=logistics&horizon=12",
    ]);
    // …with the window stated once, and its picker, in the group header.
    expect(within(group).getByText(/Readiness · next 12 months/i)).toBeInTheDocument();
    expect(within(group).getByLabelText("Readiness horizon")).toBeInTheDocument();
    // The operations row no longer carries a readiness card.
    expect(screen.getAllByRole("link", { name: /Project gates/ })).toHaveLength(1);
  });

  it("breakdown panel is open by default and collapses/expands from its header", async () => {
    vi.mocked(fetchDashboard).mockResolvedValue(makeData());
    renderDash();
    const toggle = await screen.findByRole("button", { name: "Breakdown" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/Readiness by gate/i)).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/Readiness by gate/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Activity-type mix/i)).not.toBeInTheDocument();
    // The hero tiles stay put — only the breakdown folds away.
    expect(screen.getByText(/Completed YTD/i)).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/Readiness by gate/i)).toBeInTheDocument();
  });
});
