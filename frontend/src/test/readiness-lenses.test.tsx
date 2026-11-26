import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
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
import { ReadinessSheet } from "@/components/readiness/ReadinessSheet";
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
    expect(screen.getByRole("radio", { name: /well execution readiness/i })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await userEvent.click(logistics);
    expect(onChange).toHaveBeenCalledWith("logistics");
  });
});

// ── ReadinessSheet — a team's page ──────────────────────────────────────────

/** The current query, for checking what the page writes to the link. */
function LocationProbe() {
  return <output data-testid="location">{useLocation().search}</output>;
}

/** The Logistics page at `path` (a Readiness-tab URL's query). */
function renderTeam(path = "/") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ReadinessSheet projectId={PID} teamCode="logistics" />
      <LocationProbe />
    </MemoryRouter>,
  );
}

/** Behind needs a reason: answer the prompt that a "Behind" pick opens. */
async function giveReason(text = "Vendor late") {
  const dialog = await screen.findByRole("dialog", { name: "Why is it behind?" });
  await userEvent.type(within(dialog).getByLabelText("Reason it is behind"), text);
  await userEvent.click(within(dialog).getByRole("button", { name: "Set as behind" }));
}

const sheet = () => screen.findByRole("table", { name: "Logistics execution readiness" });
const rowOf = (table: HTMLElement, well: string) => within(table).getByText(well).closest("tr")!;
const cell = (scope: HTMLElement, label: RegExp) => within(scope).getByLabelText(label);

