/**
 * Behind needs a reason (2026-11-26, every team): a check can't be saved as
 * behind without saying why. The server enforces it; every screen that can set
 * a status asks first — and sends the answer as the note — so the save isn't
 * simply refused. Reasons are read on the Readiness tab.
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

import type { Activity } from "@/api/activities";
import type { CheckStatus } from "@/api/readiness";
import { ActivityChartEditDialog } from "@/components/chart/ActivityChartEditDialog";
import { needsReason } from "@/components/readiness/BehindReason";
import { ReadinessSheet } from "@/components/readiness/ReadinessSheet";
import { Toaster } from "@/components/ui/toaster";
import { server } from "./mocks/server";
import { mockGateTeam } from "./mocks/handlers";

const PID = "cccccccc-0000-0000-0000-000000000001";
let puts: Record<string, unknown>[] = [];

/** W-1 follows its field project; W-2 is behind on FDP from BEFORE reasons
 *  were required (no note), and behind on FID with one. */
function team() {
  const data = mockGateTeam({
    wells: [
      { well_project: "Bonga Phase 3", well_name: "W-1", start_date: "2027-01-10" },
      { well_project: "Bonga Phase 3", well_name: "W-2", start_date: "2027-03-01" },
    ],
    wellStatuses: { "Bonga Phase 3\u0001W-2": { FDP: "Behind", FID: "Behind" } },
  });
  return {
    ...data,
    well_rows: data.well_rows.map((r) =>
      r.well_name === "W-2"
        ? { ...r, checks: { ...r.checks, FID: { ...r.checks.FID, notes: "Board slipped" } } }
        : r,
    ),
  };
}

beforeEach(() => {
  currentUser = { id: "p1", is_admin: false, teams: [] };
  puts = [];
  server.use(
    http.get("/api/projects/:projectId/readiness/teams/projects", () => HttpResponse.json(team())),
    http.put("/api/projects/:projectId/readiness/:checkCode", async ({ request, params }) => {
      puts.push({ code: params.checkCode, ...((await request.json()) as object) });
      return HttpResponse.json({});
    }),
  );
});

function renderSheet() {
  return render(
    <MemoryRouter>
      <ReadinessSheet projectId={PID} teamCode="projects" canEditPlan />
      <Toaster />
    </MemoryRouter>,
  );
}

const table = () => screen.findByRole("table", { name: "Well execution readiness" });
const rowOf = (t: HTMLElement, well: string) => within(t).getByText(well).closest("tr")!;
const prompt = () => screen.findByRole("dialog", { name: "Why is it behind?" });

describe("needsReason", () => {
  it("is decided by severity, not status text", () => {
    const yes: CheckStatus[] = ["Behind", "Not available"];
    const no: CheckStatus[] = ["Not started", "On Track", "Completed", "N/A", "Available", "Pending"];
    for (const status of yes) expect(needsReason(status)).toBe(true);
    for (const status of no) expect(needsReason(status)).toBe(false);
  });
});

