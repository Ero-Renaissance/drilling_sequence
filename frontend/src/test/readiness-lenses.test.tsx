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
  defaultLens,
  lensChecksOf,
} from "@/components/readiness/catalog";
import { LensPicker } from "@/components/readiness/LensPicker";
import { TeamReadinessGrid } from "@/components/readiness/TeamReadinessGrid";
import { WorkingCopyPrintDoc } from "@/components/revisions/RevisionPrintDoc";
import { activitiesToChartData } from "@/lib/chart-utils";
import { gridCols, iconTier } from "@/lib/chart-layout";
import { loadLensReadiness, wellKeyOf } from "@/lib/readiness-lens";
import { server } from "./mocks/server";

const PID = "cccccccc-0000-0000-0000-000000000001";

const LOGISTICS: CatalogTeam = {
  code: "logistics",
  name: "Logistics",
  editor_source: "team_grant",
  icon_key: "banknote",
  sort_order: 20,
};
const WELLS: CatalogTeam = { ...LOGISTICS, code: "wells", name: "Wells", icon_key: "map-pin", sort_order: 10 };

function check(over: Partial<CatalogCheck>): CatalogCheck {
  return {
    code: "X",
    label: "X",
    team_code: "logistics",
    applies_project: true,
    applies_well: true,
    status_set: "standard",
    icon_key: "banknote",
    locks_with_plan: false,
    sort_order: 10,
    ...over,
  };
}
const LBUD = check({ code: "L-BUD", label: "Budget Availability" });
const CTS = check({ code: "CTS", label: "Community Trust", applies_well: false, sort_order: 20 });

// A team cell as served since phase 6: every check here applies by default.
const st = (status: CheckStatus) => ({
  status,
  notes: null,
  updated_at: null,
  applies: true,
  applies_source: "default" as const,
});

function teamData(over: Partial<TeamReadiness> = {}): TeamReadiness {
  return {
    team: LOGISTICS,
    checks: [LBUD, CTS],
    project_rows: [
      {
        well_project: "Bonga Phase 3",
        activity_count: 3,
        checks: { "L-BUD": st("Completed"), CTS: st("On Track") },
        focus_start: "2026-01-01",
      },
    ],
    well_rows: [
      {
        well_project: "Bonga Phase 3",
        well_name: "W-1",
        activity_type: "Oil Development",
        activity_count: 1,
        location: "OFFSHORE",
        start_date: "2026-01-01",
        focus_start: "2026-01-01",
        checks: {
          "L-BUD": { ...st("Completed"), source: "project" },
          CTS: { ...st("On Track"), source: "default" },
        },
      },
      {
        well_project: "Bonga Phase 3",
        well_name: "W-2",
        activity_type: "Oil Development",
        activity_count: 2,
        location: "OFFSHORE",
        start_date: "2026-04-01",
        focus_start: "2026-04-01",
        checks: {
          "L-BUD": { ...st("Behind"), source: "well" },
          CTS: { ...st("On Track"), source: "default" },
        },
      },
    ],
    locked: false,
    ...over,
  };
}

function serveTeam(data: TeamReadiness) {
  server.use(http.get("/api/projects/:projectId/readiness/teams/:team", () => HttpResponse.json(data)));
}

function act(id: string, over: Partial<Activity>): Activity {
  return {
    id,
    activity_type: "Oil Development",
    start_date: "2026-01-01",
    end_date: "2026-03-01",
    well_name: "W-1",
    well_project: "Bonga Phase 3",
    rig_name: "Rig Alpha",
    location: "OFFSHORE",
    readiness_required: true,
    completed_at: null,
    ...over,
  } as Activity;
}

beforeEach(() => {
  currentUser = { id: "u1", is_admin: false, teams: ["logistics"] };
});

// ── Pure lens logic ──────────────────────────────────────────────────────────

