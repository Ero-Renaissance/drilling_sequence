/**
 * Equipment quantity on the Readiness page (docs/equipment-quantity-spec.md §3):
 * a type that takes a quantity shows how many are needed ("×2") in its cell, a
 * folded category the total of its selected types; the number is set from the
 * cell's menu, in "Set for all wells" for a field project, and beside the tick
 * in Checks…. The API stays the authority.
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

type TestUser = { id: string; is_admin: boolean; teams?: string[] };
let currentUser: TestUser | null = null;
vi.mock("@/store/auth", () => ({
  useAuthStore: (selector: (s: { user: TestUser | null }) => unknown) =>
    selector({ user: currentUser }),
}));

import type { TeamReadiness } from "@/api/readiness";
import { ReadinessSheet } from "@/components/readiness/ReadinessSheet";
import { Toaster } from "@/components/ui/toaster";
import {
  MAX_QUANTITY,
  categoryQuantity,
  ownQuantity,
  parseQuantity,
  quantityLabel,
  quantityOf,
} from "@/lib/readiness-quantity";
import { LOGISTICS_CHECKS, PID, equipmentTeam, pcell, wcell } from "./equipment-fixtures";
import { server } from "./mocks/server";

// The fixture's checks as a migrated catalog holds them: the counted
// categories take a quantity.
const CHECKS = LOGISTICS_CHECKS.map((c) => ({ ...c, takes_quantity: !!c.category }));
const PSV = CHECKS.find((c) => c.code === "PSV")!;
const PO = CHECKS.find((c) => c.code === "PO")!;
const VESSELS = CHECKS.filter((c) => c.category === "Vessels");

/** Bonga needs 2 PSVs (its wells repeat that); W-1 has its own DSV number. */
function team(): TeamReadiness {
  const data = equipmentTeam();
  const project = data.project_rows[0];
  const [w1, w2] = data.well_rows;
  return {
    ...data,
    checks: CHECKS,
    project_rows: [
      {
        ...project,
        checks: {
          ...project.checks,
          PSV: { ...project.checks.PSV, quantity: 2, quantity_source: "project" },
        },
      },
    ],
    well_rows: [
      {
        ...w1,
        checks: {
          ...w1.checks,
          PSV: { ...w1.checks.PSV, quantity: 2, quantity_source: "project" },
          DSV: { ...w1.checks.DSV, quantity: 1, quantity_source: "well" },
        },
      },
      {
        ...w2,
        checks: { ...w2.checks, PSV: { ...w2.checks.PSV, quantity: 2, quantity_source: "project" } },
      },
    ],
  };
}

type Call = { kind: "quantity" | "ticks"; code?: string; body: Record<string, unknown> };
let calls: Call[] = [];
let gets = 0;

beforeEach(() => {
  currentUser = { id: "u1", is_admin: false, teams: ["logistics"] };
  calls = [];
  gets = 0;
  window.localStorage.clear();
  server.use(
    http.get("/api/projects/:projectId/readiness/teams/:team", () => {
      gets += 1;
      return HttpResponse.json(team());
    }),
    http.put("/api/projects/:projectId/readiness/:code/quantity", async ({ request, params }) => {
      calls.push({
        kind: "quantity",
        code: String(params.code),
        body: (await request.json()) as Record<string, unknown>,
      });
      return HttpResponse.json({ quantity: null, quantity_source: "default" });
    }),
    http.put("/api/projects/:projectId/readiness/teams/:team/applicability", async ({ request }) => {
      calls.push({ kind: "ticks", body: (await request.json()) as Record<string, unknown> });
      return HttpResponse.json({ project_rows: [], well_rows: [] });
    }),
  );
});

function renderSheet() {
  return render(
    <MemoryRouter>
      <ReadinessSheet projectId={PID} teamCode="logistics" />
      <Toaster />
    </MemoryRouter>,
  );
}

const sheet = () => screen.findByRole("table", { name: "Logistics execution readiness" });
const rowOf = (table: HTMLElement, well: string) => within(table).getByText(well).closest("tr")!;
const W1 = { scope: "well", well_project: "Bonga Phase 3", well_name: "W-1", activity_type: "Oil Development" };
const BONGA = { scope: "project", well_project: "Bonga Phase 3" };

// ── The rules ────────────────────────────────────────────────────────────────

