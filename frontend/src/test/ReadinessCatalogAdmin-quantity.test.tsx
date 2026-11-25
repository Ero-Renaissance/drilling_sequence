/**
 * Equipment quantity on the Admin page (docs/equipment-quantity-spec.md §3.1):
 * "Takes a quantity" is a setting on each check — pre-ticked for a new check
 * when its category's other checks take one, editable afterwards, and hidden
 * for a check that locks with the plan. The server stays the authority.
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
    // As a migrated catalog holds them: the counted categories take a quantity.
    checks: [...BUILTIN_PROJECT_GATES, ...LOGISTICS_CHECKS].map((c) => ({
      ...c,
      takes_quantity: !!c.category,
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

describe("Admin — 'takes a quantity'", () => {
  const box = (dialog: HTMLElement) => within(dialog).getByRole("checkbox", { name: /takes a quantity/i });

  it("marks the checks that take a quantity in each team's list", () => {
    render(<ReadinessCatalogAdmin catalog={catalog()} loading={false} onChanged={vi.fn()} />);
    const logistics = section("Logistics");
    const psv = within(logistics).getByText("Platform Support Vessel").closest("tr")!;
    expect(within(psv).getByText("Quantity")).toBeInTheDocument();
    const po = within(logistics).getByText("Purchase Order").closest("tr")!;
    expect(within(po).queryByText("Quantity")).not.toBeInTheDocument();
  });

  it("a new check follows its category's other checks until the admin chooses", async () => {
    createCheck.mockResolvedValue({});
    render(<ReadinessCatalogAdmin catalog={catalog()} loading={false} onChanged={vi.fn()} />);
    const dialog = await openAdd("Logistics");
    fireEvent.change(within(dialog).getByLabelText("Code"), { target: { value: "SEV" } });
    fireEvent.change(within(dialog).getByLabelText("Label"), { target: { value: "Security Escort Vessel" } });
    // No category yet: not ticked.
    expect(box(dialog)).not.toBeChecked();
    // Vessels' other types are counted: pre-ticked.
    fireEvent.change(within(dialog).getByLabelText("Category"), { target: { value: "Vessels" } });
    expect(box(dialog)).toBeChecked();
    // A category nobody counts: not ticked.
    fireEvent.change(within(dialog).getByLabelText("Category"), { target: { value: "Permits" } });
    expect(box(dialog)).not.toBeChecked();
    fireEvent.change(within(dialog).getByLabelText("Category"), { target: { value: "Vessels" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /add check/i }));
    await waitFor(() => expect(createCheck).toHaveBeenCalledTimes(1));
    expect(createCheck.mock.calls[0][0]).toMatchObject({ code: "SEV", category: "Vessels", takes_quantity: true });
  });

  it("the admin's own choice wins over the category's — either way", async () => {
    createCheck.mockResolvedValue({});
    render(<ReadinessCatalogAdmin catalog={catalog()} loading={false} onChanged={vi.fn()} />);
    let dialog = await openAdd("Logistics");
    fireEvent.change(within(dialog).getByLabelText("Code"), { target: { value: "SEV" } });
    fireEvent.change(within(dialog).getByLabelText("Label"), { target: { value: "Security Escort Vessel" } });
    fireEvent.change(within(dialog).getByLabelText("Category"), { target: { value: "Vessels" } });
    fireEvent.click(box(dialog)); // untick
    fireEvent.click(within(dialog).getByRole("button", { name: /add check/i }));
    await waitFor(() => expect(createCheck).toHaveBeenCalledTimes(1));
    // Not sent: the server's default is "takes none".
    expect(createCheck.mock.calls[0][0]).not.toHaveProperty("takes_quantity");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    // A check with no category can still take one.
    dialog = await openAdd("Logistics");
    fireEvent.change(within(dialog).getByLabelText("Code"), { target: { value: "GEN" } });
    fireEvent.change(within(dialog).getByLabelText("Label"), { target: { value: "Generators" } });
    fireEvent.click(box(dialog));
    fireEvent.click(within(dialog).getByRole("button", { name: /add check/i }));
    await waitFor(() => expect(createCheck).toHaveBeenCalledTimes(2));
    expect(createCheck.mock.calls[1][0]).toMatchObject({ code: "GEN", takes_quantity: true });
    expect(createCheck.mock.calls[1][0]).not.toHaveProperty("category");
  });

  it("stays editable: an edit sends it only when it changed", async () => {
    updateCheck.mockResolvedValue({});
    render(<ReadinessCatalogAdmin catalog={catalog()} loading={false} onChanged={vi.fn()} />);
    fireEvent.click(within(section("Logistics")).getByRole("button", { name: "Edit PSV" }));
    let dialog = await screen.findByRole("dialog");
    expect(box(dialog)).toBeChecked();
    expect(dialog).toHaveTextContent("Turning it off later hides the numbers and keeps them.");
    // Saved untouched: not sent (an edit is audited).
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(updateCheck).toHaveBeenCalledTimes(1));
    expect(updateCheck.mock.calls[0][1]).not.toHaveProperty("takes_quantity");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    fireEvent.click(within(section("Logistics")).getByRole("button", { name: "Edit PSV" }));
    dialog = await screen.findByRole("dialog");
    fireEvent.click(box(dialog));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(updateCheck).toHaveBeenCalledTimes(2));
    expect(updateCheck.mock.calls[1]).toEqual([
      "PSV",
      { label: "Platform Support Vessel", icon_key: "anchor", sort_order: 105, takes_quantity: false },
    ]);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    // A plain check can be given one later.
    fireEvent.click(within(section("Logistics")).getByRole("button", { name: "Edit PO" }));
    dialog = await screen.findByRole("dialog");
    expect(box(dialog)).not.toBeChecked();
    fireEvent.click(box(dialog));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(updateCheck).toHaveBeenCalledTimes(3));
    expect(updateCheck.mock.calls[2][1]).toMatchObject({ takes_quantity: true });
  });

  it("a well execution readiness check has no such setting — on add or on edit", async () => {
    createCheck.mockResolvedValue({});
    render(<ReadinessCatalogAdmin catalog={catalog()} loading={false} onChanged={vi.fn()} />);
    const dialog = await openAdd("Projects");
    expect(within(dialog).queryByRole("checkbox", { name: /takes a quantity/i })).not.toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("Code"), { target: { value: "GOV" } });
    fireEvent.change(within(dialog).getByLabelText("Label"), { target: { value: "Governed" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /add check/i }));
    await waitFor(() => expect(createCheck).toHaveBeenCalledTimes(1));
    expect(createCheck.mock.calls[0][0]).not.toHaveProperty("takes_quantity");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    fireEvent.click(within(section("Projects")).getByRole("button", { name: "Edit FID" }));
    const edit = await screen.findByRole("dialog");
    expect(within(edit).queryByRole("checkbox", { name: /takes a quantity/i })).not.toBeInTheDocument();
  });

  it("shows the server's refusal and keeps the dialog", async () => {
    updateCheck.mockRejectedValue(new Error("A check that locks with the plan takes no quantity"));
    render(<ReadinessCatalogAdmin catalog={catalog()} loading={false} onChanged={vi.fn()} />);
    fireEvent.click(within(section("Logistics")).getByRole("button", { name: "Edit PO" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(box(dialog));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "A check that locks with the plan takes no quantity",
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