describe("lenses", () => {
  it("pick each team's checks; the project gates for the built-in team; none for 'none'", () => {
    const all = [...BUILTIN_PROJECT_GATES, CTS, LBUD];
    expect(lensChecksOf(all, "projects").map((c) => c.code)).toEqual(
      BUILTIN_PROJECT_GATES.map((c) => c.code),
    );
    expect(lensChecksOf(all, "logistics").map((c) => c.code)).toEqual(["L-BUD", "CTS"]);
    expect(lensChecksOf(all, "none")).toEqual([]);
  });

  it("default to the user's own team (first in team order), else the project gates", () => {
    const teams = [...BUILTIN_TEAMS, WELLS, LOGISTICS];
    expect(defaultLens(teams, ["logistics", "wells"])).toBe("wells");
    expect(defaultLens(teams, ["logistics"])).toBe("logistics");
    expect(defaultLens(teams, [])).toBe("projects");
    expect(defaultLens(teams, undefined)).toBe("projects");
  });

  it("size the chart strip by the lens's icon count (7 keeps the tuned cutoffs)", () => {
    expect([iconTier(135, 7), iconTier(134, 7), iconTier(90, 7), iconTier(45, 7), iconTier(44, 7)]).toEqual([
      "full",
      "half",
      "half",
      "grid",
      "single",
    ]);
    expect(iconTier(71, 3)).toBe("full");
    expect(iconTier(70, 3)).toBe("half");
    expect(gridCols(7)).toBe(4);
    expect(gridCols(3)).toBe(2);
  });

  it("anchor one strip per WELL under a well-level lens, one per project otherwise", () => {
    const acts = [act("a1", {}), act("a2", { well_name: "W-2", start_date: "2026-04-01" })];
    const byWell = new Map(
      acts.map((a) => [wellKeyOf(a)!, { "L-BUD": { status: "Completed" as const } }]),
    );
    const wellRoles = activitiesToChartData(acts, byWell, wellKeyOf).data.map((d) => d.readinessRole);
    expect(wellRoles).toEqual(["anchor", "anchor"]);

    const byProject = new Map([["Bonga Phase 3", { FDP: { status: "Completed" as const } }]]);
    const projectRoles = activitiesToChartData(acts, byProject).data.map((d) => d.readinessRole);
    expect(projectRoles).toEqual(["anchor", "sibling"]);
  });

  it("load a team with well-level checks keyed by well, with inherited values", async () => {
    serveTeam(teamData());
    const { map, keyOf } = await loadLensReadiness(PID, "logistics");
    const w1 = map.get(keyOf(act("a1", {}))!);
    expect(w1?.["L-BUD"].status).toBe("Completed");
    expect(keyOf(act("x", { well_name: null }))).toBeNull();
  });
});

// ── LensPicker ───────────────────────────────────────────────────────────────

describe("LensPicker", () => {
  it("stays hidden while the project gates are the only team", () => {
    render(<LensPicker value="projects" onChange={vi.fn()} />);
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
  });

  it("lists every active team once the catalog has more than one", async () => {
    server.use(
      http.get("/api/readiness/catalog", () =>
        HttpResponse.json({ teams: [...BUILTIN_TEAMS, LOGISTICS], checks: [...BUILTIN_PROJECT_GATES, LBUD], status_sets: {} }),
      ),
    );
    const onChange = vi.fn();
    render(
      <ReadinessCatalogProvider>
        <LensPicker value="projects" onChange={onChange} />
      </ReadinessCatalogProvider>,
    );
    const logistics = await screen.findByRole("radio", { name: /logistics/i });
    expect(screen.getByRole("radio", { name: /project gates/i })).toHaveAttribute("aria-checked", "true");
    await userEvent.click(logistics);
    expect(onChange).toHaveBeenCalledWith("logistics");
  });
});

// ── TeamReadinessGrid ────────────────────────────────────────────────────────

