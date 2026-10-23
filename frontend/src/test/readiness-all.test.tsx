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
import { barStripCodes } from "@/lib/chart-layout";
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
const NAV = check("NAV", { icon_key: "anchor", sort_order: 20 });
const st = (status: CheckStatus) => ({ status, notes: null, updated_at: null });
// A team cell as served since phase 6; `applies: false` keeps the status underneath.
const cell = (status: CheckStatus, source: "well" | "project" | "default", applies = true) => ({
  ...st(status),
  source,
  applies,
  applies_source: applies ? ("default" as const) : ("project" as const),
});

function act(id: string, over: Partial<Activity> = {}): Activity {
  return {
    id, activity_type: "Oil Development", start_date: "2026-11-01", end_date: "2027-01-01",
    well_name: "W-1", well_project: "Bonga Phase 3", rig_name: "Rig A", location: "SWAMP",
    readiness_required: true, completed_at: null, ...over,
  } as Activity;
}

// W-1: PO Completed; NAV is Behind underneath, but its field project unticked it
// — so it doesn't apply and never turns the Logistics badge red.
function teamData(navApplies = false, poApplies = true): TeamReadiness {
  return {
    team: LOGISTICS,
    checks: [PO, NAV],
    project_rows: [],
    well_rows: [
      {
        well_project: "Bonga Phase 3", well_name: "W-1", activity_type: "Oil Development",
        activity_count: 1, location: "SWAMP", start_date: "2026-11-01", focus_start: null,
        checks: { PO: cell("Completed", "well", poApplies), NAV: cell("Behind", "project", navApplies) },
      },
    ],
    locked: false,
  };
}

