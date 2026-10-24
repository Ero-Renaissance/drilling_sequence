/**
 * Phase 7 on the Admin page (docs/readiness-framework-spec.md §3.9, §5.1,
 * §8.8): a check's Category (free text, suggesting the team's existing ones)
 * and "Starts unticked" (fixed after creation), both hidden for a check that
 * locks with the plan; the category stays editable; each team's list is
 * grouped by category. The server stays the authority (422 shown as sent).
 */
import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({
  getAccessToken: async () => "test-token",
  msalInstance: { getAllAccounts: () => [], logoutRedirect: vi.fn() },
  loginRequest: {},
}));

const createCheck = vi.fn();
const updateCheck = vi.fn();
vi.mock("@/api/admin", () => ({
  adminApi: {
    createCheck: (body: unknown) => createCheck(body),
    updateCheck: (code: string, body: unknown) => updateCheck(code, body),
    retireCheck: vi.fn(),
    restoreCheck: vi.fn(),
    updateTeam: vi.fn(),
    createTeam: vi.fn(),
  },
}));

import type { AdminReadinessCatalog } from "@/api/admin";
import { ReadinessCatalogAdmin } from "@/components/admin/ReadinessCatalogAdmin";
import { BUILTIN_PROJECT_GATES } from "@/components/readiness/catalog";
import { LOGISTICS_CHECKS } from "./equipment-fixtures";

function catalog(): AdminReadinessCatalog {
  return {
    teams: [
      { code: "projects", name: "Projects", editor_source: "planner", icon_key: "land-plot", sort_order: 0, is_active: true },
      { code: "logistics", name: "Logistics", editor_source: "team_grant", icon_key: "truck", sort_order: 20, is_active: true },
    ],
    checks: [...BUILTIN_PROJECT_GATES, ...LOGISTICS_CHECKS].map((c) => ({
      ...c,
      retired_at: null,
      withdrawn: false,
    })),
    status_sets: {
      standard: {
        statuses: [
          { status: "On Track", severity: "in_progress" },
          { status: "Completed", severity: "done" },
          { status: "Behind", severity: "blocked" },
          { status: "N/A", severity: "not_counted" },
        ],
        default: "On Track",
        history_only: false,
      },
    },
    icon_keys: ["land-plot", "truck", "anchor", "container", "construction", "receipt"],
  };
}

const section = (name: string) => screen.getByRole("region", { name: `${name} checks` });

async function openAdd(team: string) {
  fireEvent.click(within(section(team)).getByRole("button", { name: /add check/i }));
  return screen.findByRole("dialog");
}

beforeEach(() => {
  createCheck.mockReset();
  updateCheck.mockReset();
});