describe("ReadinessSheet — a team's page", () => {
  it("is the one sheet: a row per well under its field project, no Projects | Wells switch", async () => {
    serveTeam(teamData());
    renderTeam("/?view=projects"); // a link from before the sheet: ignored
    const table = await sheet();
    expect(within(table).getAllByTestId("well-name").map((el) => el.textContent)).toEqual(["W-1", "W-2"]);
    expect(within(table).getByText("Bonga Phase 3").closest("td")).toHaveAttribute("rowspan", "2");
    expect(screen.queryByRole("radiogroup", { name: "Show" })).not.toBeInTheDocument();
    // The heading over the checks names the team's lens.
    expect(within(table).getByRole("columnheader", { name: "Logistics Execution Readiness" })).toBeInTheDocument();
    // W-1 follows its field project; W-2 has its own value.
    expect(
      cell(rowOf(table, "W-1"), /^Budget Availability for W-1: Completed \/ In place — from its field project/),
    ).toBeInTheDocument();
    expect(
      cell(rowOf(table, "W-2"), /^Budget Availability for W-2: Behind schedule — set on this well/),
    ).toBeInTheDocument();
    // W-2 is shared by two activities — the page warns.
    expect(within(rowOf(table, "W-2")).getByText("2 share")).toBeInTheDocument();
  });

  it("draws a project-only check ONCE, merged across the field project's wells, and sets it on the project", async () => {
    serveTeam(teamData());
    let body: unknown = null;
    server.use(
      http.put("/api/projects/:projectId/readiness/:checkCode", async ({ request, params }) => {
        body = { code: params.checkCode, ...((await request.json()) as object) };
        return HttpResponse.json({});
      }),
    );
    renderTeam();
    const table = await sheet();
    const merged = within(table).getAllByLabelText(/^Community Trust for Bonga Phase 3 \(field project\)/);
    expect(merged).toHaveLength(1);
    expect(merged[0].closest("td")).toHaveAttribute("rowspan", "2");
    await userEvent.click(merged[0]);
    const menu = await screen.findByRole("menu");
    // A value on the field project has nothing to reset to.
    expect(within(menu).queryByRole("menuitem", { name: /reset to project/i })).not.toBeInTheDocument();
    await userEvent.click(within(menu).getByRole("menuitem", { name: /Completed/ }));
    await waitFor(() =>
      expect(body).toEqual({ code: "CTS", scope: "project", well_project: "Bonga Phase 3", status: "Completed" }),
    );
  });

  it("a well with no field project shows a project-only check blank", async () => {
    const base = teamData();
    const { CTS: _dropped, ...own } = base.well_rows[0].checks;
    serveTeam(
      teamData({
        well_rows: [...base.well_rows, { ...base.well_rows[0], well_project: "", well_name: "LONE-1", checks: own }],
      }),
    );
    renderTeam();
    const lone = rowOf(await sheet(), "LONE-1");
    expect(within(lone).queryByLabelText(/^Community Trust/)).not.toBeInTheDocument();
    expect(lone.querySelectorAll("[data-not-selected]")).toHaveLength(1);
    expect(within(lone).getByText("No field project")).toBeInTheDocument();
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
    renderTeam();
    await userEvent.click(cell(rowOf(await sheet(), "W-1"), /^Budget Availability for W-1/));
    await userEvent.click(await screen.findByRole("menuitem", { name: /Behind/ }));
    await giveReason();
    await waitFor(() =>
      expect(body).toEqual({
        scope: "well",
        well_project: "Bonga Phase 3",
        well_name: "W-1",
        activity_type: "Oil Development",
        status: "Behind",
        // Behind needs a reason: the prompt's answer is sent as the note.
        notes: "Vendor late",
      }),
    );
  });

  it("offers Reset to project on a well's own value of a two-level check", async () => {
    serveTeam(teamData());
    let reset: unknown = null;
    server.use(
      http.post("/api/projects/:projectId/readiness/:checkCode/reset", async ({ request, params }) => {
        reset = { code: params.checkCode, ...(await request.json() as object) };
        return HttpResponse.json({ status: "Completed", source: "project" });
      }),
    );
    renderTeam();
    const table = await sheet();
    await userEvent.click(cell(rowOf(table, "W-2"), /^Budget Availability for W-2/));
    await userEvent.click(await screen.findByRole("menuitem", { name: /reset to project/i }));
    await waitFor(() => expect(reset).toMatchObject({ code: "L-BUD", well_name: "W-2", scope: "well" }));

    // W-1 follows the project already — no reset offered.
    await userEvent.click(cell(rowOf(await sheet(), "W-1"), /^Budget Availability for W-1/));
    expect(screen.queryByRole("menuitem", { name: /reset to project/i })).not.toBeInTheDocument();
  });

  it("'Set for all wells' lists the field project's checks and sets them on the project", async () => {
    serveTeam(teamData());
    let body: unknown = null;
    server.use(
      http.put("/api/projects/:projectId/readiness/:checkCode", async ({ request, params }) => {
        body = { code: params.checkCode, ...((await request.json()) as object) };
        return HttpResponse.json({});
      }),
    );
    renderTeam();
    await sheet();
    await userEvent.click(screen.getByRole("button", { name: "Set checks for all wells of Bonga Phase 3" }));
    const list = await screen.findByRole("list", { name: "Checks of Bonga Phase 3" });
    expect(within(list).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      expect.stringContaining("L-BUD"),
      expect.stringContaining("CTS"),
    ]);
    await userEvent.click(within(list).getByRole("button", { name: /Budget Availability/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /Behind/ }));
    await giveReason();
    await waitFor(() =>
      expect(body).toEqual({
        code: "L-BUD",
        scope: "project",
        well_project: "Bonga Phase 3",
        status: "Behind",
        notes: "Vendor late",
      }),
    );
  });

  it("a team whose checks are all project-level still lists its wells — each check one cell per field project", async () => {
    // The team read returns well rows for such a team (PR 36 review): each well
    // reads its field project's values.
    const BUD = { ...LBUD, applies_well: false };
    const base = teamData();
    const cells = {
      "L-BUD": { ...st("Completed"), source: "project" as const },
      CTS: { ...st("On Track"), source: "default" as const },
    };
    serveTeam(
      teamData({
        checks: [BUD, CTS],
        well_rows: base.well_rows.map((r) => ({
          ...r,
          checks: cells,
          figures: { counted: 2, done: 1, in_progress: 1, behind: 0, ready: false },
        })),
      }),
    );
    let body: unknown = null;
    server.use(
      http.put("/api/projects/:projectId/readiness/:checkCode", async ({ request, params }) => {
        body = { code: params.checkCode, ...((await request.json()) as object) };
        return HttpResponse.json({});
      }),
    );
    renderTeam();
    const table = await sheet();
    expect(within(table).getAllByTestId("well-name").map((el) => el.textContent)).toEqual(["W-1", "W-2"]);
    expect(screen.getByTestId("readiness-count")).toHaveTextContent("2 wells");
    expect(screen.getByTestId("readiness-summary")).toHaveTextContent("50%complete");
    // Both checks are the field project's: one merged, editable cell each.
    for (const label of [/^Budget Availability for Bonga Phase 3 \(field project\)/, /^Community Trust for Bonga Phase 3 \(field project\)/]) {
      const merged = within(table).getAllByLabelText(label);
      expect(merged).toHaveLength(1);
      expect(merged[0].closest("td")).toHaveAttribute("rowspan", "2");
    }
    await userEvent.click(within(table).getByLabelText(/^Budget Availability for Bonga Phase 3/));
    await userEvent.click(await screen.findByRole("menuitem", { name: /Behind/ }));
    await giveReason();
    await waitFor(() =>
      expect(body).toEqual({
        code: "L-BUD",
        scope: "project",
        well_project: "Bonga Phase 3",
        status: "Behind",
        notes: "Vendor late",
      }),
    );
    // Ticks are the field project's too: Checks… sits there, not on each well.
    const pickers = within(table).getAllByRole("button", { name: /^Checks…/ });
    expect(pickers).toHaveLength(1);
    expect(pickers[0]).toHaveAccessibleName(/^Checks… for Bonga Phase 3 \(field project\)/);
    expect(screen.getByRole("button", { name: "Set checks for all wells of Bonga Phase 3" })).toBeInTheDocument();
  });

  it("a team with well-level checks only has nothing to set on a field project", async () => {
    serveTeam(teamData({ checks: [{ ...LBUD, applies_project: false }], project_rows: [] }));
    renderTeam();
    await sheet();
    expect(screen.queryByRole("button", { name: /^Set checks for all wells/ })).not.toBeInTheDocument();
  });

  it("is view-only without the team's grant", async () => {
    currentUser = { id: "u2", is_admin: false, teams: ["wells"] };
    serveTeam(teamData());
    renderTeam();
    expect(await screen.findByText(/View only — updating Logistics readiness needs/)).toBeInTheDocument();
    const table = await sheet();
    // No cell opens a menu and nothing sets a field project; only Checks…
    // opens — to read the ticks (two wells and their field project).
    const buttons = within(table).getAllByRole("button");
    expect(buttons).toHaveLength(3);
    for (const button of buttons) expect(button).toHaveTextContent(/^Checks…/);
    await userEvent.click(buttons[0]);
    const dialog = await screen.findByRole("dialog", { name: "Logistics checks that apply" });
    for (const box of within(dialog).getAllByRole("checkbox")) expect(box).toBeDisabled();
    expect(within(dialog).queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });

  it("lists wells that spud in the years shown and sums exactly those (spec §3.7)", async () => {
    const base = teamData().well_rows[0];
    serveTeam(
      teamData({
        well_rows: [
          {
            ...base, well_name: "W-THIS", focus_start: "2026-12-10",
            figures: { counted: 2, done: 1, in_progress: 1, behind: 0, ready: false },
          },
          {
            ...base, well_name: "W-FAR", focus_start: "2029-03-01",
            figures: { counted: 2, done: 0, in_progress: 1, behind: 1, ready: false },
          },
          {
            ...base, well_name: "W-DONE", focus_start: null, // completed: nothing left
            figures: { counted: 2, done: 2, in_progress: 0, behind: 0, ready: true },
          },
        ],
      }),
    );
    renderTeam("/?lens=logistics");
    const table = await sheet();
    // Opens on this year and the next two (the suite's date is in 2026).
    expect(screen.getByTestId("readiness-years")).toHaveTextContent("2026–2028");
    expect(within(table).getByText("W-THIS")).toBeInTheDocument();
    expect(within(table).queryByText("W-FAR")).not.toBeInTheDocument();
    expect(within(table).queryByText("W-DONE")).not.toBeInTheDocument();
    // The spud month sits under the well's year.
    expect(within(rowOf(table, "W-THIS")).getByText("Dec")).toBeInTheDocument();
    const summary = screen.getByTestId("readiness-summary");
    expect(summary).toHaveTextContent("50%complete");
    expect(summary).toHaveTextContent("100%on track");
    expect(summary).toHaveTextContent("1 well · 2026–2028");
    // The well it leaves out is counted, so the list never reads as everything
    // — the completed one has no work left and isn't.
    expect(screen.getByTestId("outside-years")).toHaveTextContent(
      "1 more well with work left starts outside these years",
    );

    // A year later: the far well is in, this year's is out.
    await userEvent.click(screen.getByRole("button", { name: "Later years" }));
    await waitFor(() => expect(screen.getByTestId("readiness-years")).toHaveTextContent("2027–2029"));
    await waitFor(() => expect(screen.getByText("W-FAR")).toBeInTheDocument());
    expect(screen.queryByText("W-THIS")).not.toBeInTheDocument();
    expect(screen.queryByText("W-DONE")).not.toBeInTheDocument();
    expect(screen.getByTestId("readiness-summary")).toHaveTextContent("1 well · 2027–2029");
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
    renderTeam("/?lens=logistics&focus=behind");
    const table = await sheet();
    expect(within(table).getByText("W-LATE")).toBeInTheDocument();
    expect(within(table).queryByText("W-OK")).not.toBeInTheDocument();
    expect(screen.getByText(/shown — wells with a check behind/)).toHaveTextContent("1 shown — wells with a check behind");
    expect(screen.getByTestId("readiness-summary")).toHaveTextContent("1 well · 2026–2028");

    await userEvent.click(screen.getByRole("button", { name: /clear filter/i }));
    await waitFor(() => expect(screen.getByText("W-OK")).toBeInTheDocument());
  });

  it("?project= narrows the page to one field project's wells, until cleared", async () => {
    const base = teamData();
    serveTeam(
      teamData({
        well_rows: [...base.well_rows, { ...base.well_rows[0], well_project: "Egina", well_name: "E-1" }],
      }),
    );
    renderTeam("/?project=Bonga+Phase+3");
    const table = await sheet();
    expect(within(table).queryByText("E-1")).not.toBeInTheDocument();
    expect(screen.getByText(/shown — wells of/)).toHaveTextContent("2 shown — wells of Bonga Phase 3");
    expect(screen.getByTestId("readiness-count")).toHaveTextContent("2 of 3");
    await userEvent.click(screen.getByRole("button", { name: /clear filter/i }));
    await waitFor(() => expect(screen.getByText("E-1")).toBeInTheDocument());
    expect(screen.getByTestId("location").textContent).not.toContain("project=");
  });

  it("has the toolbar: its title, Refresh, the years, search and a count of wells", async () => {
    serveTeam(teamData());
    renderTeam();
    await sheet();
    expect(screen.getByText("Readiness Tracker")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /refresh/i })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Years shown" })).toBeInTheDocument();
    expect(screen.getByTestId("readiness-count")).toHaveTextContent("2 wells");
    await userEvent.type(screen.getByLabelText("Search wells and field projects"), "W-2");
    expect(screen.getByTestId("readiness-count")).toHaveTextContent("1 of 2");
  });

  it("shows one year at a time when asked, and says what the years leave out", async () => {
    const base = teamData().well_rows[0];
    serveTeam(
      teamData({
        well_rows: [
          { ...base, well_name: "W-THIS", focus_start: "2026-12-01" },
          { ...base, well_name: "W-NEXT", focus_start: "2027-02-01" },
        ],
      }),
    );
    renderTeam("/?lens=logistics&years=1");
    const table = await sheet();
    expect(screen.getByTestId("readiness-years")).toHaveTextContent("2026");
    expect(within(table).getByText("W-THIS")).toBeInTheDocument();
    expect(within(table).queryByText("W-NEXT")).not.toBeInTheDocument();
    expect(screen.getByTestId("outside-years")).toHaveTextContent("1 more well");
    // Two years: both, and nothing is left out. Never more than three.
    const count = screen.getByLabelText("How many years to show");
    expect(within(count).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "1 year", "2 years", "3 years",
    ]);
    await userEvent.selectOptions(count, "2");
    await waitFor(() => expect(screen.getByText("W-NEXT")).toBeInTheDocument());
    expect(screen.queryByTestId("outside-years")).not.toBeInTheDocument();
  });

  it("explains an empty team", async () => {
    serveTeam(teamData({ checks: [], project_rows: [], well_rows: [] }));
    render(<ReadinessSheet projectId={PID} teamCode="logistics" />, { wrapper: MemoryRouter });
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
