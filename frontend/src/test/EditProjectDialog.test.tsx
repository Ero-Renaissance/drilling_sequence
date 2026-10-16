import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { http, HttpResponse } from "msw";

vi.mock("@/lib/auth", () => ({
  getAccessToken: async () => "test-token",
  msalInstance: { getAllAccounts: () => [], logoutRedirect: vi.fn() },
  loginRequest: {},
}));

import type { Activity, ProjectWellsEditPlan } from "@/api/activities";
import { ActivityGrid } from "@/components/data-grid/ActivityGrid";
import { EditProjectDialog } from "@/components/data-grid/EditProjectDialog";
import { server } from "./mocks/server";

const PID = "cccccccc-0000-0000-0000-000000000001";
const PROJECT = "Bonga Phase 4";

function act(id: string, well: string, start: string, end: string, over: Partial<Activity> = {}): Activity {
  return {
    id,
    project_id: PID,
    activity_type: "Oil Development",
    start_date: start,
    end_date: end,
    well_name: well,
    rig_name: "Rig A",
    hwu_name: null,
    well_project: PROJECT,
    project_group: null,
    location: "SWAMP",
    risk: "No Flood Risk",
    comment: null,
    plan_type: "Firm",
    market: "Oil",
    readiness_required: true,
    completed_at: null,
    updated_at: `2026-10-01T00:00:0${id.slice(-1)}Z`,
    updated_by_name: null,
    locked_by_revision_id: null,
    ...over,
  };
}

// Listed out of order on purpose: the dialog shows them by start date.
const ACTIVITIES: Activity[] = [
  act("a2", "B4-2", "2027-04-01", "2027-06-01", { risk: "Flood Risk" }),
  act("a1", "B4-1", "2027-01-01", "2027-03-18"),
  act("x1", "EG-1", "2027-01-01", "2027-02-01", { well_project: "Egina North", rig_name: "Rig C" }),
];

function editPlan(over: Partial<ProjectWellsEditPlan> = {}): ProjectWellsEditPlan {
  return {
    well_project: PROJECT,
    wells: [
      { id: "a1", well_name: "B4-1", activity_type: "Oil Development", rig_name: "Rig A", hwu_name: null,
        start_date: "2027-01-01", end_date: "2027-03-18", duration_days: 76, gap_before_days: 0,
        gap_kind: "kept", change: "unchanged", completed: false },
      { id: null, well_name: "B4-3", activity_type: "Oil Development", rig_name: "Rig A", hwu_name: null,
        start_date: "2027-06-15", end_date: "2027-08-30", duration_days: 76, gap_before_days: 14,
        gap_kind: "inter_well", change: "new", completed: false },
    ],
    removed: [],
    conflicts: [],
    saved: false,
    ...over,
  };
}

function capture(response: (body: Record<string, unknown>) => Response) {
  const calls: Record<string, unknown>[] = [];
  server.use(
    http.put("/api/projects/:projectId/activities/project-wells", async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      calls.push(body);
      return response(body);
    }),
  );
  return calls;
}

function renderDialog(props: Partial<Parameters<typeof EditProjectDialog>[0]> = {}) {
  const onSaved = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <EditProjectDialog
      projectId={PID}
      projectName={PROJECT}
      activities={ACTIVITIES}
      canEdit
      open
      onOpenChange={onOpenChange}
      onSaved={onSaved}
      {...props}
    />,
  );
  return { dialog: screen.getByRole("dialog"), onSaved, onOpenChange };
}