describe("the Readiness tab asks why before a check is saved as behind", () => {
  it("sends the reason as the note; nothing is saved until one is given", async () => {
    renderSheet();
    const t = await table();
    await userEvent.click(within(rowOf(t, "W-1")).getByLabelText(/^Well Permits for W-1/));
    await userEvent.click(await screen.findByRole("menuitem", { name: /Behind schedule/ }));
    const dialog = await prompt();
    expect(dialog).toHaveTextContent("Well Permits · W-1");
    const save = within(dialog).getByRole("button", { name: "Set as behind" });
    expect(save).toBeDisabled();
    // Spaces alone aren't a reason.
    await userEvent.type(within(dialog).getByLabelText("Reason it is behind"), "   ");
    expect(save).toBeDisabled();
    expect(puts).toHaveLength(0);
    await userEvent.type(within(dialog).getByLabelText("Reason it is behind"), " Permit office backlog ");
    await userEvent.click(save);
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toMatchObject({
      code: "WP",
      scope: "well",
      well_name: "W-1",
      status: "Behind",
      notes: "Permit office backlog", // trimmed
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("cancelling leaves the status as it was — nothing is sent", async () => {
    renderSheet();
    const t = await table();
    await userEvent.click(within(rowOf(t, "W-1")).getByLabelText(/^Well Permits for W-1/));
    await userEvent.click(await screen.findByRole("menuitem", { name: /Behind schedule/ }));
    await userEvent.click(within(await prompt()).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(puts).toHaveLength(0);
    expect(within(rowOf(await table(), "W-1")).getByLabelText(/^Well Permits for W-1: Not started/)).toBeInTheDocument();
  });

  it("no other status asks, and none sends a note", async () => {
    renderSheet();
    const t = await table();
    await userEvent.click(within(rowOf(t, "W-1")).getByLabelText(/^Well Permits for W-1/));
    await userEvent.click(await screen.findByRole("menuitem", { name: /Completed/ }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(puts[0]).toMatchObject({ code: "WP", status: "Completed" });
    expect(puts[0]).not.toHaveProperty("notes");
  });

  it("'Set for all wells' asks too, for the field project", async () => {
    renderSheet();
    await table();
    await userEvent.click(screen.getByRole("button", { name: "Set checks for all wells of Bonga Phase 3" }));
    const list = await screen.findByRole("list", { name: "Checks of Bonga Phase 3" });
    await userEvent.click(within(list).getByRole("button", { name: /Long Lead Items/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /Behind/ }));
    const dialog = await prompt();
    expect(dialog).toHaveTextContent("Long Lead Items · Bonga Phase 3 (field project)");
    await userEvent.type(within(dialog).getByLabelText("Reason it is behind"), "Wellhead lead time");
    await userEvent.click(within(dialog).getByRole("button", { name: "Set as behind" }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toEqual({
      code: "LLI",
      scope: "project",
      well_project: "Bonga Phase 3",
      status: "Behind",
      notes: "Wellhead lead time",
    });
  });

  it("a cell that is already behind says its reason — or that it has none — and doesn't ask again", async () => {
    renderSheet();
    const t = await table();
    const w2 = rowOf(t, "W-2");
    // With a reason: named in the cell's label and shown in the cell.
    const fid = within(w2).getByLabelText(/^Final Investment Decision for W-2: Behind schedule/);
    expect(fid).toHaveAccessibleName(/— Reason: Board slipped/);
    expect(fid).toHaveTextContent("Board slipped");
    // The hover is short — which check, and why — not the full description.
    expect(fid).toHaveAttribute("title", "Final Investment Decision: Board slipped");
    // Behind from before reasons were required: it says so, and offers to add one.
    const fdp = within(w2).getByLabelText(/^Approved FDP\/IP for W-2: Behind schedule/);
    expect(fdp).toHaveAccessibleName(/— no reason given/);
    expect(fdp).toHaveAttribute("title", "Approved FDP/IP: no reason given");
    // A cell that isn't behind just names its status (or its note).
    expect(within(rowOf(t, "W-1")).getByLabelText(/^Well Permits for W-1/)).toHaveAttribute(
      "title",
      "Well Permits: Not started",
    );
    await userEvent.click(fdp);
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: "Add reason…" })).toBeInTheDocument();
    // Picking the status it already has changes nothing: no prompt, no request.
    await userEvent.click(within(menu).getByRole("menuitem", { name: /Behind schedule/ }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(puts).toHaveLength(0);
  });

  it("shows the server's refusal if a save still arrives without a reason", async () => {
    server.use(
      http.put("/api/projects/:projectId/readiness/:checkCode", () =>
        HttpResponse.json({ detail: "Say why it is behind: a reason is required" }, { status: 422 }),
      ),
    );
    renderSheet();
    const t = await table();
    await userEvent.click(within(rowOf(t, "W-1")).getByLabelText(/^Well Permits for W-1/));
    await userEvent.click(await screen.findByRole("menuitem", { name: /Behind schedule/ }));
    const dialog = await prompt();
    await userEvent.type(within(dialog).getByLabelText("Reason it is behind"), "x");
    await userEvent.click(within(dialog).getByRole("button", { name: "Set as behind" }));
    await waitFor(() =>
      expect(screen.getByRole("region", { name: "Notifications" })).toHaveTextContent(
        "Say why it is behind: a reason is required",
      ),
    );
  });
});

describe("the well edit dialog asks when a check is picked as behind", () => {
  const ACTIVITY = {
    id: "act-1", project_id: "proj-001", activity_type: "Oil Development",
    start_date: "2026-01-01", end_date: "2026-03-01", well_name: "W-1",
    rig_name: "Rig A", hwu_name: null, well_project: "Old Project",
    project_group: null, location: "LAND", risk: "No Flood Risk", comment: null,
    plan_type: "Firm", market: null, readiness_required: true, completed_at: null,
    created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
    updated_by_name: null, locked_by_revision_id: "rev-1",
  } as Activity;

  function open(onSaved = vi.fn()) {
    render(
      <ActivityChartEditDialog
        projectId="proj-001"
        activity={ACTIVITY}
        allActivities={[ACTIVITY]}
        open
        onOpenChange={() => {}}
        onSaved={onSaved}
      />,
    );
    return onSaved;
  }

  it("keeps the reason with the pick and sends it on Save", async () => {
    const onSaved = open();
    const save = screen.getByRole("button", { name: "Save readiness" });
    await waitFor(() => expect(screen.getAllByTitle(/: Not started$/)[0]).toBeEnabled());
    await userEvent.click(screen.getAllByTitle(/: Not started$/)[0]);
    await userEvent.click(await screen.findByRole("menuitem", { name: /Behind/ }));
    const dialog = await prompt();
    await userEvent.type(within(dialog).getByLabelText("Reason it is behind"), "FDP under review");
    await userEvent.click(within(dialog).getByRole("button", { name: "Set as behind" }));
    // The prompt's own submit never saves the dialog behind it.
    expect(puts).toHaveLength(0);
    expect(onSaved).not.toHaveBeenCalled();
    await waitFor(() => expect(save).toBeEnabled());
    await userEvent.click(save);
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(puts).toHaveLength(1);
    expect(puts[0]).toMatchObject({ scope: "well", well_name: "W-1", status: "Behind", notes: "FDP under review" });
  });

  it("a cancelled prompt leaves the check as it was", async () => {
    open();
    await waitFor(() => expect(screen.getAllByTitle(/: Not started$/)[0]).toBeEnabled());
    await userEvent.click(screen.getAllByTitle(/: Not started$/)[0]);
    await userEvent.click(await screen.findByRole("menuitem", { name: /Behind/ }));
    await userEvent.click(within(await prompt()).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Why is it behind?" })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Save readiness" })).toBeDisabled();
    expect(puts).toHaveLength(0);
  });
});
