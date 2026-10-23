import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({
  getAccessToken: async () => "test-token",
  msalInstance: { getAllAccounts: () => [], logoutRedirect: vi.fn() },
  loginRequest: {},
}));

const createCheck = vi.fn();
const retireCheck = vi.fn();
const restoreCheck = vi.fn();
const updateTeam = vi.fn();
const createTeam = vi.fn();
vi.mock("@/api/admin", () => ({
  adminApi: {
    createCheck: (body: unknown) => createCheck(body),
    retireCheck: (code: string) => retireCheck(code),
    restoreCheck: (code: string) => restoreCheck(code),
    updateTeam: (code: string, body: unknown) => updateTeam(code, body),
    createTeam: (body: unknown) => createTeam(body),
  },
}));

import type { AdminReadinessCatalog } from "@/api/admin";
import { ReadinessCatalogAdmin } from "@/components/admin/ReadinessCatalogAdmin";
import { BUILTIN_PROJECT_GATES } from "@/components/readiness/catalog";

function catalog(): AdminReadinessCatalog {
  return {
    teams: [
      { code: "projects", name: "Projects", editor_source: "planner", icon_key: "land-plot", sort_order: 0, is_active: true },
      { code: "logistics", name: "Logistics", editor_source: "team_grant", icon_key: "banknote", sort_order: 20, is_active: true },
    ],
    checks: [
      ...BUILTIN_PROJECT_GATES.map((c) => ({
        ...c,
        retired_at: c.code === "EIA" ? "2026-10-13T00:00:00Z" : null,
        withdrawn: false,
      })),
    ],
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
    icon_keys: ["land-plot", "banknote", "map-pin"],
  };
}

function section(name: string) {
  return screen.getByRole("region", { name: `${name} checks` });
}

