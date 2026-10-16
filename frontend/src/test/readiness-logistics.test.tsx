import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { http, HttpResponse } from "msw";

vi.mock("@/lib/auth", () => ({
  getAccessToken: async () => "test-token",
  msalInstance: { getAllAccounts: () => [], logoutRedirect: vi.fn() },
  loginRequest: {},
}));

type TestUser = { id: string; is_admin: boolean; teams?: string[] };
let currentUser: TestUser | null = null;
vi.mock("@/store/auth", () => ({
  useAuthStore: (selector: (s: { user: TestUser | null }) => unknown) =>
    selector({ user: currentUser }),
}));

import type { CatalogCheck, CheckStatus, TagItem, TeamReadiness } from "@/api/readiness";
import {
  BUILTIN_PROJECT_GATES,
  BUILTIN_TEAMS,
  ReadinessCatalogProvider,
} from "@/components/readiness/catalog";
import { ReadinessDot } from "@/components/readiness/ReadinessDot";
import { TeamReadinessGrid } from "@/components/readiness/TeamReadinessGrid";
import { FrozenCatalogProvider } from "@/components/readiness/catalog";
import {
  STATUS_SEVERITY,
  STATUS_SETS,
  defaultStatusOf,
  legendStatuses,
  statusesOf,
} from "@/components/readiness/check-meta";
import { worstCheck } from "@/lib/chart-layout";
import { server } from "./mocks/server";

const PID = "cccccccc-0000-0000-0000-000000000001";

const NEQ: CatalogCheck = {
  code: "NEQ",
  label: "Nominated Equipment",
  team_code: "logistics",
  applies_project: true,
  applies_well: true,
  status_set: "availability",
  icon_key: "forklift",
  locks_with_plan: false,
  sort_order: 30,
  tag_list: "equipment",
};

const EQUIPMENT: TagItem[] = [
  { tag_list: "equipment", code: "RW", label: "Rotary Wing Aircraft / Helicopter", category: "Aviation", sort_order: 10 },
  { tag_list: "equipment", code: "DSV", label: "Diving Support Vessel", category: "Vessels", sort_order: 20 },
  { tag_list: "equipment", code: "PSV", label: "Platform Support Vessel", category: "Vessels", sort_order: 60 },
];

const st = (status: CheckStatus, tags: string[] = []) => ({ status, notes: null, updated_at: null, tags });

function teamData(): TeamReadiness {
  return {
    team: { code: "logistics", name: "Logistics", editor_source: "team_grant", icon_key: "truck", sort_order: 20 },
    checks: [NEQ],
    project_rows: [
      {
        well_project: "Bonga Phase 3",
        activity_count: 2,
        checks: { NEQ: st("Available", ["RW"]) },
        focus_start: "2026-11-01",
      },
    ],
    well_rows: [
      {
        well_project: "Bonga Phase 3",
        well_name: "W-1",
        activity_type: "Oil Development",
        activity_count: 1,
        location: "SWAMP",
        start_date: "2026-11-01",
        focus_start: "2026-11-01",
        checks: { NEQ: { ...st("Not available", ["DSV"]), source: "well", inherited_tags: ["RW"] } },
      },
    ],
    locked: false,
  };
}

beforeEach(() => {
  currentUser = { id: "u1", is_admin: false, teams: ["logistics"] };
  server.use(
    http.get("/api/readiness/catalog", () =>
      HttpResponse.json({
        teams: [...BUILTIN_TEAMS],
        checks: [...BUILTIN_PROJECT_GATES, NEQ],
        status_sets: {},
        tag_items: EQUIPMENT,
      }),
    ),
    http.get("/api/projects/:projectId/readiness/teams/:team", () => HttpResponse.json(teamData())),
  );
});

describe("status sets", () => {
  it("availability reads like done / on track / blocked and is the NEQ picker's choice", () => {
    expect(STATUS_SETS.availability.statuses).toEqual(["Pending", "Available", "Not available"]);
    expect(
      [STATUS_SEVERITY.Pending, STATUS_SEVERITY.Available, STATUS_SEVERITY["Not available"]],
    ).toEqual(["in_progress", "done", "blocked"]);
    expect(statusesOf("availability")).toEqual(["Pending", "Available", "Not available"]);
    expect(statusesOf("unknown")).toEqual(STATUS_SETS.standard.statuses);
    expect(legendStatuses([{ status_set: "standard" }, { status_set: "availability" }])).toEqual([
      "On Track", "Behind", "Completed", "N/A", "Pending", "Available", "Not available",
    ]);
  });

  it("every default is on track — an unset check means no reported problem", () => {
    for (const set of Object.values(STATUS_SETS)) {
      expect(STATUS_SEVERITY[set.default]).toBe("in_progress");
    }
    expect(defaultStatusOf("availability")).toBe("Pending");
  });

  it("ranks Not available as the worst, like Behind", () => {
    expect(
      worstCheck({ FDP: { status: "Completed" }, NEQ: { status: "Not available" } }, ["FDP", "NEQ"]),
    ).toEqual({ code: "NEQ", status: "Not available" });
  });

  it("an availability check's dot offers Pending / Available / Not available", async () => {
    render(
      <FrozenCatalogProvider checks={[NEQ]}>
        <ReadinessDot code="NEQ" status="Not available" onChange={vi.fn()} />
      </FrozenCatalogProvider>,
    );
    await userEvent.click(screen.getByTitle("Nominated Equipment: Not available"));
    const items = await screen.findAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual(["Pending", "Available", "Not available"]);
  });
});

describe("Nominated Equipment", () => {
  it("shows effective tags and saves the well's own tags + status", async () => {
    let body: Record<string, unknown> | null = null;
    server.use(
      http.put("/api/projects/:projectId/readiness/:checkCode", async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({});
      }),
    );
    render(
      <ReadinessCatalogProvider>
        <TeamReadinessGrid projectId={PID} teamCode="logistics" />
      </ReadinessCatalogProvider>,
      { wrapper: MemoryRouter },
    );
    const wells = await screen.findByRole("region", { name: "Wells" });
    // Effective = the project's RW + the well's own DSV.
    const cell = within(wells).getByTitle("Nominated Equipment: Not available — RW, DSV");
    expect(within(cell).getByText("RW · DSV")).toBeInTheDocument();

    await userEvent.click(cell);
    const dialog = await screen.findByRole("dialog");
    // RW comes from the field project — shown, not editable on the well.
    expect(within(dialog).getByText("From field project")).toBeInTheDocument();
    expect(within(dialog).getByRole("checkbox", { name: /RW/ })).toBeDisabled();
    await userEvent.click(within(dialog).getByText("Available"));
    await userEvent.click(within(dialog).getByRole("checkbox", { name: /PSV/ }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(body).toMatchObject({
        scope: "well",
        well_name: "W-1",
        status: "Available",
        tags: ["DSV", "PSV"],
      }),
    );
  });

  it("offers Reset to project for a well with its own value", async () => {
    let reset = false;
    server.use(
      http.post("/api/projects/:projectId/readiness/:checkCode/reset", () => {
        reset = true;
        return HttpResponse.json({ status: "Available", source: "project" });
      }),
    );
    render(
      <ReadinessCatalogProvider>
        <TeamReadinessGrid projectId={PID} teamCode="logistics" />
      </ReadinessCatalogProvider>,
      { wrapper: MemoryRouter },
    );
    const wells = await screen.findByRole("region", { name: "Wells" });
    await userEvent.click(within(wells).getByTitle(/Nominated Equipment: Not available/));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: /reset to project/i }));
    await waitFor(() => expect(reset).toBe(true));
  });
});
