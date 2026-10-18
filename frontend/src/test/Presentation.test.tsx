import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { http, HttpResponse } from "msw";

vi.mock("@/lib/auth", () => ({
  getAccessToken: async () => "test-token",
  msalInstance: { getAllAccounts: () => [], logoutRedirect: vi.fn() },
  loginRequest: {},
}));

// The chart itself is ECharts — stand it in with what the page hands it: the
// lens it renders through and whether it got readiness for it.
vi.mock("@/components/chart/DrillChart", async () => {
  const { useLens } = await import("@/components/readiness/catalog");
  return {
    DrillChart: ({ readinessMap }: { readinessMap?: Map<string, unknown> }) => {
      const lens = useLens();
      return (
        <div data-testid="chart" data-lens={lens} data-readiness={readinessMap ? readinessMap.size : "none"} />
      );
    },
  };
});

import type { CatalogCheck, CatalogTeam } from "@/api/readiness";
import { BUILTIN_PROJECT_GATES, BUILTIN_TEAMS, ReadinessCatalogProvider } from "@/components/readiness/catalog";
import { Presentation } from "@/pages/Presentation";
import { server } from "./mocks/server";

const LOGISTICS: CatalogTeam = {
  code: "logistics", name: "Logistics", editor_source: "team_grant", icon_key: "truck", sort_order: 20,
};
const PO: CatalogCheck = {
  code: "PO", label: "Purchase Order", team_code: "logistics", applies_project: true, applies_well: true,
  status_set: "standard", icon_key: "receipt", locks_with_plan: false, sort_order: 10,
};

function serve() {
  server.use(
    http.get("/api/readiness/catalog", () =>
      HttpResponse.json({
        teams: [...BUILTIN_TEAMS, LOGISTICS],
        checks: [...BUILTIN_PROJECT_GATES, PO],
        status_sets: {},
        tag_items: [],
      }),
    ),
    http.get("/api/projects/:projectId/hwu-contracts", () => HttpResponse.json([])),
    http.get("/api/projects/:projectId/change-notes", () => HttpResponse.json([])),
    http.get("/api/projects/:projectId/readiness/teams/:team", () =>
      HttpResponse.json({
        team: LOGISTICS,
        checks: [PO],
        project_rows: [],
        well_rows: [
          {
            well_project: "Bonga Phase 3", well_name: "Well-1", activity_type: "Oil Development",
            activity_count: 1, location: "LAND", start_date: "2026-01-01", focus_start: "2026-01-01",
            checks: { PO: { status: "Behind", notes: null, updated_at: null, source: "well" } },
          },
        ],
        locked: false,
      }),
    ),
  );
}

function renderAt(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <ReadinessCatalogProvider>
        <Routes>
          <Route path="/projects/:projectId/present" element={<Presentation />} />
        </Routes>
      </ReadinessCatalogProvider>
    </MemoryRouter>,
  );
}

const PID = "cccccccc-0000-0000-0000-000000000001";

describe("Presentation", () => {
  it("presents the team view the link asks for, and says which", async () => {
    serve();
    renderAt(`/projects/${PID}/present?lens=logistics`);
    await waitFor(() =>
      expect(screen.getByTestId("presentation-lens")).toHaveTextContent("Readiness: Logistics"),
    );
    const chart = await screen.findByTestId("chart");
    expect(chart).toHaveAttribute("data-lens", "logistics");
    // The Logistics readiness (keyed per well) reaches the chart.
    await waitFor(() => expect(chart).toHaveAttribute("data-readiness", "1"));
  });

  it("falls back to the project gates without a lens", async () => {
    serve();
    renderAt(`/projects/${PID}/present`);
    const chart = await screen.findByTestId("chart");
    expect(chart).toHaveAttribute("data-lens", "projects");
    expect(screen.getByTestId("presentation-lens")).toHaveTextContent("Readiness: Project gates");
  });
});