describe("quantity rules", () => {
  it("a field holds a whole number 1–999, nothing, or is invalid", () => {
    expect(parseQuantity("")).toBeNull();
    expect(parseQuantity("  ")).toBeNull();
    expect(parseQuantity("1")).toBe(1);
    expect(parseQuantity(" 12 ")).toBe(12);
    expect(parseQuantity(String(MAX_QUANTITY))).toBe(MAX_QUANTITY);
    for (const bad of ["0", "1000", "-1", "2.5", "1e2", "two", "1 2"]) {
      expect(parseQuantity(bad)).toBe("invalid");
    }
    expect(quantityLabel(3)).toBe("×3");
  });

  it("a cell shows a number only where the check takes one and applies", () => {
    const two = { ...pcell("On Track"), quantity: 2, quantity_source: "project" as const };
    expect(quantityOf(two, PSV)).toBe(2);
    // A check that takes none never shows one, whatever is served.
    expect(quantityOf(two, PO)).toBeNull();
    // Deselected: the number is kept underneath, not shown.
    expect(quantityOf({ ...two, applies: false, applies_source: "project" }, PSV)).toBeNull();
    expect(quantityOf({ ...pcell("On Track") }, PSV)).toBeNull();
    expect(quantityOf(undefined, PSV)).toBeNull();
  });

  it("a number is the target's own only where it was set there", () => {
    expect(ownQuantity({ quantity: 2, quantity_source: "project" }, "project")).toBe(2);
    // A well repeating its field project's number has none of its own.
    expect(ownQuantity({ quantity: 2, quantity_source: "project" }, "well")).toBeNull();
    expect(ownQuantity({ quantity: 1, quantity_source: "well" }, "well")).toBe(1);
    expect(ownQuantity({ quantity: null, quantity_source: "default" }, "well")).toBeNull();
  });

  it("a folded category adds up the numbers of its types that apply on that row", () => {
    const cells = team().well_rows[0].checks; // W-1: PSV ×2 (project), DSV ×1 (own), PC not selected
    expect(categoryQuantity(VESSELS, cells)).toBe(3);
    // W-2 unticked DSV: only PSV counts.
    expect(categoryQuantity(VESSELS, team().well_rows[1].checks)).toBe(2);
    // Nothing stated: no total, not 0.
    expect(categoryQuantity(VESSELS, equipmentTeam().well_rows[0].checks)).toBeNull();
    expect(
      categoryQuantity(VESSELS, { PSV: { ...wcell("On Track", false, "well", "default"), quantity: 9 } }),
    ).toBeNull();
  });
});

// ── The sheet ────────────────────────────────────────────────────────────────