beforeEach(() => {
  currentUser = { id: "u1", is_admin: false, teams: [] };
  server.use(
    http.get("/api/readiness/catalog", () =>
      HttpResponse.json({ teams: TEAMS, checks: [...BUILTIN_PROJECT_GATES, PO, NAV], status_sets: {} }),
    ),
    http.get("/api/projects/:projectId/readiness/teams/:team", () => HttpResponse.json(teamData())),
    http.get("/api/projects/:projectId/activities", () =>
      HttpResponse.json([
        act("a1"),
        act("a2", { well_name: "W-OPT", readiness_required: false }),
        act("a3", { well_name: "W-DONE", completed_at: "2026-10-01T00:00:00Z" }),
      ]),
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

  it("the All lens's Project gates badge locks with the plan; other teams' badges don't", () => {
    expect(
      lensChecksOf(BUILTIN_PROJECT_GATES, "all", TEAMS).map((c) => [c.code, c.locks_with_plan]),
    ).toEqual([
      ["projects", true],
      ["logistics", false],
    ]);
  });

  it("loads per-activity team summaries for the chart, skipping opt-outs", async () => {
    const { map, keyOf } = await loadLensReadiness(PID, "all", {
      activities: [act("a1"), act("a2", { readiness_required: false })],
      teams: TEAMS,
    });
    expect(keyOf(act("a1"))).toBe("a1");
    // NAV (Behind underneath) doesn't apply: Logistics reads the worst of PO.
    expect(map.get("a1")).toMatchObject({ projects: { status: "Behind" }, logistics: { status: "Completed" } });
    expect(map.get("a1")?.logistics.applies).toBeUndefined();
    // The checks behind each badge are kept for the tooltip — the unticked one
    // marked, for its muted "Not applicable" list.
    expect(map.get("a1")?.logistics.details?.map((x) => [x.code, x.status, x.applies])).toEqual([
      ["PO", "Completed", true],
      ["NAV", "Behind", false],
    ]);
    expect(map.has("a2")).toBe(false);
  });

  it("gives no Logistics badge where none of its checks applies — gates all N/A stay grey", async () => {
    server.use(
      http.get("/api/projects/:projectId/readiness/teams/:team", () =>
        HttpResponse.json(teamData(false, false)),
      ),
      http.get("/api/projects/:projectId/readiness", () =>
        HttpResponse.json([
          {
            well_project: "Bonga Phase 3",
            activity_count: 2,
            checks: Object.fromEntries(BUILTIN_PROJECT_GATES.map((g) => [g.code, st("N/A")])),
          },
        ]),
      ),
    );
    const { map } = await loadLensReadiness(PID, "all", {
      activities: [act("a1")],
      teams: TEAMS,
      projectGates: BUILTIN_PROJECT_GATES,
    });
    const badges = map.get("a1")!;
    // Kept for the tooltip ("Nothing applies"), but marked as not applying…
    expect(badges.logistics).toMatchObject({ status: "N/A", applies: false });
    expect(badges.projects).toMatchObject({ status: "N/A" });
    // …so the bar draws the grey Project gates badge and no Logistics badge.
    const strip = lensChecksOf(BUILTIN_PROJECT_GATES, "all", TEAMS);
    expect(barStripCodes(strip, badges, true)).toEqual(["projects"]);
  });
});

describe("revision print through a lens", () => {
  const rows: PrintRow[] = [
    {
      id: "r1", activity_type: "Oil Development", start_date: "2026-11-01", end_date: "2027-01-01",
      well_name: "W-1", well_project: "Bonga Phase 3", rig_name: "Rig A", location: "SWAMP",
      plan_type: null, risk: null,
      readiness: { FDP: "Completed", FID: "On Track" },
      // NAV was unticked at submission: recorded as N/A.
      readiness_at_submission: { PO: { status: "Behind" }, NAV: { status: "N/A" } },
    },
    {
      id: "r2", activity_type: "Oil Development", start_date: "2027-02-01", end_date: "2027-03-01",
      well_name: "W-2", well_project: "Bonga Phase 3", rig_name: "Rig A", location: "SWAMP",
      plan_type: null, risk: null, readiness: { FDP: "Completed" }, readiness_at_submission: {},
    },
    {
      // Nothing applied to W-3; its gates were all N/A.
      id: "r3", activity_type: "Oil Development", start_date: "2027-04-01", end_date: "2027-05-01",
      well_name: "W-3", well_project: "Bonga Phase 3", rig_name: "Rig A", location: "SWAMP",
      plan_type: null, risk: null, readiness: { FDP: "N/A", FID: "N/A" },
      readiness_at_submission: { PO: { status: "N/A" }, NAV: { status: "N/A" } },
    },
  ];
  const frozen = [...BUILTIN_PROJECT_GATES, PO, NAV];

  it("keeps the project gates as stored", () => {
    expect(snapshotRowsForLens(rows, "projects", frozen, TEAMS)).toEqual(rows);
  });

  it("reads a team's statuses at submission, one strip per well — N/A team checks aren't drawn", () => {
    const [r1, r2, r3] = snapshotRowsForLens(rows, "logistics", frozen, TEAMS);
    expect(r1.readiness).toEqual({ PO: "Behind" });
    expect(r1.readiness_key).toBe("Bonga Phase 3\u0001W-1\u0001Oil Development");
    expect(r2.readiness_required).toBe(false); // nothing recorded → no strip
    expect(r3.readiness).toBeUndefined(); // nothing applied → no strip
    expect(r3.readiness_required).toBe(false);
  });

  it("summarises every team per row for All, from the checks that applied", () => {
    const [r1, , r3] = snapshotRowsForLens(rows, "all", frozen, TEAMS);
    expect(r1.readiness).toEqual({ projects: "On Track", logistics: "Behind" });
    expect(r1.readiness_key).toBe("r1");
    // No Logistics badge where nothing applied; all-N/A gates keep the grey badge.
    expect(r3.readiness).toEqual({ projects: "N/A" });
  });

  it("keeps the Project gates' N/A as recorded", () => {
    const [, , r3] = snapshotRowsForLens(rows, "projects", frozen, TEAMS);
    expect(r3.readiness).toEqual({ FDP: "N/A", FID: "N/A" });
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
      { wrapper: MemoryRouter },
    );
    const w1 = (await screen.findByText("W-1")).closest("tr")!;
    expect(screen.queryByText("W-OPT")).not.toBeInTheDocument(); // opt-out
    expect(screen.queryByText("W-DONE")).not.toBeInTheDocument(); // nothing left to be ready for
    // Logistics starts folded: one worst badge over the checks that apply — NAV
    // (Behind underneath, unticked) doesn't count.
    await waitFor(() =>
      expect(within(w1).getByLabelText("Logistics: All 1 done")).toBeInTheDocument(),
    );

    await userEvent.click(screen.getByRole("button", { name: "Unfold Logistics" }));
    expect(within(w1).getByTitle("PO: Completed")).toBeInTheDocument();
    // Unfolded, the unticked NAV is a muted "—" — never the Behind underneath.
    expect(within(w1).getByTitle("NAV: Not applicable")).toHaveTextContent("—");
    expect(within(w1).queryByTitle("NAV: Behind")).not.toBeInTheDocument();

    const header = screen.getByRole("button", { name: "Fold Logistics" }).closest("th")!;
    await userEvent.click(within(header).getByRole("button", { name: "Open" }));
    expect(onOpenLens).toHaveBeenCalledWith("logistics");
  });

  it("a folded team where nothing applies reads '—', not a badge", async () => {
    server.use(
      http.get("/api/projects/:projectId/readiness/teams/:team", () =>
        HttpResponse.json(teamData(false, false)),
      ),
    );
    render(
      <ReadinessCatalogProvider>
        <AllReadinessGrid projectId={PID} onOpenLens={vi.fn()} />
      </ReadinessCatalogProvider>,
      { wrapper: MemoryRouter },
    );
    const w1 = (await screen.findByText("W-1")).closest("tr")!;
    // The Project gates (unfolded for this user) are drawn; Logistics, folded,
    // has no badge — just the muted dash.
    await waitFor(() => expect(within(w1).getByTitle("Final Inv. Decision: Behind")).toBeInTheDocument());
    expect(within(w1).queryByLabelText(/^Logistics:/)).not.toBeInTheDocument();
    expect(within(w1).getByTitle("Logistics: Nothing applies")).toHaveTextContent("—");
  });
});