describe("EditProjectDialog", () => {
  it("opens with the project's wells by start date and shows mixed details", () => {
    const { dialog } = renderDialog();
    expect(within(dialog).getByLabelText("Project *")).toHaveValue(PROJECT);
    expect(within(dialog).getByLabelText("Well 1 name")).toHaveValue("B4-1");
    expect(within(dialog).getByLabelText("Well 2 name")).toHaveValue("B4-2");
    expect(within(dialog).queryByDisplayValue("EG-1")).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText("Well 1 start")).toHaveValue("2027-01-01");
    // The wells agree on the location but not the risk.
    expect(within(dialog).getByLabelText("Location")).toHaveValue("SWAMP");
    expect(within(dialog).getByLabelText("Risk")).toHaveValue("__mixed__");
  });

  it("previews only what changed, then saves after confirming the deletion", async () => {
    const calls = capture((body) =>
      HttpResponse.json(
        editPlan({
          removed: [{ id: "a2", well_name: "B4-2", activity_type: "Oil Development" }],
          saved: !body.dry_run,
        }),
      ),
    );
    const { dialog, onSaved, onOpenChange } = renderDialog();

    await userEvent.selectOptions(within(dialog).getByLabelText("Plan type"), "Option");
    await userEvent.click(within(dialog).getByRole("button", { name: "Remove B4-2" }));
    await userEvent.click(within(dialog).getByRole("button", { name: /add well/i }));
    await userEvent.type(within(dialog).getByLabelText("Well 3 name"), "B4-3");
    await userEvent.click(within(dialog).getByRole("button", { name: "Preview" }));

    const preview = await within(dialog).findByRole("region", { name: "Preview" });
    expect(within(preview).getByText("New")).toBeInTheDocument();
    expect(within(preview).getByText("dates kept")).toBeInTheDocument();
    expect(calls[0]).toEqual({
      well_project: PROJECT,
      plan_type: "Option", // risk stays "Mixed" → not sent; nor the unchanged location
      layout: "keep",
      dry_run: true,
      wells: [
        { id: "a1", expected_updated_at: "2026-10-01T00:00:01Z", well_name: "B4-1",
          activity_type: "Oil Development", resource_type: "rig", resource_name: "Rig A",
          start_date: "2027-01-01", end_date: "2027-03-18" },
        { well_name: "B4-3", activity_type: "Oil Development", resource_type: "rig",
          resource_name: "Rig A", duration_months: 2.5 },
      ],
      removed: [{ id: "a2", expected_updated_at: "2026-10-01T00:00:02Z" }],
    });

    // Deleting a well needs an explicit confirmation.
    const save = within(dialog).getByRole("button", { name: "Save changes" });
    expect(save).toBeDisabled();
    await userEvent.click(within(preview).getByRole("checkbox"));
    await userEvent.click(save);
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(calls[1]).toMatchObject({ dry_run: false, plan_type: "Option" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("sends a rename and a re-sequence", async () => {
    const calls = capture(() => HttpResponse.json(editPlan({ well_project: "Bonga 4B" })));
    const { dialog } = renderDialog();
    await userEvent.clear(within(dialog).getByLabelText("Project *"));
    await userEvent.type(within(dialog).getByLabelText("Project *"), "Bonga 4B");
    await userEvent.click(within(dialog).getByLabelText(/re-sequence every open well/i));
    await userEvent.click(within(dialog).getByRole("button", { name: "Preview" }));

    expect(await within(dialog).findByText("Preview — renamed to Bonga 4B")).toBeInTheDocument();
    expect(calls[0]).toMatchObject({
      new_name: "Bonga 4B",
      layout: "resequence",
      start_date: "2027-01-01", // defaults to the project's first open well
    });
  });

  it("any edit after a preview asks for a fresh one", async () => {
    capture(() => HttpResponse.json(editPlan()));
    const { dialog } = renderDialog();
    await userEvent.click(within(dialog).getByRole("button", { name: "Preview" }));
    await within(dialog).findByRole("region", { name: "Preview" });

    await userEvent.clear(within(dialog).getByLabelText("Well 1 end"));
    await userEvent.type(within(dialog).getByLabelText("Well 1 end"), "2027-04-01");
    expect(within(dialog).queryByRole("region", { name: "Preview" })).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Save changes" })).toBeDisabled();
  });

  it("has nothing to save when nothing changed", async () => {
    capture(() => HttpResponse.json(editPlan({ wells: [editPlan().wells[0]] })));
    const { dialog } = renderDialog();
    await userEvent.click(within(dialog).getByRole("button", { name: "Preview" }));
    await within(dialog).findByRole("region", { name: "Preview" });
    expect(within(dialog).getByRole("button", { name: "Save changes" })).toBeDisabled();
  });

  it("shows the server's reason when the save is refused", async () => {
    capture(() =>
      HttpResponse.json(
        { detail: { code: "conflict", message: "B4-1 was changed by Ada after you opened the project. Reload and try again." } },
        { status: 409 },
      ),
    );
    const { dialog } = renderDialog();
    await userEvent.click(within(dialog).getByRole("button", { name: "Preview" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("changed by Ada");
  });

  it("checks the rows before calling the server", async () => {
    const calls = capture(() => HttpResponse.json(editPlan()));
    const { dialog } = renderDialog();
    await userEvent.clear(within(dialog).getByLabelText("Well 2 name"));
    await userEvent.type(within(dialog).getByLabelText("Well 2 name"), "B4-1"); // same well + activity twice
    await userEvent.click(within(dialog).getByRole("button", { name: "Preview" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("already listed with that activity");
    expect(calls).toHaveLength(0);
  });

  it("keeps a completed well's own fields read-only", () => {
    const done = [act("a1", "B4-1", "2027-01-01", "2027-03-18", { completed_at: "2027-03-18T00:00:00Z" })];
    const { dialog } = renderDialog({ activities: done });
    expect(within(dialog).getByLabelText("Well 1 name")).toBeDisabled();
    expect(within(dialog).getByLabelText("Well 1 end")).toBeDisabled();
    expect(within(dialog).queryByRole("button", { name: "Remove B4-1" })).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText("Project *")).toBeEnabled(); // the project can still change
  });

  it("is view only for non-planners or while the plan is locked", () => {
    const { dialog } = renderDialog({ canEdit: false, readOnlyReason: "The plan is locked by a revision." });
    expect(within(dialog).getByText("The plan is locked by a revision.")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Project *")).toBeDisabled();
    expect(within(dialog).getByLabelText("Well 1 start")).toBeDisabled();
    expect(within(dialog).queryByRole("button", { name: "Preview" })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /add well/i })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
    // The footer's Close (besides the dialog's own X).
    expect(within(dialog).getAllByRole("button", { name: "Close" })).toHaveLength(2);
  });

  it("opens a well's readiness, but not over unsaved changes", async () => {
    const onOpenReadiness = vi.fn();
    const { dialog } = renderDialog({ onOpenReadiness });
    await userEvent.click(within(dialog).getByRole("button", { name: "Open readiness for B4-1" }));
    expect(onOpenReadiness).toHaveBeenCalledWith("a1");

    await userEvent.type(within(dialog).getByLabelText("Well 2 name"), "X");
    expect(within(dialog).getByRole("button", { name: "Open readiness for B4-2X" })).toBeDisabled();
  });
});

describe("Opening a project from the Activities grid", () => {
  it("the Project column opens the project's dialog", async () => {
    server.use(http.get("/api/projects/:projectId/activities", () => HttpResponse.json(ACTIVITIES)));
    render(
      <MemoryRouter initialEntries={[`/projects/${PID}/data`]}>
        <Routes>
          <Route path="/projects/:projectId/data" element={<ActivityGrid projectId={PID} canEditPlan />} />
        </Routes>
      </MemoryRouter>,
    );
    const open = await screen.findAllByRole("button", { name: `Open project ${PROJECT}` });
    await userEvent.click(open[0]);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(`Edit Project — ${PROJECT}`)).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Well 2 name")).toHaveValue("B4-2");
  });
});
