import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  getAccessToken: async () => "test-token",
  msalInstance: { getAllAccounts: () => [], logoutRedirect: vi.fn() },
  loginRequest: {},
}));

import { http, HttpResponse } from "msw";
import type { Activity } from "@/api/activities";
import { ActivityChartEditDialog } from "@/components/chart/ActivityChartEditDialog";
import { server } from "./mocks/server";

const ACTIVITY: Activity = {
  id: "act-1", project_id: "proj-001", activity_type: "Oil Development",
  start_date: "2026-01-01", end_date: "2026-03-01", well_name: "W-1",
  rig_name: "Rig A", hwu_name: null, well_project: "Old Project",
  project_group: null, location: "LAND", risk: "No Flood Risk", comment: null,
  plan_type: "Firm", market: null, readiness_required: true, completed_at: null,
  created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
  updated_by_name: null, locked_by_revision_id: null,
} as Activity;

describe("ActivityChartEditDialog — project field", () => {
  it("edits the field project and sends it in the PATCH", async () => {
    let patched: Record<string, unknown> | null = null;
    server.use(
      http.patch("/api/projects/:projectId/activities/:activityId", async ({ request }) => {
        patched = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ...ACTIVITY, ...patched, updated_at: "2026-07-21T00:00:00Z" });
      }),
    );
    render(
      <ActivityChartEditDialog
        projectId="proj-001"
        activity={ACTIVITY}
        allActivities={[ACTIVITY, { ...ACTIVITY, id: "a2", well_project: "Bonga Phase 3" }]}
        open
        onOpenChange={() => {}}
        onSaved={() => {}}
      />,
    );

    // Read-only until the user asks to move the well.
    expect(screen.queryByPlaceholderText("e.g. Bonga Phase 3")).not.toBeInTheDocument();
    expect(screen.getByTestId("project-readonly")).toHaveTextContent("Old Project");
    await userEvent.click(screen.getByRole("button", { name: "Move to another project" }));
    const project = screen.getByPlaceholderText("e.g. Bonga Phase 3");
    expect(project).toHaveValue("Old Project");
    await userEvent.clear(project);
    await userEvent.type(project, "Bonga Phase 3");
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(patched).not.toBeNull());
    expect(patched).toMatchObject({ well_project: "Bonga Phase 3" });
  });
});

describe("ActivityChartEditDialog — warning severity colours", () => {
  // Colour tracks what happens at SUBMIT, not how the dialog behaves (both
  // warnings are non-blocking here): amber = advisory, red = will be refused.
  const CONTRACT = {
    id: "c1", project_id: "proj-001", rig_name: "Rig A", terrain: "LAND",
    contract_start: "2026-01-01", contract_end: "2026-02-01",
    notes: null, updated_at: "2026-01-01T00:00:00Z",
  } as never;

  it("past-contract work is AMBER — advisory, the plan still submits", async () => {
    render(
      <ActivityChartEditDialog
        projectId="proj-001"
        activity={ACTIVITY}
        allActivities={[ACTIVITY]}
        contractsByRig={new Map([["Rig A", CONTRACT]])}
        open
        onOpenChange={() => {}}
        onSaved={() => {}}
      />,
    );

    // ACTIVITY ends 2026-03-01, the contract ends 2026-02-01 → warned.
    const warning = await screen.findByTestId("contract-impact-warning");
    expect(warning).toHaveTextContent(/past the contract end/i);
    expect(warning.className).toContain("amber");
    expect(warning.className).not.toContain("red");
  });

  it("a rig double-booking is RED — submit hard-blocks it (409)", async () => {
    const overlapping = {
      ...ACTIVITY, id: "act-2", well_name: "W-2",
      start_date: "2026-02-01", end_date: "2026-04-01",
    } as Activity;
    render(
      <ActivityChartEditDialog
        projectId="proj-001"
        activity={ACTIVITY}
        allActivities={[ACTIVITY, overlapping]}
        open
        onOpenChange={() => {}}
        onSaved={() => {}}
      />,
    );

    const warning = await screen.findByTestId("conflict-warning");
    expect(warning).toHaveTextContent(/overlaps/i);
    expect(warning.className).toContain("red");
    expect(warning.className).not.toContain("amber");
  });
});

