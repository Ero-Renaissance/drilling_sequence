/**
 * Well execution readiness (readiness phase 8,
 * docs/well-execution-readiness-spec.md Part A): the Projects team's checks —
 * the former Project gates — through the shared team grid. Every well has each
 * check and follows its field project until it is given its own value; campaign
 * planners edit them; they have no tick list (N/A instead) and an unset one
 * reads Not started.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";

vi.mock("@/lib/auth", () => ({
  getAccessToken: async () => "test-token",
  msalInstance: { getAllAccounts: () => [], logoutRedirect: vi.fn() },
  loginRequest: {},
}));

type TestUser = { id: string; is_admin: boolean; teams: string[] };
let currentUser: TestUser | null = null;
vi.mock("@/store/auth", () => ({
  useAuthStore: (selector: (s: { user: TestUser | null }) => unknown) =>
    selector({ user: currentUser }),
}));

import { TeamReadinessGrid } from "@/components/readiness/TeamReadinessGrid";
import { BUILTIN_PROJECT_GATES, BUILTIN_TEAMS, lensLabel } from "@/components/readiness/catalog";
import {
  STATUS_SEVERITY,
  defaultStatusOf,
  pickableStatuses,
  worstStatus,
} from "@/components/readiness/check-meta";
import { sumFigures } from "@/lib/readiness-figures";
import { Toaster } from "@/components/ui/toaster";
import { server } from "./mocks/server";
import { mockGateTeam } from "./mocks/handlers";

const PID = "cccccccc-0000-0000-0000-000000000001";
let puts: Record<string, unknown>[] = [];
let resets: Record<string, unknown>[] = [];

beforeEach(() => {
  currentUser = { id: "p1", is_admin: false, teams: [] };
  puts = [];
  resets = [];
  window.localStorage.clear();
  server.use(
    // Bonga Phase 3 has FID Completed; W-1 follows it, W-2 has its own (Behind).
    http.get("/api/projects/:projectId/readiness/teams/projects", () =>
      HttpResponse.json(
        mockGateTeam({
          wells: [
            { well_project: "Bonga Phase 3", well_name: "W-1" },
            { well_project: "Bonga Phase 3", well_name: "W-2" },
          ],
          projectStatuses: { "Bonga Phase 3": { FID: "Completed" } },
          wellStatuses: { "Bonga Phase 3\u0001W-2": { FID: "Behind" } },
        }),
      ),
    ),
    http.put("/api/projects/:projectId/readiness/:checkCode", async ({ request, params }) => {
      puts.push({ code: params.checkCode, ...((await request.json()) as object) });
      return HttpResponse.json({});
    }),
    http.post("/api/projects/:projectId/readiness/:checkCode/reset", async ({ request, params }) => {
      resets.push({ code: params.checkCode, ...((await request.json()) as object) });
      return HttpResponse.json({});
    }),
  );
});

function renderGrid(canEditPlan: boolean, path = "/?view=wells") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <TeamReadinessGrid projectId={PID} teamCode="projects" canEditPlan={canEditPlan} />
      <Toaster />
    </MemoryRouter>,
  );
}

const rowOf = (region: HTMLElement, name: string) => within(region).getByText(name).closest("tr")!;

describe("the definitions (phase 8)", () => {
  it("names each lens '<Team> Execution Readiness'", () => {
    expect(lensLabel(BUILTIN_TEAMS[0])).toBe("Well Execution Readiness");
    expect(lensLabel({ code: "logistics", name: "Logistics" })).toBe("Logistics Execution Readiness");
    expect(lensLabel({ code: "all", name: "All" })).toBe("All teams");
  });

  it("there are eight checks, at both levels, on the execution set", () => {
    expect(BUILTIN_PROJECT_GATES.map((c) => c.code)).toEqual([
      "FDP", "FID", "BUD", "FE", "EIA", "LLI", "LOC", "WP",
    ]);
    for (const c of BUILTIN_PROJECT_GATES) {
      expect(c.applies_project && c.applies_well && c.locks_with_plan).toBe(true);
      expect(defaultStatusOf(c.status_set)).toBe("Not started");
      // A label equal to its code would read "FID FID" beside the code.
      expect(c.label).not.toBe(c.code);
    }
    expect(pickableStatuses(BUILTIN_PROJECT_GATES[0])).toEqual([
      "Not started", "On Track", "Behind", "Completed", "N/A",
    ]);
  });

  it("Not started is counted but not on track, and ranks between Behind and On Track", () => {
    expect(STATUS_SEVERITY["Not started"]).toBe("not_started");
    expect(worstStatus(["Completed", "On Track", "Not started"])).toBe("Not started");
    expect(worstStatus(["Not started", "Behind"])).toBe("Behind");
    const f = sumFigures([
      { counted: 4, done: 1, in_progress: 1, not_started: 2, behind: 0, ready: false },
    ]);
    expect([f.complete_pct, f.on_track_pct, f.not_started]).toEqual([25, 50, 2]);
  });
});

describe("the Well Execution Readiness grid", () => {
  it("a planner sets a check on ONE well; a well with its own value can reset to project", async () => {
    renderGrid(true);
    const wells = await screen.findByRole("region", { name: "Wells" });
    // W-1 follows its field project (faded, labelled); W-2 has its own value.
    const w1 = rowOf(wells, "W-1");
    expect(
      within(w1).getByTitle("Final Investment Decision: Completed (from field project)"),
    ).toBeInTheDocument();
    const w2 = rowOf(wells, "W-2");
    expect(within(w2).getByTitle("Final Investment Decision: Behind")).toBeInTheDocument();

    // Nobody has set Well Permits: W-1 reads its field project's default.
    await userEvent.click(within(w1).getByTitle("Well Permits: Not started (from field project)"));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getAllByRole("menuitem").map((i) => i.textContent)).toEqual([
      "Not started", "On Track", "Behind", "Completed", "N/A",
    ]);
    await userEvent.click(within(menu).getByRole("menuitem", { name: /On Track/ }));
    await waitFor(() =>
      expect(puts[0]).toMatchObject({
        code: "WP",
        scope: "well",
        well_project: "Bonga Phase 3",
        well_name: "W-1",
        status: "On Track",
      }),
    );

    // W-2's own FID can go back to following Bonga Phase 3.
    await userEvent.click(
      within(rowOf(await screen.findByRole("region", { name: "Wells" }), "W-2")).getByTitle(
        "Final Investment Decision: Behind",
      ),
    );
    await userEvent.click(await screen.findByRole("menuitem", { name: /Reset to project/ }));
    await waitFor(() =>
      expect(resets[0]).toMatchObject({ code: "FID", scope: "well", well_name: "W-2" }),
    );
  });

  it("has no tick list: these checks use N/A", async () => {
    renderGrid(true);
    await screen.findByRole("region", { name: "Wells" });
    expect(screen.queryByRole("button", { name: /^Checks…/ })).not.toBeInTheDocument();
  });

  it("the Projects view sets the field project's value, which its wells follow", async () => {
    renderGrid(true, "/?view=projects");
    const projects = await screen.findByRole("region", { name: "Field projects" });
    const row = rowOf(projects, "Bonga Phase 3");
    await userEvent.click(within(row).getByTitle("Well Permits: Not started"));
    await userEvent.click(await screen.findByRole("menuitem", { name: /Completed/ }));
    await waitFor(() =>
      expect(puts[0]).toMatchObject({
        code: "WP",
        scope: "project",
        well_project: "Bonga Phase 3",
        status: "Completed",
      }),
    );
  });

  it("is view-only for someone who isn't a planner on the campaign", async () => {
    renderGrid(false);
    const wells = await screen.findByRole("region", { name: "Wells" });
    expect(
      screen.getByText("View only — updating these checks needs planner rights on this campaign."),
    ).toBeInTheDocument();
    const dots = within(rowOf(wells, "W-1")).getAllByRole("button", { name: /Not started/ });
    expect(dots.length).toBeGreaterThan(0);
    dots.forEach((dot) => expect(dot).toBeDisabled());
    expect(puts).toHaveLength(0);
  });
});
