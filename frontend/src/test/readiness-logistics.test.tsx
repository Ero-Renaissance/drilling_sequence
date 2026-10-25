/**
 * Logistics since phase 6 (spec §3.5, §3.8, §8.2, §8.7): six live checks with a
 * tick list per field project and well — and Nominated Equipment only as
 * history.
 */
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

import type {
  ApplicabilityResult,
  CatalogCheck,
  CatalogTeam,
  CheckSource,
  CheckStatus,
  TeamReadiness,
} from "@/api/readiness";
import { ReadinessDot } from "@/components/readiness/ReadinessDot";
import { ReadinessGrid } from "@/components/readiness/ReadinessGrid";
import { TeamReadinessGrid } from "@/components/readiness/TeamReadinessGrid";
import { Toaster } from "@/components/ui/toaster";
import { FrozenCatalogProvider } from "@/components/readiness/catalog";
import {
  STATUS_SEVERITY,
  STATUS_SETS,
  defaultStatusOf,
  legendStatuses,
  pickableStatuses,
  statusesOf,
} from "@/components/readiness/check-meta";
import { worstCheck } from "@/lib/chart-layout";
import { server } from "./mocks/server";

/** Nominated Equipment as a revision froze it (migration 036's literals) — the
 *  check is withdrawn since phase 6 (spec §3.5); only history carries it. */
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

const FDP_GATE = { code: "FDP", locks_with_plan: true };

