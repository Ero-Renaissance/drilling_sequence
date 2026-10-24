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
import type { CatalogCheck, CatalogTeam, CheckStatus } from "@/api/readiness";
import { ActivityReadinessPanel } from "@/components/readiness/ActivityReadinessPanel";
import {
  BUILTIN_PROJECT_GATES,
  BUILTIN_TEAMS,
  ReadinessCatalogProvider,
} from "@/components/readiness/catalog";
import { server } from "./mocks/server";

const PID = "cccccccc-0000-0000-0000-000000000001";
const LOGISTICS: CatalogTeam = { code: "logistics", name: "Logistics", editor_source: "team_grant", icon_key: "truck", sort_order: 20 };
const LBUD: CatalogCheck = {
  code: "L-BUD", label: "Budget Availability", team_code: "logistics", applies_project: true,
  applies_well: true, status_set: "standard", icon_key: "hand-coins", locks_with_plan: false, sort_order: 10,
};
const st = (status: CheckStatus) => ({ status, notes: null, updated_at: null });
// A team cell as served since phase 6 (Project-gate cells carry no `applies`).
const cell = (status: CheckStatus) => ({ ...st(status), applies: true, applies_source: "default" });

const ACTIVITY = {
  id: "a1", activity_type: "Oil Development", start_date: "2026-11-01", end_date: "2027-01-15",
  well_name: "W-1", well_project: "Bonga Phase 3", rig_name: "Rig A", location: "SWAMP",
  readiness_required: true, completed_at: null,
} as unknown as Activity;

let locked = false;
let puts: Record<string, unknown>[] = [];

beforeEach(() => {
  currentUser = { id: "u1", is_admin: false, teams: ["logistics"] };
  locked = false;
  puts = [];
  server.use(
    http.get("/api/readiness/catalog", () =>
      HttpResponse.json({ teams: [...BUILTIN_TEAMS, LOGISTICS], checks: [...BUILTIN_PROJECT_GATES, LBUD], status_sets: {} }),
    ),
    http.get("/api/projects/:projectId/readiness", () =>
      HttpResponse.json([
        {
          well_project: "Bonga Phase 3", activity_count: 2, locked,
          checks: Object.fromEntries(BUILTIN_PROJECT_GATES.map((g) => [g.code, st("On Track")])),
        },
      ]),
    ),
    http.get("/api/projects/:projectId/readiness/teams/:team", () =>
      HttpResponse.json({
        team: LOGISTICS, checks: [LBUD], locked,
        project_rows: [{ well_project: "Bonga Phase 3", activity_count: 2, checks: { "L-BUD": cell("Completed") } }],
        well_rows: [{
          well_project: "Bonga Phase 3", well_name: "W-1", activity_type: "Oil Development", activity_count: 1,
          location: "SWAMP", start_date: "2026-11-01", focus_start: null,
          checks: { "L-BUD": { ...cell("Completed"), source: "project" } },
        }],
      }),
    ),
    http.put("/api/projects/:projectId/readiness/:checkCode", async ({ request, params }) => {
      puts.push({ code: params.checkCode, ...((await request.json()) as object) });
      return HttpResponse.json({});
    }),
  );
});

function renderPanel(props: Partial<Parameters<typeof ActivityReadinessPanel>[0]> = {}) {
  return render(
    <ReadinessCatalogProvider>
      <ActivityReadinessPanel
        projectId={PID}
        activity={ACTIVITY}
        canEditProjectGates={false}
        open
        onOpenChange={vi.fn()}
        {...props}
      />
    </ReadinessCatalogProvider>,
  );
}

