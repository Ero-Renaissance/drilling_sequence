import { render, screen, waitFor, within } from "@testing-library/react";
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

import type { Activity } from "@/api/activities";
import type { CatalogCheck, CatalogTeam, CheckStatus, TeamReadiness } from "@/api/readiness";
import {
  BUILTIN_PROJECT_GATES,
  BUILTIN_TEAMS,
  ReadinessCatalogProvider,
  lensChecksOf,
} from "@/components/readiness/catalog";
import { worstStatus } from "@/components/readiness/check-meta";
import { AllReadinessGrid } from "@/components/readiness/AllReadinessGrid";
import type { PrintRow } from "@/components/revisions/RevisionPrintDoc";
import { loadLensReadiness } from "@/lib/readiness-lens";
import { hasTeamReadiness, snapshotRowsForLens } from "@/lib/readiness-snapshot";
import { server } from "./mocks/server";

const PID = "cccccccc-0000-0000-0000-000000000001";
const LOGISTICS: CatalogTeam = { code: "logistics", name: "Logistics", editor_source: "team_grant", icon_key: "truck", sort_order: 20 };
const TEAMS = [...BUILTIN_TEAMS, LOGISTICS];
const check = (code: string, over: Partial<CatalogCheck> = {}): CatalogCheck => ({
  code, label: code, team_code: "logistics", applies_project: true, applies_well: true,
  status_set: "standard", icon_key: "receipt", locks_with_plan: false, sort_order: 10, ...over,
});
const PO = check("PO");
const NEQ = check("NEQ", { status_set: "availability", tag_list: "equipment", icon_key: "forklift" });
const st = (status: CheckStatus) => ({ status, notes: null, updated_at: null });

function act(id: string, over: Partial<Activity> = {}): Activity {
  return {
    id, activity_type: "Oil Development", start_date: "2026-11-01", end_date: "2027-01-01",
    well_name: "W-1", well_project: "Bonga Phase 3", rig_name: "Rig A", location: "SWAMP",
    readiness_required: true, completed_at: null, ...over,
  } as Activity;
}

function teamData(): TeamReadiness {
  return {
    team: LOGISTICS,
    checks: [PO, NEQ],
    project_rows: [],
    well_rows: [
      {
        well_project: "Bonga Phase 3", well_name: "W-1", activity_type: "Oil Development",
        activity_count: 1, location: "SWAMP", start_date: "2026-11-01", focus_start: null,
        checks: { PO: { ...st("Completed"), source: "well" }, NEQ: { ...st("Not available"), source: "default" } },
      },
    ],
    locked: false,
  };
}

beforeEach(() => {
  currentUser = { id: "u1", is_admin: false, teams: [] };
  server.use(
    http.get("/api/readiness/catalog", () =>
      HttpResponse.json({ teams: TEAMS, checks: [...BUILTIN_PROJECT_GATES, PO, NEQ], status_sets: {}, tag_items: [] }),
    ),
    http.get("/api/projects/:projectId/readiness/teams/:team", () => HttpResponse.json(teamData())),
    http.get("/api/projects/:projectId/activities", () =>
      HttpResponse.json([act("a1"), act("a2", { well_name: "W-OPT", readiness_required: false })]),
    ),
    http.get("/api/projects/:projectId/readiness", () =>
      HttpResponse.json([
        {
          well_project: "Bonga Phase 3",
          activity_count: 2,
          checks: Object.fromEntries(BUILTIN_PROJECT_GATES.map((g) => [g.code, st(g.code === "FID" ? "Behind" : "Completed")])),
        },
      ]),
    ),
  );
});