describe("the availability status set — history only (phase 6)", () => {
  it("still reads like done / on track / blocked, so past revisions render as recorded", () => {
    expect(STATUS_SETS.availability.history_only).toBe(true);
    expect(STATUS_SETS.availability.statuses).toEqual(["Pending", "Available", "Not available"]);
    expect(
      [STATUS_SEVERITY.Pending, STATUS_SEVERITY.Available, STATUS_SEVERITY["Not available"]],
    ).toEqual(["in_progress", "done", "blocked"]);
    expect(statusesOf("availability")).toEqual(["Pending", "Available", "Not available"]);
    expect(statusesOf("unknown")).toEqual(STATUS_SETS.standard.statuses);
  });

  it("nobody picks it any more — its menu would offer nothing", () => {
    expect(pickableStatuses(NEQ)).toEqual([]);
  });

  it("a revision print's legend still lists what its NEQ icons show", () => {
    const PO = { status_set: "standard", locks_with_plan: false };
    expect(legendStatuses([PO, NEQ])).toEqual([
      "On Track", "Behind", "Completed", "Pending", "Available", "Not available",
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
      worstCheck({ FDP: { status: "Completed" }, NEQ: { status: "Not available" } }, [FDP_GATE, NEQ]),
    ).toEqual({ code: "NEQ", status: "Not available" });
  });

  it("a revision's frozen NEQ renders its recorded status — and no equipment", () => {
    render(
      <FrozenCatalogProvider checks={[NEQ]}>
        <ReadinessDot code="NEQ" status="Not available" />
      </FrozenCatalogProvider>,
    );
    expect(screen.getByTitle("Nominated Equipment: Not available")).toBeInTheDocument();
    expect(screen.queryByText(/RW|DSV/)).not.toBeInTheDocument();
  });
});

// ── Checks that apply: the Logistics grid and its picker ─────────────────────

const PID = "cccccccc-0000-0000-0000-000000000001";
const LOGISTICS: CatalogTeam = {
  code: "logistics", name: "Logistics", editor_source: "team_grant", icon_key: "truck", sort_order: 20,
};
const logistics = (code: string, label: string, sort_order: number, over: Partial<CatalogCheck> = {}): CatalogCheck => ({
  code, label, team_code: "logistics", applies_project: true, applies_well: true,
  status_set: "standard", icon_key: "receipt", locks_with_plan: false, sort_order, ...over,
});
const LBUD = logistics("L-BUD", "Budget Availability", 10);
const NAV = logistics("NAV", "Naval Clearance", 70, { icon_key: "anchor" });
// A project-only check an admin added to Logistics.
const PRM = logistics("PRM", "Permit", 80, { applies_well: false, icon_key: "landmark" });

/** A team cell as served since phase 6 — a field project's untick comes from
 *  its own row ("project"): `applies: false` from "default" would be a check
 *  that starts unticked and is NOT SELECTED (phase 7), drawn blank… */
const cell = (
  status: CheckStatus,
  applies = true,
  applies_source: CheckSource = applies ? "default" : "project",
) => ({
  status, notes: null, updated_at: null, applies, applies_source,
});
/** …and a well's, whose `source` says where its STATUS comes from. */
const wcell = (status: CheckStatus, applies: boolean, applies_source: CheckSource, source: CheckSource) => ({
  ...cell(status, applies, applies_source), source,
});

/**
 * Bonga Phase 3 unticked NAV (Completed underneath). W-1 follows it; W-2 made
 * its own choice that NAV applies there. "LONE-1" has no field project, so the
 * project-only PRM carries nothing on it.
 */
function grid(): TeamReadiness {
  return {
    team: LOGISTICS,
    checks: [LBUD, NAV, PRM],
    project_rows: [
      {
        well_project: "Bonga Phase 3", activity_count: 3, focus_start: "2026-01-01",
        checks: { "L-BUD": cell("Completed"), NAV: cell("Completed", false), PRM: cell("Behind") },
      },
    ],
    well_rows: [
      {
        well_project: "Bonga Phase 3", well_name: "W-1", activity_type: "Oil Development", activity_count: 1,
        location: "SWAMP", start_date: "2026-01-01", focus_start: "2026-01-01",
        checks: {
          "L-BUD": wcell("Completed", true, "default", "project"),
          NAV: wcell("On Track", false, "project", "default"),
          PRM: wcell("Behind", true, "default", "project"),
        },
      },
      {
        well_project: "Bonga Phase 3", well_name: "W-2", activity_type: "Oil Development", activity_count: 1,
        location: "SWAMP", start_date: "2026-02-01", focus_start: "2026-02-01",
        checks: {
          "L-BUD": wcell("Behind", true, "default", "well"),
          NAV: wcell("On Track", true, "well", "default"),
          PRM: wcell("Behind", true, "default", "project"),
        },
      },
      {
        well_project: "", well_name: "LONE-1", activity_type: "Workover", activity_count: 1,
        location: "LAND", start_date: "2026-03-01", focus_start: "2026-03-01",
        checks: {
          "L-BUD": wcell("On Track", false, "well", "default"),
          NAV: wcell("On Track", true, "default", "default"),
        },
      },
    ],
    locked: false,
  };
}

let ticks: Record<string, unknown>[] = [];
let tickResponse: ApplicabilityResult = { project_rows: [], well_rows: [] };

beforeEach(() => {
  currentUser = { id: "u1", is_admin: false, teams: ["logistics"] };
  ticks = [];
  tickResponse = { project_rows: [], well_rows: [] };
  server.use(
    http.get("/api/projects/:projectId/readiness/teams/:team", () => HttpResponse.json(grid())),
    http.put("/api/projects/:projectId/readiness/teams/:team/applicability", async ({ request, params }) => {
      ticks.push({ team: params.team, ...((await request.json()) as object) });
      return HttpResponse.json(tickResponse);
    }),
  );
});

/** The grid at `path` — `?view=wells` opens the Wells view (spec §8.8: one view
 *  at a time, Projects by default). */
function renderGrid(path = "/") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <TeamReadinessGrid projectId={PID} teamCode="logistics" />
      <Toaster />
    </MemoryRouter>,
  );
}

const rowOf = (region: HTMLElement, name: string) => within(region).getByText(name).closest("tr")!;