describe("ReadinessSheet — quantity", () => {
  it("a folded category shows the total needed on that row; unfolded, each type its own", async () => {
    renderSheet();
    const table = await sheet();
    const vessels = (well: string) => rowOf(table, well).querySelector<HTMLElement>('[data-category="Vessels"]')!;
    expect(vessels("W-1")).toHaveAttribute("title", "Vessels (2): PSV Behind · DSV On Track — 3 needed");
    expect(vessels("W-1").querySelector("[data-quantity]")).toHaveTextContent("×3");
    expect(vessels("W-2").querySelector("[data-quantity]")).toHaveTextContent("×2");
    // Lifting: CR is selected on W-1 with no number stated — no total.
    const lifting = rowOf(table, "W-1").querySelector<HTMLElement>('[data-category="Lifting"]')!;
    expect(lifting.querySelector("[data-quantity]")).toBeNull();
    expect(screen.getByLabelText("Key")).toHaveTextContent("how many are needed");

    await userEvent.click(within(table).getByRole("button", { name: "Unfold Vessels" }));
    const psv = within(rowOf(table, "W-1")).getByLabelText(/^Platform Support Vessel for W-1/);
    expect(psv).toHaveAccessibleName(/— 2 needed/);
    expect(psv.querySelector("[data-quantity]")).toHaveTextContent("×2");
    const dsv = within(rowOf(table, "W-1")).getByLabelText(/^Diving Support Vessel for W-1/);
    expect(dsv).toHaveAccessibleName(/— 1 needed \(set on this well\)/);
  });

  it("the cell's menu sets a well's own number, and clears it to follow the field project", async () => {
    renderSheet();
    const table = await sheet();
    await userEvent.click(within(table).getByRole("button", { name: "Unfold Vessels" }));
    // PSV on W-1 follows Bonga's 2: the field is empty, the hint says so.
    await userEvent.click(within(rowOf(table, "W-1")).getByLabelText(/^Platform Support Vessel for W-1/));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Quantity (×2)…" }));
    let dialog = await screen.findByRole("dialog", { name: /^Quantity — Platform Support Vessel · W-1/ });
    expect(dialog).toHaveTextContent("Leave it empty to follow its field project (×2)");
    const field = within(dialog).getByLabelText("Quantity");
    expect(field).toHaveValue("");
    // Not a quantity: refused before any request.
    await userEvent.type(field, "0");
    expect(within(dialog).getByRole("alert")).toHaveTextContent("A whole number from 1 to 999");
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
    await userEvent.clear(field);
    await userEvent.type(field, "3");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls).toEqual([{ kind: "quantity", code: "PSV", body: { ...W1, quantity: 3 } }]));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // Saved, then reloaded: a field project's number reaches its wells.
    expect(gets).toBe(2);

    // DSV on W-1 has its own 1: clearing the field sends null.
    await userEvent.click(within(rowOf(await sheet(), "W-1")).getByLabelText(/^Diving Support Vessel for W-1/));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Quantity (×1)…" }));
    dialog = await screen.findByRole("dialog", { name: /^Quantity — Diving Support Vessel · W-1/ });
    expect(within(dialog).getByLabelText("Quantity")).toHaveValue("1");
    await userEvent.clear(within(dialog).getByLabelText("Quantity"));
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls[1]).toEqual({ kind: "quantity", code: "DSV", body: { ...W1, quantity: null } }));
  });

  it("a check that takes no quantity has no such menu item", async () => {
    renderSheet();
    const table = await sheet();
    await userEvent.click(within(rowOf(table, "W-1")).getByLabelText(/^Purchase Order for W-1/));
    const menu = await screen.findByRole("menu");
    expect(within(menu).queryByRole("menuitem", { name: /quantity/i })).not.toBeInTheDocument();
    expect(rowOf(table, "W-1").querySelectorAll("td [data-quantity]")).toHaveLength(1); // Vessels' total only
  });

  it("'Set for all wells' states the field project's number, and clears it", async () => {
    renderSheet();
    await sheet();
    await userEvent.click(screen.getByRole("button", { name: "Set checks for all wells of Bonga Phase 3" }));
    const list = await screen.findByRole("list", { name: "Checks of Bonga Phase 3" });
    // Only types that take a quantity get a field; PSV holds Bonga's 2.
    expect(within(list).queryByLabelText("How many PO for Bonga Phase 3")).not.toBeInTheDocument();
    expect(within(list).getByLabelText("How many PSV for Bonga Phase 3")).toHaveValue("2");
    const dsv = within(list).getByLabelText("How many DSV for Bonga Phase 3");
    expect(dsv).toHaveValue("");
    await userEvent.type(dsv, "4{Enter}");
    await waitFor(() => expect(calls).toEqual([{ kind: "quantity", code: "DSV", body: { ...BONGA, quantity: 4 } }]));
    // Leaving a field unchanged sends nothing; emptying it clears the number.
    const psv = within(await screen.findByRole("list", { name: "Checks of Bonga Phase 3" })).getByLabelText(
      "How many PSV for Bonga Phase 3",
    );
    await userEvent.click(psv);
    await userEvent.tab();
    expect(calls).toHaveLength(1);
    await userEvent.clear(psv);
    await userEvent.tab();
    await waitFor(() => expect(calls[1]).toEqual({ kind: "quantity", code: "PSV", body: { ...BONGA, quantity: null } }));
  });

  it("without the team's grant the numbers show and nothing can change them", async () => {
    currentUser = { id: "u2", is_admin: false, teams: ["wells"] };
    renderSheet();
    const table = await sheet();
    await userEvent.click(within(table).getByRole("button", { name: "Unfold Vessels" }));
    const psv = within(rowOf(table, "W-1")).getByLabelText(/^Platform Support Vessel for W-1/);
    expect(psv.querySelector("[data-quantity]")).toHaveTextContent("×2");
    expect(psv.tagName).not.toBe("BUTTON");
    expect(screen.queryByRole("button", { name: /^Set checks for all wells/ })).not.toBeInTheDocument();
    // Checks… shows the number as text — no field.
    await userEvent.click(screen.getByRole("button", { name: /^Checks… for W-1/ }));
    const dialog = await screen.findByRole("dialog", { name: "Logistics checks that apply" });
    expect(within(dialog).queryByLabelText(/^How many/)).not.toBeInTheDocument();
    const row = within(dialog).getByRole("checkbox", { name: /^PSV/ }).closest("li")!;
    expect(within(row).getByTestId("quantity")).toHaveTextContent("×2");
    expect(calls).toEqual([]);
  });
});