describe("ActivityChartEditDialog — which well is being edited", () => {
  it("heads the dialog with the well's name and where it sits", () => {
    render(
      <ActivityChartEditDialog
        projectId="proj-001"
        activity={ACTIVITY}
        allActivities={[ACTIVITY]}
        open
        onOpenChange={() => {}}
        onSaved={() => {}}
      />,
    );
    expect(screen.getByRole("dialog", { name: "W-1" })).toBeInTheDocument();
    expect(screen.getByText("Editing well")).toBeInTheDocument();
    const identity = screen.getByTestId("edit-dialog-identity");
    expect(identity).toHaveTextContent("Oil Development · Old Project · Rig A ·");
  });
});

describe("ActivityChartEditDialog — readiness while the plan is locked", () => {
  it("keeps the gates editable and saves only what changed, without touching the activity", async () => {
    const puts: { code: string; body: Record<string, unknown> }[] = [];
    let patched = false;
    server.use(
      http.put("/api/projects/:projectId/readiness/:code", async ({ request, params }) => {
        puts.push({ code: String(params.code), body: (await request.json()) as Record<string, unknown> });
        return HttpResponse.json({});
      }),
      http.patch("/api/projects/:projectId/activities/:activityId", () => {
        patched = true;
        return HttpResponse.json({}, { status: 423 });
      }),
    );
    const onSaved = vi.fn();
    render(
      <ActivityChartEditDialog
        projectId="proj-001"
        activity={{ ...ACTIVITY, locked_by_revision_id: "rev-1" } as Activity}
        allActivities={[ACTIVITY]}
        open
        onOpenChange={() => {}}
        onSaved={onSaved}
      />,
    );
    expect(screen.getByText("Viewing well")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Move to another project" })).not.toBeInTheDocument();
    const save = screen.getByRole("button", { name: "Save readiness" });
    expect(save).toBeDisabled(); // nothing changed yet

    // W-1 has no value of its own yet: every check reads Not started. The
    // dots enable once the well's checks have loaded.
    await waitFor(() => expect(screen.getAllByTitle(/: Not started$/)[0]).toBeEnabled());
    await userEvent.click(screen.getAllByTitle(/: Not started$/)[0]);
    await userEvent.click(await screen.findByRole("menuitem", { name: /Completed/ }));
    await userEvent.click(save);

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(puts).toHaveLength(1);
    // Saved on THIS well (phase 8) — not on its whole field project.
    expect(puts[0].body).toMatchObject({
      scope: "well",
      well_project: "Old Project",
      well_name: "W-1",
      activity_type: "Oil Development",
      status: "Completed",
    });
    expect(patched).toBe(false);
  });
});

describe("ActivityChartEditDialog — field order and the Project field", () => {
  const open = (activity: Activity, onSaved = () => {}) =>
    render(
      <ActivityChartEditDialog
        projectId="proj-001"
        activity={activity}
        allActivities={[activity]}
        open
        onOpenChange={() => {}}
        onSaved={onSaved}
      />,
    );

  it("starts with the well name and doesn't put the cursor in a field", () => {
    open(ACTIVITY);
    const fields = screen.getAllByRole("textbox");
    expect(fields[0]).toHaveValue("W-1");
    expect(screen.getByRole("dialog")).toHaveFocus();
  });

  it("'Keep' cancels a move: the well stays in its project", async () => {
    let patched: Record<string, unknown> | null = null;
    server.use(
      http.patch("/api/projects/:projectId/activities/:activityId", async ({ request }) => {
        patched = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ...ACTIVITY, ...patched });
      }),
    );
    open(ACTIVITY);
    await userEvent.click(screen.getByRole("button", { name: "Move to another project" }));
    const project = screen.getByPlaceholderText("e.g. Bonga Phase 3");
    await userEvent.clear(project);
    await userEvent.type(project, "Somewhere Else");
    await userEvent.click(screen.getByRole("button", { name: "Keep Old Project" }));
    expect(screen.getByTestId("project-readonly")).toHaveTextContent("Old Project");
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(patched).not.toBeNull());
    expect(patched).toMatchObject({ well_project: "Old Project" });
  });

  it("a well with no project can be given one directly", () => {
    open({ ...ACTIVITY, well_project: null } as Activity);
    expect(screen.getByPlaceholderText("e.g. Bonga Phase 3")).toBeEnabled();
    expect(screen.queryByTestId("project-readonly")).not.toBeInTheDocument();
  });
});