describe("ActivityReadinessPanel", () => {
  it("shows every team; a logistics grantee edits logistics, views the project gates", async () => {
    renderPanel();
    const logistics = await screen.findByRole("region", { name: "Logistics" });
    expect(within(logistics).getByText("You can edit")).toBeInTheDocument();
    // This well follows its field project — faded and labelled.
    const row = within(logistics).getByText("Budget Availability").closest("tr")!;
    expect(within(row).getByTitle("Budget Availability: Completed (from field project)")).toBeInTheDocument();

    const gates = screen.getByRole("region", { name: "Project gates" });
    expect(within(gates).getByText("View only")).toBeInTheDocument();
    expect(within(gates).getByText("View only — campaign planners update these.")).toBeInTheDocument();
    expect(within(gates).queryAllByRole("button", { name: /click to change/i })).toHaveLength(0);
  });

  it("sets this well's own value, or the whole field project's", async () => {
    const onChanged = vi.fn();
    renderPanel({ onChanged });
    const logistics = await screen.findByRole("region", { name: "Logistics" });
    const row = within(logistics).getByText("Budget Availability").closest("tr")!;
    const [wellDot, projectDot] = within(row).getAllByRole("button", { name: /click to change/i });

    await userEvent.click(wellDot);
    await userEvent.click(await screen.findByRole("menuitem", { name: /Behind/ }));
    await waitFor(() =>
      expect(puts[0]).toMatchObject({ code: "L-BUD", scope: "well", well_name: "W-1", status: "Behind" }),
    );

    // A team check's menu never offers N/A (spec §3.3) — "doesn't apply" is
    // the tick list; the field project's Completed L-BUD is set back to On Track.
    await userEvent.click(projectDot);
    const menu = await screen.findByRole("menu");
    expect(within(menu).getAllByRole("menuitem").map((i) => i.textContent)).toEqual([
      "On Track",
      "Behind",
      "Completed",
    ]);
    expect(within(menu).queryByRole("menuitem", { name: /N\/A/ })).not.toBeInTheDocument();
    await userEvent.click(within(menu).getByRole("menuitem", { name: /On Track/ }));
    await waitFor(() =>
      expect(puts[1]).toMatchObject({ code: "L-BUD", scope: "project", well_project: "Bonga Phase 3", status: "On Track" }),
    );
    expect(onChanged).toHaveBeenCalled();
  });

  it("the Project gates' menus keep N/A", async () => {
    currentUser = { id: "p1", is_admin: false, teams: [] };
    renderPanel({ canEditProjectGates: true });
    const gates = await screen.findByRole("region", { name: "Project gates" });
    await waitFor(() =>
      expect(within(gates).getAllByRole("button", { name: /click to change/i }).length).toBeGreaterThan(0),
    );
    await userEvent.click(within(gates).getAllByRole("button", { name: /click to change/i })[0]);
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: /N\/A/ })).toBeInTheDocument();
    // …and they have no tick list.
    expect(within(gates).queryByRole("button", { name: /^Checks…/ })).not.toBeInTheDocument();
  });

  it("planners edit the project gates, which freeze with the plan", async () => {
    currentUser = { id: "p1", is_admin: false, teams: [] };
    locked = true;
    renderPanel({ canEditProjectGates: true });
    const gates = await screen.findByRole("region", { name: "Project gates" });
    expect(within(gates).getByText("You can edit")).toBeInTheDocument();
    await waitFor(() =>
      expect(within(gates).queryAllByRole("button", { name: /click to change/i })).toHaveLength(0),
    );
    // …while the live logistics checks are view-only only for lack of the grant.
    const logistics = screen.getByRole("region", { name: "Logistics" });
    expect(within(logistics).getByText(/needs the Logistics grant/)).toBeInTheDocument();
  });

  it("opens on the chosen team and links back to the activity's details", async () => {
    const onEditActivity = vi.fn();
    renderPanel({ focusTeam: "logistics", onEditActivity });
    await screen.findByRole("region", { name: "Logistics" });
    expect(screen.getByRole("button", { name: /^project gates/i })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: /^logistics/i })).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(screen.getByRole("button", { name: /activity details/i }));
    expect(onEditActivity).toHaveBeenCalled();
  });

  it("says so when readiness is switched off for the activity", () => {
    renderPanel({ activity: { ...ACTIVITY, readiness_required: false } as Activity });
    expect(screen.getByText(/Readiness is switched off for this activity/)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Logistics" })).not.toBeInTheDocument();
  });
});

// ── Checks that apply (phase 6, spec §3.8, §8.7) ─────────────────────────────

const NAV: CatalogCheck = { ...LBUD, code: "NAV", label: "Naval Clearance", icon_key: "anchor", sort_order: 20 };

