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
        readiness={null}
        allActivities={[ACTIVITY, { ...ACTIVITY, id: "a2", well_project: "Bonga Phase 3" }]}
        open
        onOpenChange={() => {}}
        onSaved={() => {}}
      />,
    );

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
        readiness={null}
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
        readiness={null}
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