describe("worst-of summaries", () => {
  it("pick the worst severity, as the standard status of that colour", () => {
    expect(worstStatus(["Completed", "Available", "On Track"])).toBe("On Track");
    expect(worstStatus(["Completed", "Not available"])).toBe("Behind");
    expect(worstStatus(["N/A"])).toBe("N/A");
    expect(worstStatus([])).toBeUndefined();
  });

  it("the All lens has one summary check per team", () => {
    expect(lensChecksOf(BUILTIN_PROJECT_GATES, "all", TEAMS).map((c) => [c.code, c.label])).toEqual([
      ["projects", "Project gates"],
      ["logistics", "Logistics"],
    ]);
  });

  it("loads per-activity team summaries for the chart, skipping opt-outs", async () => {
    const { map, keyOf } = await loadLensReadiness(PID, "all", {
      activities: [act("a1"), act("a2", { readiness_required: false })],
      teams: TEAMS,
    });
    expect(keyOf(act("a1"))).toBe("a1");
    expect(map.get("a1")).toEqual({ projects: { status: "Behind" }, logistics: { status: "Behind" } });
    expect(map.has("a2")).toBe(false);
  });
});

describe("revision print through a lens", () => {
  const rows: PrintRow[] = [
    {
      id: "r1", activity_type: "Oil Development", start_date: "2026-11-01", end_date: "2027-01-01",
      well_name: "W-1", well_project: "Bonga Phase 3", rig_name: "Rig A", location: "SWAMP",
      plan_type: null, risk: null,
      readiness: { FDP: "Completed", FID: "On Track" },
      readiness_at_submission: { PO: { status: "Completed" }, NEQ: { status: "Not available", tags: ["RW"] } },
    },
    {
      id: "r2", activity_type: "Oil Development", start_date: "2027-02-01", end_date: "2027-03-01",
      well_name: "W-2", well_project: "Bonga Phase 3", rig_name: "Rig A", location: "SWAMP",
      plan_type: null, risk: null, readiness: { FDP: "Completed" }, readiness_at_submission: {},
    },
  ];
  const frozen = [...BUILTIN_PROJECT_GATES, PO, NEQ];

  it("keeps the project gates as stored", () => {
    expect(snapshotRowsForLens(rows, "projects", frozen, TEAMS)).toEqual(rows);
  });

  it("reads a team's statuses at submission, one strip per well", () => {
    const [r1, r2] = snapshotRowsForLens(rows, "logistics", frozen, TEAMS);
    expect(r1.readiness).toEqual({ PO: "Completed", NEQ: "Not available" });
    expect(r1.readiness_key).toBe("Bonga Phase 3\u0001W-1\u0001Oil Development");
    expect(r2.readiness_required).toBe(false); // nothing recorded → no strip
  });

  it("summarises every team per row for All", () => {
    const [r1] = snapshotRowsForLens(rows, "all", frozen, TEAMS);
    expect(r1.readiness).toEqual({ projects: "On Track", logistics: "Behind" });
    expect(r1.readiness_key).toBe("r1");
  });

  it("knows when a revision predates team readiness", () => {
    expect(hasTeamReadiness(rows)).toBe(true);
    expect(hasTeamReadiness([{ ...rows[0], readiness_at_submission: undefined }])).toBe(false);
  });
});

describe("AllReadinessGrid", () => {
  it("folds each team to its worst status, unfolds on demand, and opens a team", async () => {
    const onOpenLens = vi.fn();
    render(
      <ReadinessCatalogProvider>
        <AllReadinessGrid projectId={PID} onOpenLens={onOpenLens} />
      </ReadinessCatalogProvider>,
    );
    const w1 = (await screen.findByText("W-1")).closest("tr")!;
    expect(screen.queryByText("W-OPT")).not.toBeInTheDocument(); // opt-out
    // Logistics starts folded: one worst badge (NEQ "Not available" → Behind).
    await waitFor(() =>
      expect(within(w1).getByLabelText("Logistics: Behind (worst of 2)")).toBeInTheDocument(),
    );

    await userEvent.click(screen.getByRole("button", { name: "Unfold Logistics" }));
    expect(within(w1).getByTitle("NEQ: Not available")).toBeInTheDocument();

    const header = screen.getByRole("button", { name: "Fold Logistics" }).closest("th")!;
    await userEvent.click(within(header).getByRole("button", { name: "Open" }));
    expect(onOpenLens).toHaveBeenCalledWith("logistics");
  });
});
