import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
import { ReadinessTab } from "@/pages/ProjectDetail";
import { server } from "./mocks/server";
import { mockGateTeam } from "./mocks/handlers";

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

function gateData(status: CheckStatus = "Completed", fid: CheckStatus = "Behind") {
  return mockGateTeam({
    wells: [{ well_project: "Bonga Phase 3", well_name: "W-1" }],
    status,
    projectStatuses: { "Bonga Phase 3": { FID: fid } },
  });
}

beforeEach(() => {
  currentUser = { id: "u1", is_admin: false, teams: [] };
  server.use(
    http.get("/api/readiness/catalog", () =>
      HttpResponse.json({ teams: TEAMS, checks: [...BUILTIN_PROJECT_GATES, PO, NAV], status_sets: {} }),
    ),
    // The well execution readiness checks, per well (phase 8): W-1 follows
    // Bonga Phase 3 — FID Behind, everything else Completed.
    http.get("/api/projects/:projectId/readiness/teams/projects", () => HttpResponse.json(gateData())),
    http.get("/api/projects/:projectId/readiness/teams/:team", () => HttpResponse.json(teamData())),
    http.get("/api/projects/:projectId/activities", () =>
      HttpResponse.json([
        act("a1"),
        act("a2", { well_name: "W-OPT", readiness_required: false }),
        act("a3", { well_name: "W-DONE", completed_at: "2026-10-01T00:00:00Z" }),
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
      ["projects", "Well Execution Readiness"],
      ["logistics", "Logistics Execution Readiness"],
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
      http.get("/api/projects/:projectId/readiness/teams/projects", () =>
        HttpResponse.json(gateData("N/A", "N/A")),
      ),
      http.get("/api/projects/:projectId/readiness/teams/:team", () =>
        HttpResponse.json(teamData(false, false)),
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

  it("a per-well snapshot prints one strip per well, and keeps a projectless well's checks", () => {
    // Phase 8: the snapshot recorded each WELL's own checks (`readiness_scope`).
    const perWell: PrintRow[] = [
      { ...rows[0], readiness_scope: "well", readiness: { FDP: "Completed", FID: "Behind" } },
      { ...rows[1], readiness_scope: "well", readiness: { FDP: "Completed", FID: "Completed" } },
      { ...rows[2], id: "r4", well_name: "LONE", well_project: null, readiness_scope: "well",
        readiness: { FDP: "Not started" }, readiness_at_submission: {} },
    ];
    const [w1, w2, lone] = snapshotRowsForLens(perWell, "projects", frozen, TEAMS);
    // Two wells of one field project each print their own strip…
    expect(w1.readiness_key).toBe("Bonga Phase 3\u0001W-1\u0001Oil Development");
    expect(w2.readiness_key).toBe("Bonga Phase 3\u0001W-2\u0001Oil Development");
    expect(w1.readiness_key).not.toBe(w2.readiness_key);
    expect(lone.readiness_key).toBe("\u0001LONE\u0001Oil Development");
    // …while an older, per-project snapshot keeps its one strip per project.
    expect(snapshotRowsForLens(rows, "projects", frozen, TEAMS)[0].readiness_key).toBeUndefined();

    // All lens: the projectless well keeps its Well Execution Readiness badge.
    const all = snapshotRowsForLens(perWell, "all", frozen, TEAMS);
    expect(all[2].readiness).toEqual({ projects: "Not started" });
    // An older snapshot's stored defaults for a projectless well are still ignored.
    const old = snapshotRowsForLens(
      [{ ...perWell[2], readiness_scope: undefined, readiness: { FDP: "On Track" } }], "all", frozen, TEAMS,
    );
    expect(old[0].readiness).toBeUndefined();
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
      expect(within(w1).getByLabelText("Logistics Execution Readiness: All 1 done")).toBeInTheDocument(),
    );

    await userEvent.click(screen.getByRole("button", { name: "Unfold Logistics Execution Readiness" }));
    expect(within(w1).getByTitle("PO: Completed")).toBeInTheDocument();
    // Unfolded, the unticked NAV is a muted "—" — never the Behind underneath.
    expect(within(w1).getByTitle("NAV: Not applicable")).toHaveTextContent("—");
    expect(within(w1).queryByTitle("NAV: Behind")).not.toBeInTheDocument();

    const header = screen.getByRole("button", { name: "Fold Logistics Execution Readiness" }).closest("th")!;
    await userEvent.click(within(header).getByRole("button", { name: "Open" }));
    expect(onOpenLens).toHaveBeenCalledWith("logistics");
  });

  it("has the Value stream filter every team's page has", async () => {
    server.use(
      http.get("/api/projects/:projectId/activities", () =>
        HttpResponse.json([
          act("a1", { market: "Oil" } as Partial<Activity>),
          act("a4", { well_name: "W-GAS", market: "Domestic Gas" } as Partial<Activity>),
          act("a5", { well_name: "W-NONE", market: null } as Partial<Activity>),
        ]),
      ),
    );
    render(
      <ReadinessCatalogProvider>
        <AllReadinessGrid projectId={PID} onOpenLens={vi.fn()} />
      </ReadinessCatalogProvider>,
      { wrapper: MemoryRouter },
    );
    await screen.findByText("W-1");
    const select = screen.getByLabelText("Value stream");
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "All value streams",
      "Domestic Gas",
      "Oil",
      "No value stream",
    ]);
    await userEvent.selectOptions(select, "Domestic Gas");
    expect(screen.getByText("W-GAS")).toBeInTheDocument();
    expect(screen.queryByText("W-1")).not.toBeInTheDocument();
    expect(screen.queryByText("W-NONE")).not.toBeInTheDocument();
    await userEvent.selectOptions(select, "");
    expect(screen.getByText("W-1")).toBeInTheDocument();
  });

  it("a chosen stream that disappears on reload stops filtering", async () => {
    let cleared = false;
    server.use(
      http.get("/api/projects/:projectId/activities", () =>
        HttpResponse.json([
          act("a1", { market: cleared ? null : "Oil" } as Partial<Activity>),
          act("a4", { well_name: "W-GAS", market: cleared ? null : "Domestic Gas" } as Partial<Activity>),
        ]),
      ),
    );
    render(
      <ReadinessCatalogProvider>
        <AllReadinessGrid projectId={PID} onOpenLens={vi.fn()} />
      </ReadinessCatalogProvider>,
      { wrapper: MemoryRouter },
    );
    await screen.findByText("W-1");
    await userEvent.selectOptions(screen.getByLabelText("Value stream"), "Domestic Gas");
    expect(screen.queryByText("W-1")).not.toBeInTheDocument();
    // The Market is cleared on every well and the grid reloads: the selector
    // goes, and the wells must come back — not an empty grid with no way out.
    cleared = true;
    const refresh = screen.getAllByRole("button").find((b) => b.querySelector("svg.lucide-refresh-cw"))!;
    await userEvent.click(refresh);
    await waitFor(() => expect(screen.queryByLabelText("Value stream")).not.toBeInTheDocument());
    expect(screen.getByText("W-1")).toBeInTheDocument();
    expect(screen.getByText("W-GAS")).toBeInTheDocument();
  });

  it("no Value stream filter when no well names one", async () => {
    render(
      <ReadinessCatalogProvider>
        <AllReadinessGrid projectId={PID} onOpenLens={vi.fn()} />
      </ReadinessCatalogProvider>,
      { wrapper: MemoryRouter },
    );
    await screen.findByText("W-1");
    expect(screen.queryByLabelText("Value stream")).not.toBeInTheDocument();
  });

  it("a folded team where nothing applies reads '—', not a badge", async () => {
    server.use(
      http.get("/api/projects/:projectId/readiness/teams/projects", () => HttpResponse.json(gateData())),
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
    await waitFor(() => expect(within(w1).getByTitle(/^Final Investment Decision: Behind/)).toBeInTheDocument());
    // Logistics comes with the live catalog and its team rows: wait for it.
    expect(await within(w1).findByTitle("Logistics Execution Readiness: Nothing applies")).toHaveTextContent("—");
    expect(within(w1).queryByLabelText(/^Logistics Execution Readiness:/)).not.toBeInTheDocument();
  });
});

describe("ReadinessTab — one sheet for every team", () => {
  // The tab remembers its lens per browser.
  afterEach(() => window.localStorage.removeItem("ds.readiness-lens"));

  function LocationProbe() {
    return <output data-testid="location">{useLocation().search}</output>;
  }

  it("the All grid's Open lands on the team's sheet; a lens change keeps the years and drops the rest", async () => {
    render(
      <MemoryRouter initialEntries={[`/projects/${PID}/readiness?lens=all&years=2&view=wells&project=Bonga`]}>
        <Routes>
          <Route
            path="/projects/:projectId/readiness"
            element={
              <ReadinessCatalogProvider>
                <ReadinessTab />
                <LocationProbe />
              </ReadinessCatalogProvider>
            }
          />
        </Routes>
      </MemoryRouter>,
    );
    // Open shows the team's page — the same sheet as every team's.
    await userEvent.click(await screen.findByRole("button", { name: "Unfold Logistics Execution Readiness" }));
    const header = screen.getByRole("button", { name: "Fold Logistics Execution Readiness" }).closest("th")!;
    await userEvent.click(within(header).getByRole("button", { name: "Open" }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("lens=logistics"));
    // No Projects | Wells switch on a team's page any more.
    expect(screen.queryByRole("radiogroup", { name: "Show" })).not.toBeInTheDocument();
    // The years stay; a view or project narrowing from an old link is dropped.
    const query = screen.getByTestId("location").textContent ?? "";
    expect(query).toContain("years=2");
    expect(query).not.toContain("view=");
    expect(query).not.toContain("project=");

    // The built-in team's page is the same sheet.
    await userEvent.click(screen.getByRole("radio", { name: "Well Execution Readiness" }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("lens=projects"));
  });
});