describe("ActivityReadinessPanel — checks that apply", () => {
  let ticks: Record<string, unknown>[] = [];

  beforeEach(() => {
    ticks = [];
    server.use(
      http.get("/api/readiness/catalog", () =>
        HttpResponse.json({ teams: [...BUILTIN_TEAMS, LOGISTICS], checks: [...BUILTIN_PROJECT_GATES, LBUD, NAV], status_sets: {} }),
      ),
      http.get("/api/projects/:projectId/readiness/teams/:team", () =>
        HttpResponse.json({
          team: LOGISTICS, checks: [LBUD, NAV], locked: false,
          // The field project unticked NAV; this well follows it.
          project_rows: [{
            well_project: "Bonga Phase 3", activity_count: 2,
            checks: { "L-BUD": cell("Completed"), NAV: { ...cell("Behind"), applies: false, applies_source: "project" } },
          }],
          well_rows: [{
            well_project: "Bonga Phase 3", well_name: "W-1", activity_type: "Oil Development", activity_count: 1,
            location: "SWAMP", start_date: "2026-11-01", focus_start: null,
            checks: {
              "L-BUD": { ...cell("Completed"), source: "project" },
              NAV: { ...cell("On Track"), source: "default", applies: false, applies_source: "project" },
            },
          }],
        }),
      ),
      http.put("/api/projects/:projectId/readiness/teams/:team/applicability", async ({ request, params }) => {
        ticks.push({ team: params.team, ...((await request.json()) as object) });
        return HttpResponse.json({ project_rows: [], well_rows: [] });
      }),
    );
  });

  it("folds the checks that don't apply under 'Not applicable (N)' — no dot, no status", async () => {
    renderPanel();
    const logistics = await screen.findByRole("region", { name: "Logistics" });
    await waitFor(() => expect(within(logistics).getByText("Budget Availability")).toBeInTheDocument());
    // NAV is listed only in the folded list, never as a dot in the table.
    expect(within(logistics).queryByTitle(/Naval Clearance/)).not.toBeInTheDocument();
    const toggle = within(logistics).getByRole("button", { name: "Not applicable (1)" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(within(logistics).queryByText("Naval Clearance")).not.toBeInTheDocument();

    await userEvent.click(toggle);
    const list = within(logistics).getByRole("list", { name: "Not applicable" });
    expect(within(list).getByText("Naval Clearance")).toBeInTheDocument();
    expect(within(list).getByText("from project")).toBeInTheDocument();
  });

  it("Checks… edits this well: one request with the changed ticks", async () => {
    const onChanged = vi.fn();
    renderPanel({ onChanged });
    const logistics = await screen.findByRole("region", { name: "Logistics" });
    await userEvent.click(await within(logistics).findByRole("button", { name: /^Checks…/ }));
    const dialog = await screen.findByRole("dialog", { name: "Logistics checks that apply" });
    // L-BUD follows its field project (ticked); NAV follows it too (unticked).
    expect(within(dialog).getAllByText("from project")).toHaveLength(2);
    await userEvent.click(within(dialog).getByRole("checkbox", { name: /^L-BUD/ }));
    await userEvent.click(within(dialog).getByRole("checkbox", { name: /^NAV/ }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(ticks).toHaveLength(1));
    expect(ticks[0]).toEqual({
      team: "logistics",
      scope: "well",
      well_project: "Bonga Phase 3",
      well_name: "W-1",
      activity_type: "Oil Development",
      applies: { "L-BUD": false, NAV: true },
    });
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("a view-only reader sees the ticks but can't change them", async () => {
    currentUser = { id: "v1", is_admin: false, teams: [] };
    renderPanel();
    const logistics = await screen.findByRole("region", { name: "Logistics" });
    await userEvent.click(await within(logistics).findByRole("button", { name: /^Checks…/ }));
    const dialog = await screen.findByRole("dialog", { name: "Logistics checks that apply" });
    for (const box of within(dialog).getAllByRole("checkbox")) expect(box).toBeDisabled();
    expect(within(dialog).queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(within(dialog).getByText(/View only/)).toBeInTheDocument();
  });
});