describe("ReadinessCatalogAdmin", () => {
  beforeEach(() => {
    for (const fn of [createCheck, retireCheck, restoreCheck, updateTeam, createTeam]) fn.mockReset();
  });

  it("lists each team's checks, marks retired ones, and protects the project gates team", () => {
    render(<ReadinessCatalogAdmin catalog={catalog()} loading={false} onChanged={vi.fn()} />);
    const projects = section("Projects");
    expect(within(projects).getByText("Field Development Plan")).toBeInTheDocument();
    expect(within(projects).getByText("Retired")).toBeInTheDocument();
    expect(within(projects).getByText("Updated by campaign planners")).toBeInTheDocument();
    // The built-in team can't be deactivated; other teams can.
    expect(within(projects).queryByRole("button", { name: /deactivate/i })).not.toBeInTheDocument();
    expect(within(section("Logistics")).getByRole("button", { name: /deactivate/i })).toBeInTheDocument();
    expect(within(section("Logistics")).getByText("No checks yet.")).toBeInTheDocument();
  });

  it("retires an active check and restores a retired one", async () => {
    const onChanged = vi.fn();
    retireCheck.mockResolvedValue({});
    restoreCheck.mockResolvedValue({});
    render(<ReadinessCatalogAdmin catalog={catalog()} loading={false} onChanged={onChanged} />);
    const fid = screen.getByText("Final Inv. Decision").closest("tr")!;
    fireEvent.click(within(fid).getByRole("button", { name: /retire/i }));
    await waitFor(() => expect(retireCheck).toHaveBeenCalledWith("FID"));
    const eia = screen.getByText("Env. Assessment").closest("tr")!;
    fireEvent.click(within(eia).getByRole("button", { name: /restore/i }));
    await waitFor(() => expect(restoreCheck).toHaveBeenCalledWith("EIA"));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(2));
  });

  it("a new project gate always locks with the plan at project level", async () => {
    render(<ReadinessCatalogAdmin catalog={catalog()} loading={false} onChanged={vi.fn()} />);
    fireEvent.click(within(section("Projects")).getByRole("button", { name: /add check/i }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("checkbox", { name: /locks with the plan/i })).toBeChecked();
    expect(within(dialog).getByRole("checkbox", { name: /locks with the plan/i })).toBeDisabled();
    expect(within(dialog).getByRole("checkbox", { name: /^well$/i })).not.toBeChecked();
    expect(within(dialog).getByRole("checkbox", { name: /^well$/i })).toBeDisabled();
  });

  it("creates a live logistics check at project and well level", async () => {
    const onChanged = vi.fn();
    createCheck.mockResolvedValue({});
    render(<ReadinessCatalogAdmin catalog={catalog()} loading={false} onChanged={onChanged} />);
    fireEvent.click(within(section("Logistics")).getByRole("button", { name: /add check/i }));
    const dialog = await screen.findByRole("dialog");

    // Codes are upper-cased as typed; a well-level check can't lock with the plan.
    fireEvent.change(within(dialog).getByLabelText("Code"), { target: { value: "l-bud" } });
    fireEvent.change(within(dialog).getByLabelText("Label"), {
      target: { value: "Budget Availability" },
    });
    fireEvent.click(within(dialog).getByRole("radio", { name: "banknote" }));
    expect(within(dialog).getByRole("checkbox", { name: /locks with the plan/i })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("button", { name: /add check/i }));

    await waitFor(() =>
      expect(createCheck).toHaveBeenCalledWith({
        code: "L-BUD",
        label: "Budget Availability",
        team_code: "logistics",
        applies_project: true,
        applies_well: true,
        status_set: "standard",
        icon_key: "banknote",
        locks_with_plan: false,
        sort_order: 10,
      }),
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("validates the code before calling the API and shows the server's refusal", async () => {
    createCheck.mockRejectedValue(new Error("That check code is already in use or reserved"));
    render(<ReadinessCatalogAdmin catalog={catalog()} loading={false} onChanged={vi.fn()} />);
    fireEvent.click(within(section("Logistics")).getByRole("button", { name: /add check/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Label"), { target: { value: "Something" } });

    fireEvent.change(within(dialog).getByLabelText("Code"), { target: { value: "X" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /add check/i }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/2–8 upper-case/);
    expect(createCheck).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByLabelText("Code"), { target: { value: "CON" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /add check/i }));
    expect(await within(dialog).findByText(/already in use or reserved/)).toBeInTheDocument();
  });

  // ── Phase 6: Nominated Equipment withdrawn (spec §3.5, §4.4, §8.7) ─────────

  function withHistory(): AdminReadinessCatalog {
    const c = catalog();
    c.checks.push({
      code: "NEQ", label: "Nominated Equipment", team_code: "logistics", applies_project: true,
      applies_well: true, status_set: "availability", icon_key: "banknote", locks_with_plan: false,
      sort_order: 30, tag_list: "equipment", retired_at: "2026-10-23T00:00:00Z", withdrawn: true,
    });
    c.status_sets.availability = {
      statuses: [
        { status: "Pending", severity: "in_progress" },
        { status: "Available", severity: "done" },
        { status: "Not available", severity: "blocked" },
      ],
      default: "Pending",
      history_only: true,
    };
    return c;
  }

  it("a withdrawn check is marked, and can't be restored", () => {
    render(<ReadinessCatalogAdmin catalog={withHistory()} loading={false} onChanged={vi.fn()} />);
    const neq = within(section("Logistics")).getByText("Nominated Equipment").closest("tr")!;
    expect(within(neq).getByText("Withdrawn")).toBeInTheDocument();
    expect(within(neq).queryByRole("button", { name: /restore/i })).not.toBeInTheDocument();
    // A merely retired check still offers Restore.
    const eia = screen.getByText("Env. Assessment").closest("tr")!;
    expect(within(eia).getByRole("button", { name: /restore/i })).toBeInTheDocument();
  });

  it("offers only status sets a new check may use — never a history-only one", async () => {
    render(<ReadinessCatalogAdmin catalog={withHistory()} loading={false} onChanged={vi.fn()} />);
    fireEvent.click(within(section("Logistics")).getByRole("button", { name: /add check/i }));
    const dialog = await screen.findByRole("dialog");
    const select = within(dialog).getByLabelText("Statuses");
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "On Track / Completed / Behind / N/A",
    ]);
    // No tag-list select any more.
    expect(within(dialog).queryByLabelText("Tags")).not.toBeInTheDocument();
  });

  it("deactivates a grant-edited team", async () => {
    updateTeam.mockResolvedValue({});
    render(<ReadinessCatalogAdmin catalog={catalog()} loading={false} onChanged={vi.fn()} />);
    fireEvent.click(within(section("Logistics")).getByRole("button", { name: /deactivate/i }));
    await waitFor(() => expect(updateTeam).toHaveBeenCalledWith("logistics", { is_active: false }));
  });
});
