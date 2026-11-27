import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { http, HttpResponse } from "msw";

vi.mock("@/lib/auth", () => ({
  getAccessToken: async () => "test-token",
  msalInstance: { getAllAccounts: () => [], logoutRedirect: vi.fn() },
  loginRequest: {},
}));

import { ActivityFormDialog } from "@/components/data-grid/ActivityFormDialog";
import { server } from "./mocks/server";

const PID = "cccccccc-0000-0000-0000-000000000001";

async function fillRequired(dialog: HTMLElement) {
  await userEvent.type(within(dialog).getByLabelText("Activity Type *"), "Oil Development");
  await userEvent.type(within(dialog).getByLabelText("Start Date *"), "2026-11-01");
  await userEvent.type(within(dialog).getByLabelText("End Date *"), "2027-02-15");
  await userEvent.type(within(dialog).getByLabelText("Well Name *"), "W-9");
  await userEvent.click(within(dialog).getByLabelText("No resource needed"));
  await userEvent.selectOptions(within(dialog).getByLabelText("Location *"), "SWAMP");
  await userEvent.selectOptions(within(dialog).getByLabelText("Plan Type *"), "Firm");
  await userEvent.selectOptions(within(dialog).getByLabelText("Risk *"), "No Flood Risk");
}

function captureCreate() {
  const sent: { body: Record<string, unknown> | null } = { body: null };
  server.use(
    http.post("/api/projects/:projectId/activities", async ({ request }) => {
      sent.body = (await request.json()) as Record<string, unknown>;
      return HttpResponse.json({ id: "new", ...sent.body }, { status: 201 });
    }),
  );
  return sent;
}

describe("Add Activity — Project field", () => {
  it("suggests the campaign's existing projects and sends the chosen one", async () => {
    const sent = captureCreate();
    const onCreated = vi.fn();
    render(
      <ActivityFormDialog
        projectId={PID}
        onCreated={onCreated}
        existingProjects={["Bonga Phase 3", "Egina North", "Bonga Phase 3", "P-10", "P-2"]}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /add activity/i }));
    const dialog = await screen.findByRole("dialog");

    const project = within(dialog).getByLabelText("Project");
    const options = [...document.querySelectorAll("#add-project-suggestions option")].map(
      (o) => (o as HTMLOptionElement).value,
    );
    // De-duplicated, in natural order (P-2 before P-10).
    expect(options).toEqual(["Bonga Phase 3", "Egina North", "P-2", "P-10"]);

    await userEvent.type(project, "  Bonga Phase 3 ");
    await fillRequired(dialog);
    await userEvent.click(within(dialog).getByRole("button", { name: /^add activity$/i }));

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(sent.body).toMatchObject({ well_name: "W-9", well_project: "Bonga Phase 3" });
  });

  it("leaves the project empty when none is given", async () => {
    const sent = captureCreate();
    render(<ActivityFormDialog projectId={PID} onCreated={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /add activity/i }));
    const dialog = await screen.findByRole("dialog");
    await fillRequired(dialog);
    await userEvent.click(within(dialog).getByRole("button", { name: /^add activity$/i }));
    await waitFor(() => expect(sent.body).not.toBeNull());
    expect(sent.body?.well_project).toBeNull();
  });
});

// The form's rules (zod schema + resolver). Kept here so an upgrade of either
// package can't quietly change what the form accepts or says.
describe("Add Activity — what the form refuses", () => {
  async function openDialog() {
    const sent = captureCreate();
    render(<ActivityFormDialog projectId={PID} onCreated={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /add activity/i }));
    return { sent, dialog: await screen.findByRole("dialog") };
  }

  it("names every missing field, asks for a resource, and sends nothing", async () => {
    const { sent, dialog } = await openDialog();
    await userEvent.click(within(dialog).getByRole("button", { name: /^add activity$/i }));

    // Activity type, start, end, well name, location, plan type, risk.
    await waitFor(() => expect(within(dialog).getAllByText("Required")).toHaveLength(7));
    expect(
      within(dialog).getByText("Required — or tick “No resource needed”"),
    ).toBeInTheDocument();
    expect(sent.body).toBeNull();
  });

  it("refuses an end date before the start date", async () => {
    const { sent, dialog } = await openDialog();
    await fillRequired(dialog);
    const end = within(dialog).getByLabelText("End Date *");
    await userEvent.clear(end);
    await userEvent.type(end, "2026-10-01"); // start is 2026-11-01
    await userEvent.click(within(dialog).getByRole("button", { name: /^add activity$/i }));

    expect(
      await within(dialog).findByText("End date must be on or after start date"),
    ).toBeInTheDocument();
    expect(within(dialog).queryByText("Required")).not.toBeInTheDocument();
    expect(sent.body).toBeNull();
  });

  it("refuses a project name over 256 characters", async () => {
    const { sent, dialog } = await openDialog();
    await fillRequired(dialog);
    await userEvent.click(within(dialog).getByLabelText("Project"));
    await userEvent.paste("x".repeat(257));
    await userEvent.click(within(dialog).getByRole("button", { name: /^add activity$/i }));

    expect(await within(dialog).findByText("At most 256 characters")).toBeInTheDocument();
    expect(sent.body).toBeNull();
  });
});