describe("TeamReadinessGrid", () => {
  it("shows field-project and well rows, inherited values, and shared-key warnings", async () => {
    serveTeam(teamData());
    render(<TeamReadinessGrid projectId={PID} teamCode="logistics" />, { wrapper: MemoryRouter });
    const projects = await screen.findByRole("region", { name: "Field projects" });
    expect(within(projects).getByText("Bonga Phase 3")).toBeInTheDocument();

    const wells = screen.getByRole("region", { name: "Wells" });
    const w1 = within(wells).getByText("W-1").closest("tr")!;
    // W-1 follows its field project: faded and labelled.
    expect(within(w1).getByTitle(/Budget Availability: Completed \(from field project\)/)).toBeInTheDocument();
    // W-2 is shared by two activities — the grid warns.
    const w2 = within(wells).getByText("W-2").closest("tr")!;
    expect(within(w2).getByText("2 share")).toBeInTheDocument();
  });

  it("writes a well's own value through the well target", async () => {
    serveTeam(teamData());
    let body: unknown = null;
    server.use(
      http.put("/api/projects/:projectId/readiness/:checkCode", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({});
      }),
    );
    render(<TeamReadinessGrid projectId={PID} teamCode="logistics" />, { wrapper: MemoryRouter });
    const wells = await screen.findByRole("region", { name: "Wells" });
    const w1 = within(wells).getByText("W-1").closest("tr")!;
    await userEvent.click(within(w1).getByTitle(/Budget Availability/));
    await userEvent.click(await screen.findByRole("menuitem", { name: /Behind/ }));
    await waitFor(() =>
      expect(body).toEqual({
        scope: "well",
        well_project: "Bonga Phase 3",
        well_name: "W-1",
        activity_type: "Oil Development",
        status: "Behind",
        notes: null,
      }),
    );
  });

  it("offers Reset to project on an overridden two-level check", async () => {
    serveTeam(teamData());
    let reset: unknown = null;
    server.use(
      http.post("/api/projects/:projectId/readiness/:checkCode/reset", async ({ request, params }) => {
        reset = { code: params.checkCode, ...(await request.json() as object) };
        return HttpResponse.json({ status: "Completed", source: "project" });
      }),
    );
    render(<TeamReadinessGrid projectId={PID} teamCode="logistics" />, { wrapper: MemoryRouter });
    const wells = await screen.findByRole("region", { name: "Wells" });
    const w2 = within(wells).getByText("W-2").closest("tr")!;
    await userEvent.click(within(w2).getByTitle(/Budget Availability: Behind$/));
    await userEvent.click(await screen.findByRole("menuitem", { name: /reset to project/i }));
    await waitFor(() => expect(reset).toMatchObject({ code: "L-BUD", well_name: "W-2", scope: "well" }));

    // W-1 follows the project already — no reset offered.
    const w1 = within(wells).getByText("W-1").closest("tr")!;
    await userEvent.click(within(w1).getByTitle(/Budget Availability/));
    expect(screen.queryByRole("menuitem", { name: /reset to project/i })).not.toBeInTheDocument();
  });

  it("is view-only without the team's grant", async () => {
    currentUser = { id: "u2", is_admin: false, teams: ["wells"] };
    serveTeam(teamData());
    render(<TeamReadinessGrid projectId={PID} teamCode="logistics" />, { wrapper: MemoryRouter });
    expect(await screen.findByText(/View only — updating Logistics readiness needs/)).toBeInTheDocument();
    const wells = screen.getByRole("region", { name: "Wells" });
    // Every status dot is disabled; only Checks… opens — to read the ticks.
    const buttons = within(wells).getAllByRole("button");
    const pickers = buttons.filter((b) => /^Checks…/.test(b.textContent ?? ""));
    expect(pickers).toHaveLength(2);
    for (const button of buttons.filter((b) => !pickers.includes(b))) {
      expect(button).toBeDisabled();
    }
    await userEvent.click(pickers[0]);
    const dialog = await screen.findByRole("dialog", { name: "Logistics checks that apply" });
    for (const box of within(dialog).getAllByRole("checkbox")) expect(box).toBeDisabled();
    expect(within(dialog).queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });

  it("lists wells with work left in the window and sums exactly those (spec §3.7)", async () => {
    const soon = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
    const far = new Date(Date.now() + 600 * 86_400_000).toISOString().slice(0, 10);
    const base = teamData().well_rows[0];
    serveTeam(
      teamData({
        well_rows: [
          {
            ...base, well_name: "W-SOON", focus_start: soon,
            figures: { counted: 2, done: 1, in_progress: 1, behind: 0, ready: false },
          },
          {
            ...base, well_name: "W-FAR", focus_start: far,
            figures: { counted: 2, done: 0, in_progress: 1, behind: 1, ready: false },
          },
          {
            ...base, well_name: "W-DONE", focus_start: null, // completed: nothing left
            figures: { counted: 2, done: 2, in_progress: 0, behind: 0, ready: true },
          },
        ],
      }),
    );
    render(
      <MemoryRouter initialEntries={["/?lens=logistics&horizon=12"]}>
        <TeamReadinessGrid projectId={PID} teamCode="logistics" />
      </MemoryRouter>,
    );
    const wells = await screen.findByRole("region", { name: "Wells" });
    // Arriving from the Logistics tile: its 12-month window.
    expect(within(wells).getByText("W-SOON")).toBeInTheDocument();
    expect(within(wells).queryByText("W-FAR")).not.toBeInTheDocument();
    expect(within(wells).queryByText("W-DONE")).not.toBeInTheDocument();
    const summary = screen.getByTestId("readiness-summary");
    expect(summary).toHaveTextContent("50%complete");
    expect(summary).toHaveTextContent("100%on track");
    expect(summary).toHaveTextContent("1 well · next 12 months");

    // All: the far well joins; the completed one never does.
    await userEvent.selectOptions(screen.getByLabelText("Readiness time window"), "0");
    await waitFor(() => expect(within(wells).getByText("W-FAR")).toBeInTheDocument());
    expect(within(wells).queryByText("W-DONE")).not.toBeInTheDocument();
    expect(summary).toHaveTextContent("25%complete");
    expect(summary).toHaveTextContent("1behind");
    expect(summary).toHaveTextContent("2 wells · all");
  });

  it("?focus=behind shows only the wells with a check behind", async () => {
    const base = teamData().well_rows[0];
    serveTeam(
      teamData({
        well_rows: [
          { ...base, well_name: "W-OK", figures: { counted: 2, done: 2, in_progress: 0, behind: 0, ready: true } },
          { ...base, well_name: "W-LATE", figures: { counted: 2, done: 1, in_progress: 0, behind: 1, ready: false } },
        ],
      }),
    );
    render(
      <MemoryRouter initialEntries={["/?lens=logistics&focus=behind"]}>
        <TeamReadinessGrid projectId={PID} teamCode="logistics" />
      </MemoryRouter>,
    );
    const wells = await screen.findByRole("region", { name: "Wells" });
    expect(within(wells).getByText("W-LATE")).toBeInTheDocument();
    expect(within(wells).queryByText("W-OK")).not.toBeInTheDocument();
    // Worded as on the Project gates page: how many are shown, and why.
    expect(screen.getByText(/shown — wells with a check behind/)).toHaveTextContent("1 shown — wells with a check behind");
    expect(screen.getByTestId("readiness-summary")).toHaveTextContent("1 well · all");

    await userEvent.click(screen.getByRole("button", { name: /clear filter/i }));
    await waitFor(() => expect(within(wells).getByText("W-OK")).toBeInTheDocument());
  });

  it("has the Project gates page's toolbar: its title, Refresh, the window, search and a count", async () => {
    serveTeam(teamData());
    render(
      <MemoryRouter>
        <TeamReadinessGrid projectId={PID} teamCode="logistics" />
      </MemoryRouter>,
    );
    await screen.findByRole("region", { name: "Wells" });
    expect(screen.getByText("Readiness Tracker")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /refresh/i })).toBeInTheDocument();
    expect(screen.getByTestId("readiness-count")).toHaveTextContent("2 wells");
    await userEvent.type(screen.getByLabelText("Search wells and field projects"), "W-2");
    expect(screen.getByTestId("readiness-count")).toHaveTextContent("1 of 2");
  });

  it("says how many a window shows, and clears it, as the Project gates page does", async () => {
    const base = teamData().well_rows[0];
    serveTeam(
      teamData({
        well_rows: [
          { ...base, well_name: "W-SOON", focus_in_days: 10 },
          { ...base, well_name: "W-LATER", focus_in_days: 400 },
        ],
      }),
    );
    render(
      <MemoryRouter initialEntries={["/?lens=logistics&horizon=6"]}>
        <TeamReadinessGrid projectId={PID} teamCode="logistics" />
      </MemoryRouter>,
    );
    const wells = await screen.findByRole("region", { name: "Wells" });
    expect(within(wells).getByText("W-SOON")).toBeInTheDocument();
    expect(within(wells).queryByText("W-LATER")).not.toBeInTheDocument();
    expect(screen.getByText(/shown — wells with/)).toHaveTextContent(
      "1 shown — wells with readiness-required work starting in the next 6 months",
    );
    await userEvent.click(screen.getByRole("button", { name: /clear filter/i }));
    await waitFor(() => expect(within(wells).getByText("W-LATER")).toBeInTheDocument());
    expect(screen.queryByText(/shown — wells with/)).not.toBeInTheDocument();
  });

  it("shows each row's Done figure from the server's figures, as the Project gates page does", async () => {
    const data = teamData();
    data.project_rows[0].figures = { counted: 2, done: 1, in_progress: 1, behind: 0, ready: false };
    data.well_rows[0].figures = { counted: 2, done: 2, in_progress: 0, behind: 0, ready: true };
    data.well_rows[1].figures = { counted: 0, done: 0, in_progress: 0, behind: 0, ready: false };
    serveTeam(data);
    render(
      <MemoryRouter>
        <TeamReadinessGrid projectId={PID} teamCode="logistics" />
      </MemoryRouter>,
    );
    const wells = await screen.findByRole("region", { name: "Wells" });
    const projects = screen.getByRole("region", { name: "Field projects" });
    const doneOf = (region: HTMLElement, name: string) =>
      within(region).getByText(name).closest("tr")!.querySelector<HTMLElement>("[data-done]")!;
    expect(doneOf(projects, "Bonga Phase 3")).toHaveTextContent("1/2");
    expect(doneOf(wells, "W-1")).toHaveTextContent("2/2");
    // Ready reads green, as on the Project gates page.
    expect(doneOf(wells, "W-1").firstElementChild!.className).toContain("text-emerald-500");
    // Nothing counts there: "—", and the hover says why.
    expect(doneOf(wells, "W-2")).toHaveTextContent("—");
    expect(doneOf(wells, "W-2").firstElementChild).toHaveAttribute("title", "Nothing applies");
  });

  it("explains an empty team", async () => {
    serveTeam(teamData({ checks: [], project_rows: [], well_rows: [] }));
    render(<TeamReadinessGrid projectId={PID} teamCode="logistics" />, { wrapper: MemoryRouter });
    expect(await screen.findByText(/No Logistics checks defined yet/)).toBeInTheDocument();
  });
});

// ── Printing by lens ─────────────────────────────────────────────────────────

describe("working-copy print", () => {
  it("states which lens its readiness icons show", () => {
    render(
      <WorkingCopyPrintDoc
        project={null}
        rows={[]}
        chart="readiness"
        asOf={new Date("2026-10-13T09:00:00")}
        readinessLabel="Logistics"
      />,
    );
    expect(screen.getByTestId("print-readiness-lens")).toHaveTextContent("Readiness: Logistics — live status");
  });
});
