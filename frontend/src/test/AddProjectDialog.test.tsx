import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { http, HttpResponse } from "msw";

vi.mock("@/lib/auth", () => ({
  getAccessToken: async () => "test-token",
  msalInstance: { getAllAccounts: () => [], logoutRedirect: vi.fn() },
  loginRequest: {},
}));

import type { ProjectWellsPlan } from "@/api/activities";
import { AddProjectDialog } from "@/components/data-grid/AddProjectDialog";
import { server } from "./mocks/server";

const PID = "cccccccc-0000-0000-0000-000000000001";

function plan(over: Partial<ProjectWellsPlan> = {}): ProjectWellsPlan {
  return {
    wells: [
      { well_name: "B4-1", activity_type: "Oil Development", rig_name: "Rig A", hwu_name: null,
        start_date: "2027-01-01", end_date: "2027-03-18", duration_days: 76, gap_before_days: 0, gap_kind: "none" },
      { well_name: "B4-2", activity_type: "Oil Development", rig_name: "Rig A", hwu_name: null,
        start_date: "2027-04-01", end_date: "2027-06-16", duration_days: 76, gap_before_days: 14, gap_kind: "inter_well" },
    ],
    conflicts: [],
    created: 0,
    ...over,
  };
}

function capture(response: (dryRun: boolean) => ProjectWellsPlan) {
  const calls: Record<string, unknown>[] = [];
  server.use(
    http.post("/api/projects/:projectId/activities/project-wells", async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      calls.push(body);
      return HttpResponse.json(response(body.dry_run as boolean));
    }),
  );
  return calls;
}

async function openAndFill() {
  await userEvent.click(screen.getByRole("button", { name: /add project/i }));
  const dialog = await screen.findByRole("dialog");
  await userEvent.type(within(dialog).getByLabelText("Project *"), "Bonga Phase 4");
  await userEvent.type(within(dialog).getByLabelText("Start date *"), "2027-01-01");
  await userEvent.selectOptions(within(dialog).getByLabelText("Location *"), "SWAMP");
  await userEvent.selectOptions(within(dialog).getByLabelText("Plan type *"), "Firm");
  await userEvent.selectOptions(within(dialog).getByLabelText("Risk *"), "No Flood Risk");
  await userEvent.type(within(dialog).getByLabelText("Well 1 name"), "B4-1");
  await userEvent.type(within(dialog).getByLabelText("Well 1 activity"), "Oil Development");
  await userEvent.type(within(dialog).getByLabelText("Well 1 resource name"), "Rig A");
  // "Add well" copies the previous well's activity, rig and duration.
  await userEvent.click(within(dialog).getByRole("button", { name: /add well/i }));
  expect(within(dialog).getByLabelText("Well 2 activity")).toHaveValue("Oil Development");
  expect(within(dialog).getByLabelText("Well 2 resource name")).toHaveValue("Rig A");
  await userEvent.type(within(dialog).getByLabelText("Well 2 name"), "B4-2");
  return dialog;
}

describe("AddProjectDialog", () => {
  it("checks the form before calling the server", async () => {
    const calls = capture(() => plan());
    render(<AddProjectDialog projectId={PID} onCreated={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /add project/i }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Preview" }));
    const alert = within(dialog).getByRole("alert");
    expect(alert).toHaveTextContent("Project name is required.");
    expect(alert).toHaveTextContent("Well 1: name is required.");
    expect(calls).toHaveLength(0);
    expect(within(dialog).getByRole("button", { name: "Create" })).toBeDisabled();
  });

  it("previews the dates, then creates every well in one call", async () => {
    const calls = capture((dryRun) => plan({ created: dryRun ? 0 : 2 }));
    const onCreated = vi.fn();
    render(<AddProjectDialog projectId={PID} onCreated={onCreated} existingProjects={["Bonga Phase 3"]} />);
    const dialog = await openAndFill();

    await userEvent.click(within(dialog).getByRole("button", { name: "Preview" }));
    const preview = await within(dialog).findByRole("region", { name: "Preview" });
    expect(within(preview).getByText("2 wk after previous well")).toBeInTheDocument();
    expect(calls[0]).toMatchObject({
      dry_run: true,
      well_project: "Bonga Phase 4",
      location: "SWAMP",
      wells: [
        { well_name: "B4-1", activity_type: "Oil Development", resource_type: "rig", resource_name: "Rig A", duration_months: 2.5 },
        { well_name: "B4-2", activity_type: "Oil Development", resource_type: "rig", resource_name: "Rig A", duration_months: 2.5 },
      ],
    });

    await userEvent.click(within(dialog).getByRole("button", { name: "Create 2 wells" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(calls[1]).toMatchObject({ dry_run: false, well_project: "Bonga Phase 4" });
  });

  it("any edit after a preview asks for a fresh one", async () => {
    capture(() => plan());
    render(<AddProjectDialog projectId={PID} onCreated={vi.fn()} />);
    const dialog = await openAndFill();
    await userEvent.click(within(dialog).getByRole("button", { name: "Preview" }));
    await within(dialog).findByRole("region", { name: "Preview" });

    await userEvent.clear(within(dialog).getByLabelText("Well 2 duration in months"));
    await userEvent.type(within(dialog).getByLabelText("Well 2 duration in months"), "3");
    expect(within(dialog).queryByRole("region", { name: "Preview" })).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Create" })).toBeDisabled();
  });

  it("warns about clashes with work already on the rig", async () => {
    capture(() =>
      plan({ conflicts: [{ well_name: "B4-1", resource: "Rig A", clashes_with: "OLD-7", overlap_days: 12 }] }),
    );
    render(<AddProjectDialog projectId={PID} onCreated={vi.fn()} />);
    const dialog = await openAndFill();
    await userEvent.click(within(dialog).getByRole("button", { name: "Preview" }));
    expect(await within(dialog).findByText("B4-1 overlaps OLD-7 on Rig A by 12 days")).toBeInTheDocument();
  });

  it("is disabled while the plan is locked", () => {
    render(<AddProjectDialog projectId={PID} onCreated={vi.fn()} locked />);
    expect(screen.getByRole("button", { name: /add project/i })).toBeDisabled();
  });
});