describe("Logistics grid — checks that apply", () => {
  it("draws an unticked check as a muted '—' — never the status kept underneath", async () => {
    renderGrid();
    const projects = await screen.findByRole("region", { name: "Field projects" });
    const bonga = rowOf(projects, "Bonga Phase 3");
    expect(within(bonga).getByTitle("Not applicable")).toHaveTextContent("—");
    expect(within(bonga).queryByTitle(/Naval Clearance: Completed/)).not.toBeInTheDocument();
    // The inheritance rule is said once, over the Field projects table — not in every row.
    expect(
      within(projects).getByText("A field project's ticks apply to its wells unless a well has its own choice."),
    ).toBeInTheDocument();
    expect(within(bonga).queryByText(/apply to its wells|applies to its wells/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("radio", { name: "Wells" }));
    const wells = await screen.findByRole("region", { name: "Wells" });
    // W-1 follows the untick.
    expect(within(rowOf(wells, "W-1")).getByTitle("Not applicable")).toBeInTheDocument();
    // W-2 made its own choice: NAV applies there, marked "set on this well".
    const w2 = rowOf(wells, "W-2");
    expect(within(w2).getByTitle("Naval Clearance: On Track")).toBeInTheDocument();
    expect(within(w2).getByTitle("Applies — set on this well")).toBeInTheDocument();
    // LONE-1 unticked L-BUD itself (a plain tick — nothing to follow), and the
    // project-only PRM carries nothing without a field project: both "—".
    const lone = rowOf(wells, "LONE-1");
    expect(within(lone).getAllByTitle("Not applicable")).toHaveLength(2);
    expect(within(lone).queryByTitle(/Permit/)).not.toBeInTheDocument();
  });

  it("names the not-counted cells 'not applicable', not N/A, and keys the dash", async () => {
    renderGrid("/?view=wells");
    await screen.findByRole("region", { name: "Wells" });
    expect(screen.getByTestId("readiness-summary")).toHaveAttribute(
      "title",
      expect.stringContaining("a check that doesn't apply isn't counted"),
    );
    expect(screen.getByTestId("readiness-summary").getAttribute("title")).not.toMatch(/N\/A/);
    // The legend: no N/A for team checks, a "—" key instead.
    const key = screen.getByTestId("status-key");
    expect(within(key).queryByText("N/A")).not.toBeInTheDocument();
    expect(within(key).getByText("Not applicable")).toBeInTheDocument();
    expect(key).toHaveTextContent("On TrackBehindCompleted—Not applicable");
  });

  it("sums the server's figures: an unticked check, Behind underneath, is never counted", async () => {
    const data = grid();
    // W-1: L-BUD Completed, NAV unticked (Behind kept underneath), PRM project-only
    // and Completed. The server's figures leave NAV out (spec §3.7, §3.8).
    data.well_rows = [
      {
        ...data.well_rows[0],
        checks: {
          "L-BUD": wcell("Completed", true, "default", "project"),
          NAV: wcell("Behind", false, "project", "well"),
          PRM: wcell("Completed", true, "default", "project"),
        },
        figures: { counted: 2, done: 2, in_progress: 0, behind: 0, na: 1, ready: true },
      },
      {
        // LONE-1 unticked both of its checks: counted nowhere, and not a target
        // to be ready.
        ...data.well_rows[2],
        checks: {
          "L-BUD": wcell("On Track", false, "well", "default"),
          NAV: wcell("Behind", false, "well", "well"),
        },
        figures: { counted: 0, done: 0, in_progress: 0, behind: 0, na: 2, ready: false },
      },
    ];
    server.use(http.get("/api/projects/:projectId/readiness/teams/:team", () => HttpResponse.json(data)));
    renderGrid("/?view=wells");
    const wells = await screen.findByRole("region", { name: "Wells" });
    expect(within(rowOf(wells, "W-1")).queryByTitle(/Naval Clearance: Behind/)).not.toBeInTheDocument();
    const summary = screen.getByTestId("readiness-summary");
    expect(summary).toHaveTextContent("100%complete");
    expect(summary).toHaveTextContent("0behind");
    expect(summary).toHaveTextContent("3 not applicable");
    expect(summary).toHaveTextContent("of 5 checks");
    expect(summary).toHaveTextContent("1/1ready");
    expect(summary).toHaveTextContent("2 wells · all");
  });

  it("offers On Track, Behind and Completed in a team check's menu — no N/A", async () => {
    renderGrid("/?view=wells");
    const wells = await screen.findByRole("region", { name: "Wells" });
    await userEvent.click(within(rowOf(wells, "W-1")).getByTitle(/Budget Availability/));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getAllByRole("menuitem").map((i) => i.textContent)).toEqual([
      "On Track",
      "Behind",
      "Completed",
    ]);
  });

  it("a field project's picker: one request with the changed ticks; the rows redraw from the response", async () => {
    const after = grid();
    after.project_rows[0].checks["L-BUD"] = cell("Completed", false);
    after.project_rows[0].checks.NAV = cell("Completed", true);
    tickResponse = { project_rows: after.project_rows, well_rows: after.well_rows.slice(0, 2) };
    renderGrid();
    const projects = await screen.findByRole("region", { name: "Field projects" });
    await userEvent.click(within(rowOf(projects, "Bonga Phase 3")).getByRole("button", { name: /^Checks…/ }));
    const dialog = await screen.findByRole("dialog", { name: "Logistics checks that apply" });
    expect(dialog).toHaveTextContent("Applies to its wells unless a well has its own choice.");
    expect(dialog).toHaveTextContent("1 well has its own choice.");
    // Every project-level check is listed; NAV starts unticked.
    expect(within(dialog).getByRole("checkbox", { name: /^NAV/ })).not.toBeChecked();
    expect(within(dialog).getByRole("checkbox", { name: /^PRM/ })).toBeChecked();
    // Nothing changed yet → nothing to save.
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();

    await userEvent.click(within(dialog).getByRole("checkbox", { name: /^L-BUD/ }));
    await userEvent.click(within(dialog).getByRole("checkbox", { name: /^NAV/ }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(ticks).toEqual([
      {
        team: "logistics",
        scope: "project",
        well_project: "Bonga Phase 3",
        applies: { "L-BUD": false, NAV: true },
      },
    ]);
    // Re-ticked NAV brings back the Completed kept underneath; L-BUD is "—".
    const bonga = rowOf(screen.getByRole("region", { name: "Field projects" }), "Bonga Phase 3");
    expect(within(bonga).getByTitle("Naval Clearance: Completed")).toBeInTheDocument();
    expect(within(bonga).queryByTitle(/Budget Availability/)).not.toBeInTheDocument();
  });

  it("a well's picker: ticks 'from project', its own choice with Follow project, project-only checks read-only", async () => {
    renderGrid("/?view=wells");
    const wells = await screen.findByRole("region", { name: "Wells" });
    await userEvent.click(within(rowOf(wells, "W-2")).getByRole("button", { name: /^Checks…/ }));
    const dialog = await screen.findByRole("dialog", { name: "Logistics checks that apply" });

    const item = (code: string) =>
      within(dialog).getByRole("checkbox", { name: new RegExp(`^${code}`) }).closest("li")!;
    expect(within(item("L-BUD")).getByText("from project")).toBeInTheDocument();
    expect(within(item("NAV")).getByText("set on this well")).toBeInTheDocument();
    expect(within(item("PRM")).getByText("set on the field project")).toBeInTheDocument();
    expect(within(item("PRM")).getByRole("checkbox")).toBeDisabled();

    // Follow project: NAV now reads its field project's choice (unticked).
    await userEvent.click(within(item("NAV")).getByRole("button", { name: "Follow project for NAV" }));
    expect(within(item("NAV")).getByRole("checkbox")).not.toBeChecked();
    expect(within(item("NAV")).getByText("from project")).toBeInTheDocument();
    // Untick L-BUD: this well's own choice now.
    await userEvent.click(within(item("L-BUD")).getByRole("checkbox"));
    expect(within(item("L-BUD")).getByText("set on this well")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(ticks).toHaveLength(1));
    expect(ticks[0]).toEqual({
      team: "logistics",
      scope: "well",
      well_project: "Bonga Phase 3",
      well_name: "W-2",
      activity_type: "Oil Development",
      applies: { "L-BUD": false, NAV: null },
    });
  });

  it("a box click sends the explicit tick — never null, even where it matches the field project as loaded", async () => {
    renderGrid("/?view=wells");
    const wells = await screen.findByRole("region", { name: "Wells" });
    await userEvent.click(within(rowOf(wells, "W-2")).getByRole("button", { name: /^Checks…/ }));
    const dialog = await screen.findByRole("dialog", { name: "Logistics checks that apply" });
    const item = (code: string) =>
      within(dialog).getByRole("checkbox", { name: new RegExp(`^${code}`) }).closest("li")!;

    // NAV: W-2's own choice (applies) under a field project that unticked it.
    // Unticking the box is an explicit "doesn't apply" — it matches the field
    // project as loaded, so it previews "from project", but it is sent as
    // `false`: the server weighs it against the field project's CURRENT tick,
    // so a concurrent re-tick there can't turn it into "applies" (§4.4, §5.1).
    await userEvent.click(within(item("NAV")).getByRole("checkbox"));
    expect(within(item("NAV")).getByRole("checkbox")).not.toBeChecked();
    expect(within(item("NAV")).getByText("from project")).toBeInTheDocument();
    // L-BUD follows its (ticked) field project: off and on again is an explicit
    // "applies" — previewed "from project", sent as `true`.
    await userEvent.click(within(item("L-BUD")).getByRole("checkbox"));
    await userEvent.click(within(item("L-BUD")).getByRole("checkbox"));
    expect(within(item("L-BUD")).getByRole("checkbox")).toBeChecked();
    expect(within(item("L-BUD")).getByText("from project")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(ticks).toHaveLength(1));
    expect(ticks[0]).toEqual({
      team: "logistics",
      scope: "well",
      well_project: "Bonga Phase 3",
      well_name: "W-2",
      activity_type: "Oil Development",
      applies: { "L-BUD": true, NAV: false },
    });
  });

  it("only Follow project sends null", async () => {
    renderGrid("/?view=wells");
    const wells = await screen.findByRole("region", { name: "Wells" });
    await userEvent.click(within(rowOf(wells, "W-2")).getByRole("button", { name: /^Checks…/ }));
    const dialog = await screen.findByRole("dialog", { name: "Logistics checks that apply" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Follow project for NAV" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(ticks).toHaveLength(1));
    expect(ticks[0]).toMatchObject({ scope: "well", well_name: "W-2", applies: { NAV: null } });
  });

  it("a well with no field project ticks plainly — no 'from project', no Follow project", async () => {
    renderGrid("/?view=wells");
    const wells = await screen.findByRole("region", { name: "Wells" });
    await userEvent.click(within(rowOf(wells, "LONE-1")).getByRole("button", { name: /^Checks…/ }));
    const dialog = await screen.findByRole("dialog", { name: "Logistics checks that apply" });
    expect(within(dialog).getAllByRole("checkbox").map((b) => b.getAttribute("aria-label"))).toEqual([
      "L-BUD — Budget Availability",
      "NAV — Naval Clearance",
    ]);
    expect(
      within(dialog).queryByText(/from project|set on this well|set on the field project/),
    ).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /Follow project/ })).not.toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("checkbox", { name: /^L-BUD/ }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(ticks).toHaveLength(1));
    expect(ticks[0]).toMatchObject({ scope: "well", well_project: "", applies: { "L-BUD": true } });
  });

  it("a refused save changes nothing, keeps the dialog and toasts the server's reason", async () => {
    server.use(
      http.put("/api/projects/:projectId/readiness/teams/:team/applicability", () =>
        HttpResponse.json({ detail: "Insufficient role for this action" }, { status: 403 }),
      ),
    );
    renderGrid();
    const projects = await screen.findByRole("region", { name: "Field projects" });
    await userEvent.click(within(rowOf(projects, "Bonga Phase 3")).getByRole("button", { name: /^Checks…/ }));
    const dialog = await screen.findByRole("dialog", { name: "Logistics checks that apply" });
    await userEvent.click(within(dialog).getByRole("checkbox", { name: /^L-BUD/ }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    // Said in the dialog, and toasted (the modal hides the toaster from the
    // accessibility tree, so look it up with hidden elements included).
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Insufficient role for this action");
    expect(
      screen.getByRole("region", { name: "Notifications", hidden: true }),
    ).toHaveTextContent("Insufficient role for this action");
    expect(screen.getByRole("dialog", { name: "Logistics checks that apply" })).toBeInTheDocument();
    // The grid (behind the modal) is as it was.
    const bonga = rowOf(screen.getByRole("region", { name: "Field projects", hidden: true }), "Bonga Phase 3");
    expect(within(bonga).getByTitle("Budget Availability: Completed")).toBeInTheDocument();
  });

  it("is read-only without the Logistics grant — the ticks show, nothing changes", async () => {
    currentUser = { id: "u2", is_admin: false, teams: ["wells"] };
    renderGrid("/?view=wells");
    const wells = await screen.findByRole("region", { name: "Wells" });
    await userEvent.click(within(rowOf(wells, "W-2")).getByRole("button", { name: /^Checks…/ }));
    const dialog = await screen.findByRole("dialog", { name: "Logistics checks that apply" });
    for (const box of within(dialog).getAllByRole("checkbox")) expect(box).toBeDisabled();
    expect(within(dialog).getByText("set on this well")).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /Follow project/ })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(within(dialog).getByText(/View only — choosing which Logistics checks apply needs/)).toBeInTheDocument();
    expect(ticks).toEqual([]);
  });

  it("admins may tick any team's checks", async () => {
    currentUser = { id: "a1", is_admin: true, teams: [] };
    renderGrid();
    const projects = await screen.findByRole("region", { name: "Field projects" });
    await userEvent.click(within(rowOf(projects, "Bonga Phase 3")).getByRole("button", { name: /^Checks…/ }));
    const dialog = await screen.findByRole("dialog", { name: "Logistics checks that apply" });
    expect(within(dialog).getByRole("checkbox", { name: /^NAV/ })).toBeEnabled();
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeInTheDocument();
  });
});

// ── Status menus: team checks without N/A, the Project gates with it ─────────

describe("status menus (spec §3.3, §8.7)", () => {
  const items = async () =>
    within(await screen.findByRole("menu")).getAllByRole("menuitem").map((i) => i.textContent);

  it("a team check on a FIELD-PROJECT row offers On Track, Behind and Completed — no N/A", async () => {
    renderGrid();
    const projects = await screen.findByRole("region", { name: "Field projects" });
    await userEvent.click(within(rowOf(projects, "Bonga Phase 3")).getByTitle("Budget Availability: Completed"));
    expect(await items()).toEqual(["On Track", "Behind", "Completed"]);
  });

  it("a Project gate's menu still offers N/A (decision 31)", async () => {
    render(
      <MemoryRouter>
        <ReadinessGrid projectId={PID} />
      </MemoryRouter>,
    );
    await screen.findByText("Bonga Phase 3");
    await userEvent.click(screen.getAllByTitle(/: On Track$/)[0]);
    expect(await items()).toEqual(["On Track", "Behind", "Completed", "N/A"]);
  });
});

// ── A tick save racing a status write's reload ───────────────────────────────

describe("Logistics grid — a tick save while a status write's reload is in flight", () => {
  it("keeps the status just set AND the tick just saved", async () => {
    // A small server: Bonga's L-BUD status and Egbema's NAV tick, read at
    // request time. The reload after the status PUT (the 2nd read) is slow.
    let bongaLbud: CheckStatus = "Completed";
    let egbemaNav = true;
    let gets = 0;
    let releaseReload: () => void = () => {};
    const snapshot = (): TeamReadiness => ({
      team: LOGISTICS,
      checks: [LBUD, NAV],
      locked: false,
      project_rows: [
        {
          well_project: "Bonga Phase 3", activity_count: 1, focus_start: "2026-01-01",
          checks: { "L-BUD": cell(bongaLbud), NAV: cell("On Track") },
        },
        {
          well_project: "Egbema", activity_count: 1, focus_start: "2026-01-01",
          checks: { "L-BUD": cell("On Track"), NAV: cell("On Track", egbemaNav) },
        },
      ],
      well_rows: [
        {
          well_project: "Egbema", well_name: "E-1", activity_type: "Oil Development", activity_count: 1,
          location: "LAND", start_date: "2026-01-01", focus_start: "2026-01-01",
          checks: {
            "L-BUD": wcell("On Track", true, "default", "project"),
            NAV: wcell("On Track", egbemaNav, egbemaNav ? "default" : "project", "default"),
          },
        },
      ],
    });
    server.use(
      http.get("/api/projects/:projectId/readiness/teams/:team", async () => {
        gets += 1;
        const body = snapshot();
        if (gets === 2) await new Promise<void>((resolve) => (releaseReload = resolve));
        return HttpResponse.json(body);
      }),
      http.put("/api/projects/:projectId/readiness/:code", () => {
        bongaLbud = "Behind";
        return HttpResponse.json({ ok: true });
      }),
      http.put("/api/projects/:projectId/readiness/teams/:team/applicability", () => {
        egbemaNav = false;
        const after = snapshot();
        return HttpResponse.json({ project_rows: [after.project_rows[1]], well_rows: after.well_rows });
      }),
    );
    renderGrid();
    const projects = await screen.findByRole("region", { name: "Field projects" });
    const bonga = () => rowOf(screen.getByRole("region", { name: "Field projects" }), "Bonga Phase 3");
    const egbema = () => rowOf(screen.getByRole("region", { name: "Field projects" }), "Egbema");

    // Set Bonga's L-BUD to Behind: saved, and its reload is now in flight.
    await userEvent.click(within(rowOf(projects, "Bonga Phase 3")).getByTitle("Budget Availability: Completed"));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Behind" }));
    await waitFor(() => expect(gets).toBe(2));

    // Meanwhile, untick NAV on Egbema.
    await userEvent.click(within(egbema()).getByRole("button", { name: /^Checks…/ }));
    const dialog = await screen.findByRole("dialog", { name: "Logistics checks that apply" });
    await userEvent.click(within(dialog).getByRole("checkbox", { name: /^NAV/ }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // Instant feedback from the response.
    expect(within(egbema()).getByTitle("Not applicable")).toBeInTheDocument();

    // The slow reload (L-BUD Behind, but NAV still ticked: it predates the
    // tick) lands now. Neither write may be lost.
    releaseReload();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await waitFor(() =>
      expect(within(bonga()).getByTitle(/^Budget Availability: /)).toHaveAttribute(
        "title",
        "Budget Availability: Behind",
      ),
    );
    expect(within(egbema()).getByTitle("Not applicable")).toBeInTheDocument();
    expect(within(egbema()).queryByTitle(/^Naval Clearance: /)).not.toBeInTheDocument();
  });
});