// ── Checks… ─────────────────────────────────────────────────────────────────

describe("Checks… — how many, beside the tick", () => {
  async function open(target: RegExp) {
    renderSheet();
    await sheet();
    await userEvent.click(screen.getByRole("button", { name: target }));
    return screen.findByRole("dialog", { name: "Logistics checks that apply" });
  }

  it("a ticked type that takes a quantity has a number field; others have none", async () => {
    const dialog = await open(/^Checks… for Bonga Phase 3 \(field project\)/);
    expect(within(dialog).getByLabelText("How many PSV")).toHaveValue("2");
    expect(within(dialog).getByLabelText("How many DSV")).toHaveValue("");
    // PC isn't selected: no field until it is ticked. PO takes no quantity.
    expect(within(dialog).queryByLabelText("How many PC")).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText("How many PO")).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("checkbox", { name: /^PC/ }));
    expect(within(dialog).getByLabelText("How many PC")).toHaveValue("");
  });

  it("one Save sends the ticks first, then each number that changed", async () => {
    const dialog = await open(/^Checks… for Bonga Phase 3 \(field project\)/);
    await userEvent.click(within(dialog).getByRole("checkbox", { name: /^PC/ }));
    await userEvent.type(within(dialog).getByLabelText("How many PC"), "5");
    await userEvent.clear(within(dialog).getByLabelText("How many PSV"));
    expect(dialog).toHaveTextContent("3 unsaved changes");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(calls).toEqual([
      { kind: "ticks", body: { ...BONGA, applies: { PC: true } } },
      { kind: "quantity", code: "PSV", body: { ...BONGA, quantity: null } },
      { kind: "quantity", code: "PC", body: { ...BONGA, quantity: 5 } },
    ]);
    // The page reloads for the numbers (a project's number reaches its wells).
    expect(gets).toBe(2);
  });

  it("a number alone is a change: no tick request, just the quantity", async () => {
    const dialog = await open(/^Checks… for W-1/);
    // W-1 follows Bonga's 2 PSVs: the field is empty, hinting what it follows.
    const psv = within(dialog).getByLabelText("How many PSV");
    expect(psv).toHaveValue("");
    expect(psv).toHaveAttribute("placeholder", "2");
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
    await userEvent.type(psv, "1");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(calls).toEqual([{ kind: "quantity", code: "PSV", body: { ...W1, quantity: 1 } }]);
  });

  it("a number that isn't a quantity is refused before anything is sent", async () => {
    const dialog = await open(/^Checks… for Bonga Phase 3 \(field project\)/);
    await userEvent.clear(within(dialog).getByLabelText("How many PSV"));
    await userEvent.type(within(dialog).getByLabelText("How many PSV"), "0");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "PSV: a quantity is a whole number from 1 to 999",
    );
    expect(calls).toEqual([]);
  });

  it("unticking a type leaves its stored number alone", async () => {
    const dialog = await open(/^Checks… for Bonga Phase 3 \(field project\)/);
    await userEvent.click(within(dialog).getByRole("checkbox", { name: /^PSV/ }));
    expect(within(dialog).queryByLabelText("How many PSV")).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(calls).toEqual([{ kind: "ticks", body: { ...BONGA, applies: { PSV: false } } }]);
  });

  it("a refused number is reported; what did save is kept", async () => {
    server.use(
      http.put("/api/projects/:projectId/readiness/:code/quantity", () =>
        HttpResponse.json({ detail: "Insufficient role for this action" }, { status: 403 }),
      ),
    );
    const dialog = await open(/^Checks… for W-1/);
    await userEvent.type(within(dialog).getByLabelText("How many PSV"), "1");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(screen.getByRole("region", { name: "Notifications", hidden: true })).toHaveTextContent(
        "Insufficient role for this action",
      ),
    );
  });
});