describe("Admin — categories and 'starts unticked'", () => {
  it("lists each team's checks grouped by category, core checks first", () => {
    render(<ReadinessCatalogAdmin catalog={catalog()} loading={false} onChanged={vi.fn()} />);
    const logistics = section("Logistics");
    const headers = within(logistics).getAllByTestId("admin-category").map((h) => h.textContent);
    expect(headers).toEqual(["Vessels3 checks", "Barges2 checks", "Lifting1 check"]);
    // Rows in order: the core checks, then each group under its header.
    const rows = within(logistics).getAllByRole("row").slice(1).map((r) => r.querySelector("code")?.textContent ?? r.textContent);
    expect(rows).toEqual([
      "L-BUD", "CTR", "PO", "NAV",
      "Vessels3 checks", "DSV", "PSV", "PC",
      "Barges2 checks", "JUB", "CBG",
      "Lifting1 check", "CR",
    ]);
    // Checks that start unticked say so; the Project gates have no groups.
    const psv = within(logistics).getByText("Platform Support Vessel").closest("tr")!;
    expect(within(psv).getByText("Starts unticked")).toBeInTheDocument();
    expect(within(section("Projects")).queryByTestId("admin-category")).not.toBeInTheDocument();
  });

  it("creates a check with a category that starts unticked, suggesting the team's categories", async () => {
    createCheck.mockResolvedValue({});
    render(<ReadinessCatalogAdmin catalog={catalog()} loading={false} onChanged={vi.fn()} />);
    const dialog = await openAdd("Logistics");
    fireEvent.change(within(dialog).getByLabelText("Code"), { target: { value: "sev" } });
    fireEvent.change(within(dialog).getByLabelText("Label"), { target: { value: "Security Escort Vessel" } });
    fireEvent.click(within(dialog).getByRole("radio", { name: "anchor" }));
    const category = within(dialog).getByLabelText("Category");
    const list = document.getElementById(category.getAttribute("list") ?? "")!;
    expect(Array.from(list.querySelectorAll("option")).map((o) => o.getAttribute("value"))).toEqual([
      "Vessels",
      "Barges",
      "Lifting",
    ]);
    fireEvent.change(category, { target: { value: "  Vessels " } });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /starts unticked/i }));
    fireEvent.click(within(dialog).getByRole("button", { name: /add check/i }));

    await waitFor(() =>
      expect(createCheck).toHaveBeenCalledWith({
        code: "SEV",
        label: "Security Escort Vessel",
        team_code: "logistics",
        applies_project: true,
        applies_well: true,
        status_set: "standard",
        icon_key: "anchor",
        locks_with_plan: false,
        sort_order: 130,
        category: "Vessels",
        applies_by_default: false,
      }),
    );
  });

  it("hides both fields for a check that locks with the plan — and sends neither", async () => {
    createCheck.mockResolvedValue({});
    render(<ReadinessCatalogAdmin catalog={catalog()} loading={false} onChanged={vi.fn()} />);
    // A Project gate always locks with the plan.
    const gateDialog = await openAdd("Projects");
    expect(within(gateDialog).queryByLabelText("Category")).not.toBeInTheDocument();
    expect(within(gateDialog).queryByRole("checkbox", { name: /starts unticked/i })).not.toBeInTheDocument();
    fireEvent.click(within(gateDialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    // A project-level Logistics check set to lock: the fields go, nothing is sent.
    const dialog = await openAdd("Logistics");
    fireEvent.change(within(dialog).getByLabelText("Category"), { target: { value: "Vessels" } });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /starts unticked/i }));
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /^well$/i }));
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /locks with the plan/i }));
    expect(within(dialog).queryByLabelText("Category")).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("checkbox", { name: /starts unticked/i })).not.toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("Code"), { target: { value: "GOV" } });
    fireEvent.change(within(dialog).getByLabelText("Label"), { target: { value: "Governed" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /add check/i }));
    await waitFor(() => expect(createCheck).toHaveBeenCalledTimes(1));
    const body = createCheck.mock.calls[0][0] as Record<string, unknown>;
    expect(body.locks_with_plan).toBe(true);
    expect(body).not.toHaveProperty("category");
    expect(body).not.toHaveProperty("applies_by_default");
  });

  it("shows the server's 422 refusal and keeps the dialog", async () => {
    createCheck.mockRejectedValue(new Error("A check that locks with the plan can't start unticked"));
    render(<ReadinessCatalogAdmin catalog={catalog()} loading={false} onChanged={vi.fn()} />);
    const dialog = await openAdd("Logistics");
    fireEvent.change(within(dialog).getByLabelText("Code"), { target: { value: "SEV" } });
    fireEvent.change(within(dialog).getByLabelText("Label"), { target: { value: "Security Escort Vessel" } });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /starts unticked/i }));
    fireEvent.click(within(dialog).getByRole("button", { name: /add check/i }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "A check that locks with the plan can't start unticked",
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("refuses a category over 64 characters before calling the API", async () => {
    render(<ReadinessCatalogAdmin catalog={catalog()} loading={false} onChanged={vi.fn()} />);
    const dialog = await openAdd("Logistics");
    fireEvent.change(within(dialog).getByLabelText("Code"), { target: { value: "SEV" } });
    fireEvent.change(within(dialog).getByLabelText("Label"), { target: { value: "Security Escort Vessel" } });
    // The input caps typing at 64; a pasted value is checked again on submit.
    fireEvent.change(within(dialog).getByLabelText("Category"), { target: { value: "x".repeat(65) } });
    fireEvent.click(within(dialog).getByRole("button", { name: /add check/i }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Category: at most 64 characters.");
    expect(createCheck).not.toHaveBeenCalled();
  });

  it("refuses a category with a semicolon before calling the API, on add and on edit", async () => {
    render(<ReadinessCatalogAdmin catalog={catalog()} loading={false} onChanged={vi.fn()} />);
    let dialog = await openAdd("Logistics");
    fireEvent.change(within(dialog).getByLabelText("Code"), { target: { value: "SEV" } });
    fireEvent.change(within(dialog).getByLabelText("Label"), { target: { value: "Security Escort Vessel" } });
    fireEvent.change(within(dialog).getByLabelText("Category"), { target: { value: "Hire; Lifting" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /add check/i }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Category: can't contain a semicolon (;).");
    expect(createCheck).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: /cancel/i }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    fireEvent.click(within(section("Logistics")).getByRole("button", { name: "Edit PSV" }));
    dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Category"), { target: { value: "Vessels; hire" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Category: can't contain a semicolon (;).");
    expect(updateCheck).not.toHaveBeenCalled();
  });

  it("the edit form lets the category change — 'starts unticked' is shown, fixed", async () => {
    updateCheck.mockResolvedValue({});
    render(<ReadinessCatalogAdmin catalog={catalog()} loading={false} onChanged={vi.fn()} />);
    fireEvent.click(within(section("Logistics")).getByRole("button", { name: "Edit PSV" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Category")).toHaveValue("Vessels");
    expect(within(dialog).queryByRole("checkbox", { name: /starts unticked/i })).not.toBeInTheDocument();
    expect(dialog).toHaveTextContent("Unticked — applies only where a team ticks it");

    fireEvent.change(within(dialog).getByLabelText("Category"), { target: { value: "Marine" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(updateCheck).toHaveBeenCalledWith("PSV", {
        label: "Platform Support Vessel",
        icon_key: "anchor",
        sort_order: 105,
        category: "Marine",
      }),
    );
  });

  it("an edit that leaves the category alone doesn't send it; clearing it sends ''", async () => {
    updateCheck.mockResolvedValue({});
    render(<ReadinessCatalogAdmin catalog={catalog()} loading={false} onChanged={vi.fn()} />);
    fireEvent.click(within(section("Logistics")).getByRole("button", { name: "Edit CR" }));
    let dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Label"), { target: { value: "Crane (mobile)" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(updateCheck).toHaveBeenCalledTimes(1));
    expect(updateCheck.mock.calls[0][1]).not.toHaveProperty("category");

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    fireEvent.click(within(section("Logistics")).getByRole("button", { name: "Edit CR" }));
    dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Category"), { target: { value: "" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(updateCheck).toHaveBeenCalledTimes(2));
    expect(updateCheck.mock.calls[1][1]).toMatchObject({ category: "" });
  });

  it("a Project gate's edit form has no category", async () => {
    render(<ReadinessCatalogAdmin catalog={catalog()} loading={false} onChanged={vi.fn()} />);
    fireEvent.click(within(section("Projects")).getByRole("button", { name: "Edit FDP" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByLabelText("Category")).not.toBeInTheDocument();
    expect(dialog).toHaveTextContent("Only the label, icon and order can change.");
  });
});
