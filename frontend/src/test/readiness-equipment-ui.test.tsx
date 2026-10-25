/**
 * Phase 7 "Equipment checks" in the readiness UI (docs/readiness-framework-spec.md
 * §3.9, §8.8): the grouped, searchable tick list; the team grids' folded
 * category columns with a pinned first column; the All grid's folded
 * categories; the Readiness panel's category sub-sections. A check that is NOT
 * SELECTED carries nothing — blank, never "—", never "Not applicable".
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

import type { Activity } from "@/api/activities";
import type { CatalogCheck, CheckStatus, TeamCheckState, TeamReadiness } from "@/api/readiness";
import { ActivityReadinessPanel } from "@/components/readiness/ActivityReadinessPanel";
import { AllReadinessGrid } from "@/components/readiness/AllReadinessGrid";
import { TeamReadinessGrid } from "@/components/readiness/TeamReadinessGrid";
import { categoryIcons, gridColumns, type GridColumn } from "@/components/readiness/category-columns";
import { CATEGORY_FOLDS_KEY } from "@/components/readiness/category-folds";
import {
  BUILTIN_PROJECT_GATES,
  BUILTIN_TEAMS,
  ReadinessCatalogProvider,
} from "@/components/readiness/catalog";
import { Toaster } from "@/components/ui/toaster";
import { categoryCode, stripChecksOf } from "@/lib/chart-layout";
import { codesLookAlike, lookAlikeCodes } from "@/lib/readiness-categories";
import {
  LBUD,
  LOGISTICS,
  LOGISTICS_CHECKS,
  PID,
  equip,
  equipmentTeam,
  nominated,
  notSelectedCell,
  pcell,
  unticked,
  wcell,
} from "./equipment-fixtures";
import { server } from "./mocks/server";

let ticks: Record<string, unknown>[] = [];
let team: TeamReadiness = equipmentTeam();

beforeEach(() => {
  currentUser = { id: "u1", is_admin: false, teams: ["logistics"] };
  ticks = [];
  team = equipmentTeam();
  try {
    window.localStorage.clear();
  } catch {
    // jsdom always has storage; nothing to clear otherwise
  }
  server.use(
    http.get("/api/readiness/catalog", () =>
      HttpResponse.json({
        teams: [...BUILTIN_TEAMS, LOGISTICS],
        checks: [...BUILTIN_PROJECT_GATES, ...LOGISTICS_CHECKS],
        status_sets: {},
      }),
    ),
    http.get("/api/projects/:projectId/readiness/teams/:team", () => HttpResponse.json(team)),
    http.put("/api/projects/:projectId/readiness/teams/:team/applicability", async ({ request, params }) => {
      ticks.push({ team: params.team, ...((await request.json()) as object) });
      return HttpResponse.json({ project_rows: [], well_rows: [] });
    }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderGrid() {
  return render(
    <MemoryRouter>
      <TeamReadinessGrid projectId={PID} teamCode="logistics" />
      <Toaster />
    </MemoryRouter>,
  );
}

const rowOf = (region: HTMLElement, name: string) => within(region).getByText(name).closest("tr")!;
/** A folded category's cell on a row (null when blank). */
const categoryCellOf = (row: HTMLElement, name: string) =>
  row.querySelector<HTMLElement>(`[data-category="${name}"]`);

// ── Look-alike codes ─────────────────────────────────────────────────────────

describe("look-alike codes (spec §3.4)", () => {
  it("CR/CTR, PC/PO and CB/CBG look alike; PSV/DSV don't", () => {
    expect(codesLookAlike("CR", "CTR")).toBe(true);
    expect(codesLookAlike("PC", "PO")).toBe(true);
    expect(codesLookAlike("CB", "CBG")).toBe(true);
    expect(codesLookAlike("CB", "ACB")).toBe(true);
    expect(codesLookAlike("PSV", "DSV")).toBe(false);
    expect(codesLookAlike("NAV", "NAV")).toBe(false);
    expect(codesLookAlike("RW", "NNRA")).toBe(false);
  });

  it("finds them among one lens's codes", () => {
    const found = lookAlikeCodes(LOGISTICS_CHECKS.map((c) => c.code));
    expect(found.has("PC")).toBe(true);
    expect(found.has("PO")).toBe(true);
    expect(found.has("CR")).toBe(true);
    expect(found.has("CTR")).toBe(true);
    expect(found.has("PSV")).toBe(false);
    expect(found.has("DSV")).toBe(false);
  });
});

// ── The tick list (Checks…) ──────────────────────────────────────────────────

describe("the grouped, searchable tick list (spec §8.8)", () => {
  async function openBongaPicker() {
    renderGrid();
    const projects = await screen.findByRole("region", { name: "Field projects" });
    await userEvent.click(within(rowOf(projects, "Bonga Phase 3")).getByRole("button", { name: /^Checks…/ }));
    return screen.findByRole("dialog", { name: "Logistics checks that apply" });
  }

  it("lists the core checks first, then one group per category with 'n of m selected'", async () => {
    const dialog = await openBongaPicker();
    const core = within(dialog).getByRole("list", { name: "Checks" });
    expect(within(core).getAllByRole("checkbox").map((b) => b.getAttribute("aria-label"))).toEqual([
      "L-BUD — Budget Availability",
      "CTR — Contract Availability",
      "PO — Purchase Order",
      "NAV — Naval Clearance",
    ]);
    const groups = within(dialog).getAllByRole("region").map((g) => g.getAttribute("aria-label"));
    expect(groups).toEqual(["Vessels", "Barges", "Lifting"]);
    const vessels = within(dialog).getByRole("region", { name: "Vessels" });
    expect(vessels).toHaveTextContent("2 of 3 selected");
    expect(within(dialog).getByRole("region", { name: "Barges" })).toHaveTextContent("0 of 2 selected");
    // A check that starts unticked reads unticked; the nominated ones ticked.
    expect(within(vessels).getByRole("checkbox", { name: /^DSV/ })).toBeChecked();
    expect(within(vessels).getByRole("checkbox", { name: /^PC/ })).not.toBeChecked();
    // Look-alike codes sit next to their labels.
    expect(within(vessels).getByRole("checkbox", { name: "PC — Personnel Carrier" })).toBeInTheDocument();
  });

  it("a group with nothing selected starts folded; the others open", async () => {
    const dialog = await openBongaPicker();
    expect(within(dialog).getByRole("button", { name: "Fold Vessels" })).toHaveAttribute("aria-expanded", "true");
    expect(within(dialog).getByRole("button", { name: "Unfold Barges" })).toHaveAttribute("aria-expanded", "false");
    expect(within(dialog).queryByRole("checkbox", { name: /^JUB/ })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("checkbox", { name: /^CR —/ })).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Unfold Barges" }));
    expect(within(dialog).getByRole("checkbox", { name: /^JUB/ })).not.toBeChecked();
  });

  it("select all is tri-state, and ticks only what isn't ticked", async () => {
    const dialog = await openBongaPicker();
    const all = within(dialog).getByRole("checkbox", { name: "Select all Vessels" });
    expect(all).toBePartiallyChecked();
    await userEvent.click(all);
    expect(all).toBeChecked();
    expect(within(dialog).getByRole("region", { name: "Vessels" })).toHaveTextContent("3 of 3 selected");
    expect(within(dialog).getByTestId("picker-footer")).toHaveTextContent("1 unsaved change");
    // From all, it unticks all.
    await userEvent.click(all);
    expect(all).not.toBeChecked();
    expect(within(dialog).getByRole("region", { name: "Vessels" })).toHaveTextContent("0 of 3 selected");
    expect(within(dialog).getByTestId("picker-footer")).toHaveTextContent("2 unsaved changes");
    // An empty group's box nominates the lot.
    const barges = within(dialog).getByRole("checkbox", { name: "Select all Barges" });
    expect(barges).not.toBeChecked();
    expect(barges).not.toBePartiallyChecked();
  });

  it("search hides rows but keeps their choices; the footer counts both; Save sends every change", async () => {
    const dialog = await openBongaPicker();
    // Nominate PC, then search for cranes: PC is hidden, its choice kept.
    await userEvent.click(within(dialog).getByRole("checkbox", { name: /^PC/ }));
    await userEvent.type(within(dialog).getByRole("searchbox", { name: "Search checks" }), "crane");
    expect(within(dialog).queryByRole("checkbox", { name: /^PC/ })).not.toBeInTheDocument();
    // Matching groups open while searching, even one folded before.
    expect(within(dialog).getByRole("checkbox", { name: "CBG — Crane Barge" })).toBeInTheDocument();
    expect(within(dialog).getByRole("checkbox", { name: "CR — Crane" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("list", { name: "Checks" })).not.toBeInTheDocument();
    expect(within(dialog).getByTestId("picker-footer")).toHaveTextContent(
      "Showing 2 of 10 · 1 unsaved change",
    );
    await userEvent.click(within(dialog).getByRole("checkbox", { name: "CR — Crane" }));
    expect(within(dialog).getByTestId("picker-footer")).toHaveTextContent(
      "Showing 2 of 10 · 2 unsaved changes",
    );
    // A search by code works too, ignoring case.
    await userEvent.clear(within(dialog).getByRole("searchbox", { name: "Search checks" }));
    await userEvent.type(within(dialog).getByRole("searchbox", { name: "Search checks" }), "psv");
    expect(within(dialog).getAllByRole("checkbox", { name: /—/ }).map((b) => b.getAttribute("aria-label"))).toEqual([
      "PSV — Platform Support Vessel",
    ]);
    await userEvent.clear(within(dialog).getByRole("searchbox", { name: "Search checks" }));
    expect(within(dialog).getByRole("checkbox", { name: /^PC/ })).toBeChecked();
    expect(within(dialog).getByTestId("picker-footer")).toHaveTextContent(/^2 unsaved changes$/);

    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(ticks).toHaveLength(1));
    expect(ticks[0]).toEqual({
      team: "logistics",
      scope: "project",
      well_project: "Bonga Phase 3",
      applies: { PC: true, CR: true },
    });
  });

  it("a search that matches nothing says so", async () => {
    const dialog = await openBongaPicker();
    await userEvent.type(within(dialog).getByRole("searchbox", { name: "Search checks" }), "zzz");
    expect(within(dialog).getByText("No checks match this search.")).toBeInTheDocument();
    expect(within(dialog).getByTestId("picker-footer")).toHaveTextContent("Showing 0 of 10");
  });

  it("only the list scrolls: the header and Save stay outside it; no pagination", async () => {
    const dialog = await openBongaPicker();
    const list = within(dialog).getByTestId("picker-list");
    expect(list.className).toContain("overflow-y-auto");
    expect(dialog.className).toContain("flex-col");
    expect(list).not.toContainElement(within(dialog).getByRole("button", { name: "Save" }));
    expect(list).not.toContainElement(within(dialog).getByRole("searchbox", { name: "Search checks" }));
    expect(within(dialog).queryByRole("button", { name: /next page/i })).not.toBeInTheDocument();
  });

  it("is read-only without the grant: no box — group or row — can be changed", async () => {
    currentUser = { id: "u2", is_admin: false, teams: ["wells"] };
    const dialog = await openBongaPicker();
    for (const box of within(dialog).getAllByRole("checkbox")) expect(box).toBeDisabled();
    expect(within(dialog).queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });

  it("a refused save (403) toasts, changes nothing and keeps the choices", async () => {
    server.use(
      http.put("/api/projects/:projectId/readiness/teams/:team/applicability", () =>
        HttpResponse.json({ detail: "Insufficient role for this action" }, { status: 403 }),
      ),
    );
    const dialog = await openBongaPicker();
    await userEvent.click(within(dialog).getByRole("checkbox", { name: "Select all Vessels" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Insufficient role for this action");
    expect(within(dialog).getByRole("checkbox", { name: /^PC/ })).toBeChecked();
  });
});

// ── The team grid: folded category columns ───────────────────────────────────

describe("team grid — categories fold to one column (spec §8.8)", () => {
  it("core checks are columns; each category is one folded column, its icon the worst type that applies", async () => {
    renderGrid();
    const wells = await screen.findByRole("region", { name: "Wells" });
    const headers = within(wells).getAllByRole("columnheader").map((h) => h.textContent);
    // A folded category is as narrow as a check: its icon and type count — its
    // name is the header button's label (and its hover, and the key's chip).
    expect(headers).toEqual(["Well", "Done", "L-BUD", "CTR", "PO", "NAV", "3", "2", "1"]);
    for (const name of ["Vessels", "Barges", "Lifting"]) {
      expect(within(wells).getByRole("button", { name: `Unfold ${name}` })).toHaveAttribute(
        "title",
        expect.stringMatching(new RegExp(`^${name}: `)),
      );
    }

    const w1 = rowOf(wells, "W-1");
    // Worst first, look-alike codes with their label.
    expect(categoryCellOf(w1, "Vessels")).toHaveAttribute("title", "Vessels (2): PSV Behind · DSV On Track");
    expect(categoryCellOf(w1, "Vessels")).toHaveAttribute("data-status", "Behind");
    expect(categoryCellOf(w1, "Lifting")).toHaveAttribute("title", "Lifting (1): CR (Crane) Completed");
    // Nothing of Barges applies: blank, not "—".
    expect(categoryCellOf(w1, "Barges")).toBeNull();
    // W-2 unticked DSV itself: Vessels reads PSV only; Lifting is blank.
    const w2 = rowOf(wells, "W-2");
    expect(categoryCellOf(w2, "Vessels")).toHaveAttribute("title", "Vessels (1): PSV Behind");
    expect(categoryCellOf(w2, "Lifting")).toBeNull();

    // The field-project row: the spec's own example.
    const projects = screen.getByRole("region", { name: "Field projects" });
    expect(categoryCellOf(rowOf(projects, "Bonga Phase 3"), "Vessels")).toHaveAttribute(
      "title",
      "Vessels (2): PSV Behind · DSV On Track",
    );
  });

  it("a folded category cell is read-only — it opens nothing", async () => {
    renderGrid();
    const wells = await screen.findByRole("region", { name: "Wells" });
    const cell = categoryCellOf(rowOf(wells, "W-1"), "Vessels")!;
    expect(cell.closest("button")).toBeNull();
    expect(within(cell.closest("td")!).queryByRole("button")).not.toBeInTheDocument();
    await userEvent.click(cell);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("unfolding a category shows its types: not selected is blank, not applicable '—'", async () => {
    renderGrid();
    const wells = await screen.findByRole("region", { name: "Wells" });
    await userEvent.click(within(wells).getByRole("button", { name: "Unfold Vessels" }));
    expect(within(wells).getByRole("button", { name: "Fold Vessels" })).toHaveAttribute("aria-expanded", "true");
    const headers = within(wells).getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual(["Well", "Done", "L-BUD", "CTR", "PO", "NAV", "Vessels", "2", "1", "DSV", "PSV", "PC"]);

    const w2 = rowOf(wells, "W-2");
    // DSV: this well's own untick — "Not applicable", marked set on this well.
    expect(within(w2).getByTitle("Not applicable — set on this well")).toBeInTheDocument();
    // PSV follows its field project — an editable dot.
    expect(within(w2).getByTitle("Platform Support Vessel: Behind (from field project)")).toBeInTheDocument();
    // PC is not selected: blank — no "—", no title, nothing to click.
    expect(within(w2).queryByTitle(/Personnel Carrier/)).not.toBeInTheDocument();
    expect(w2.querySelectorAll("[data-not-selected]").length).toBeGreaterThan(0);
    // NAV (unticked on the field project) still reads "—".
    expect(within(w2).getAllByTitle("Not applicable")).toHaveLength(1);

    // An unfolded type is a normal cell: its status menu opens.
    await userEvent.click(within(rowOf(wells, "W-1")).getByTitle("Diving Support Vessel: On Track (from field project)"));
    expect(await screen.findByRole("menu")).toBeInTheDocument();
  });

  it("remembers the fold per browser", async () => {
    const first = renderGrid();
    const wells = await screen.findByRole("region", { name: "Wells" });
    await userEvent.click(within(wells).getByRole("button", { name: "Unfold Lifting" }));
    expect(JSON.parse(window.localStorage.getItem(CATEGORY_FOLDS_KEY) ?? "{}")).toEqual({ logistics: ["Lifting"] });
    first.unmount();

    renderGrid();
    const again = await screen.findByRole("region", { name: "Wells" });
    expect(within(again).getByRole("button", { name: "Fold Lifting" })).toBeInTheDocument();
    expect(within(again).getByRole("button", { name: "Unfold Vessels" })).toBeInTheDocument();
  });

  it("still folds and unfolds when the browser's storage is unavailable or holds junk", async () => {
    window.localStorage.setItem(CATEGORY_FOLDS_KEY, "{not json");
    renderGrid();
    const wells = await screen.findByRole("region", { name: "Wells" });
    expect(within(wells).getByRole("button", { name: "Unfold Vessels" })).toBeInTheDocument();

    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    await userEvent.click(within(wells).getByRole("button", { name: "Unfold Vessels" }));
    expect(within(wells).getByRole("button", { name: "Fold Vessels" })).toBeInTheDocument();
  });

  it("pins the field-project / well column while the grid scrolls sideways", async () => {
    renderGrid();
    const wells = await screen.findByRole("region", { name: "Wells" });
    const pinned = wells.querySelectorAll<HTMLElement>("[data-pinned]");
    // The header cell and one per well row.
    expect(pinned).toHaveLength(3);
    for (const cell of pinned) {
      expect(cell.className).toContain("sticky");
      expect(cell.className).toContain("left-0");
      expect(cell.className).toContain("bg-card");
    }
    const projects = screen.getByRole("region", { name: "Field projects" });
    expect(projects.querySelectorAll("[data-pinned]")).toHaveLength(2);
  });

  it("columns are fixed as on the Project gates page; unfolding raises the floor, so the table scrolls instead of squeezing", async () => {
    renderGrid();
    const wells = await screen.findByRole("region", { name: "Wells" });
    const floorOf = (region: HTMLElement) => region.querySelector<HTMLElement>("[data-grid-floor]")!;
    // 4 core checks + 3 folded categories, after the first column and Done.
    expect(floorOf(wells).style.minWidth).toBe(`${20 + 4.5 + 7 * 3.75}rem`);
    await userEvent.click(within(wells).getByRole("button", { name: "Unfold Vessels" }));
    // Vessels' 3 types replace its one folded column: 2 columns more.
    expect(floorOf(wells).style.minWidth).toBe(`${20 + 4.5 + 9 * 3.75}rem`);
    const projects = screen.getByRole("region", { name: "Field projects" });
    for (const region of [projects, wells]) {
      const table = region.querySelector("table")!;
      expect(table.className).toContain("table-fixed");
      const cols = [...table.querySelectorAll("col")];
      expect(cols[0].style.width).toBe("20rem");
      expect(cols[1].style.width).toBe("4.5rem");
      // The check and category columns share the rest evenly.
      expect(cols.slice(2).every((c) => c.style.width === "")).toBe(true);
      // Every header on one line; the wrapper scrolls sideways.
      for (const th of region.querySelectorAll("th")) expect(th.className).toContain("whitespace-nowrap");
      expect(floorOf(region).parentElement!.className).toContain("overflow-x-auto");
      for (const cell of region.querySelectorAll<HTMLElement>("td[data-pinned]")) {
        // Checks… shares the name's line; the sub-line below takes the full width.
        const button = within(cell).getByRole("button", { name: /^Checks…/ });
        expect(button.className).toContain("whitespace-nowrap");
        const content = cell.firstElementChild as HTMLElement;
        expect(button.parentElement!.parentElement).toBe(content);
        const subLine = content.children[1] as HTMLElement;
        expect(subLine).toHaveTextContent(/activit|Oil Development/);
        expect(subLine).not.toContainElement(button);
      }
    }
  });

  it("the key: Status and Readiness checks, as on the Project gates page — a chip per category, its types on hover", async () => {
    renderGrid();
    await screen.findByRole("region", { name: "Wells" });
    const legend = screen.getByTestId("status-key").closest<HTMLElement>(".rounded-lg")!;
    expect(within(legend).getByText("Status")).toBeInTheDocument();
    expect(within(legend).getByText("Readiness Checks")).toBeInTheDocument();
    // Core checks read as code and label.
    expect(within(legend).getByText("Budget Availability")).toBeInTheDocument();
    const chips = screen.getAllByTestId("category-key");
    expect(chips.map((c) => [within(c).getByText(/^[A-Z][a-z]/).textContent, within(c).getByText(/^\d+$/).textContent])).toEqual([
      ["Vessels", "3"],
      ["Barges", "2"],
      ["Lifting", "1"],
    ]);
    expect(chips.map((c) => c.getAttribute("title"))).toEqual([
      "Vessels: DSV Diving Support Vessel · PSV Platform Support Vessel · PC Personnel Carrier",
      "Barges: JUB Jack-up Barge · CBG Crane Barge",
      "Lifting: CR Crane",
    ]);
    // Screen readers get the types too; nothing spells them out on screen.
    expect(chips[0].querySelector(".sr-only")).toHaveTextContent("DSV Diving Support Vessel, PSV Platform Support Vessel, PC Personnel Carrier");
    expect(within(legend).queryByText("Platform Support Vessel")).not.toBeInTheDocument();
    expect(within(legend).queryByText(/DSV · PSV/)).not.toBeInTheDocument();
  });
});

// ── The Checks… marker ───────────────────────────────────────────────────────

describe("the Checks… marker — exceptions only (spec §8.7, decision 37)", () => {
  /** The marker beside a row's Checks… ("" when there is none). */
  const badgeOf = (region: HTMLElement, name: string) => {
    const button = within(rowOf(region, name)).getByRole("button", { name: /^Checks…/ });
    return button.querySelector('[data-testid="checks-badge"]')?.textContent ?? "";
  };
  /** A field project nobody has touched: core checks apply, types not selected. */
  const untouched = (): Record<string, TeamCheckState> =>
    Object.fromEntries(
      LOGISTICS_CHECKS.map((c) => [c.code, c.applies_by_default === false ? notSelectedCell() : pcell("On Track")]),
    );

  it("an untouched row reads just 'Checks…'; an unticked core check '3 of 4'; nominations apart", async () => {
    team = {
      ...team,
      project_rows: [
        ...team.project_rows,
        { well_project: "Agbami", activity_count: 1, focus_start: "2026-11-01", checks: untouched() },
        {
          well_project: "Erha", activity_count: 1, focus_start: "2026-11-01",
          checks: { ...untouched(), NAV: unticked("On Track") },
        },
      ],
    };
    renderGrid();
    const projects = await screen.findByRole("region", { name: "Field projects" });
    // Untouched: no count at all — not "4 of 10".
    expect(badgeOf(projects, "Agbami")).toBe("");
    expect(within(rowOf(projects, "Agbami")).getByRole("button", { name: /^Checks…/ })).toHaveTextContent(
      /^Checks… for Agbami \(field project\)$/,
    );
    // Only NAV unticked: counted over the four that start ticked.
    expect(badgeOf(projects, "Erha")).toBe("3 of 4");
    // NAV unticked, DSV and PSV nominated.
    expect(badgeOf(projects, "Bonga Phase 3")).toBe("3 of 4 · 2 selected");
    // Wells count what they follow from Bonga, and their own nominations.
    const wells = screen.getByRole("region", { name: "Wells" });
    expect(badgeOf(wells, "W-1")).toBe("3 of 4 · 3 selected");
    expect(badgeOf(wells, "W-2")).toBe("3 of 4 · 1 selected");
  });

  it("a phase 6 team with no equipment reads as before: '5 of 6'", async () => {
    // Definitions as served before migration 039: no category, no default field.
    const phase6 = (code: string, label: string, sort_order: number): CatalogCheck => ({
      code, label, team_code: "logistics", applies_project: true, applies_well: true,
      status_set: "standard", icon_key: "receipt", locks_with_plan: false, sort_order,
    });
    const checks = [
      phase6("L-BUD", "Budget Availability", 10),
      phase6("CTR", "Contract Availability", 20),
      phase6("FFP", "Assurance / FFP Inspection", 30),
      phase6("CTS", "Community Trust and Support", 40),
      phase6("PO", "Purchase Order", 50),
      phase6("NAV", "Naval Clearance", 60),
    ];
    const all = Object.fromEntries(checks.map((c) => [c.code, pcell("On Track")]));
    team = {
      team: LOGISTICS,
      checks,
      locked: false,
      project_rows: [
        { well_project: "Agbami", activity_count: 1, focus_start: "2026-11-01", checks: all },
        {
          well_project: "Erha", activity_count: 1, focus_start: "2026-11-01",
          checks: { ...all, NAV: unticked("On Track") },
        },
      ],
      well_rows: [],
    };
    renderGrid();
    const projects = await screen.findByRole("region", { name: "Field projects" });
    expect(badgeOf(projects, "Agbami")).toBe("");
    expect(badgeOf(projects, "Erha")).toBe("5 of 6");
  });
});

// ── One icon per category ───────────────────────────────────────────────────

describe("a category wears ONE icon across the page (spec §3.9)", () => {
  // Vessels' first type by sort order is well-only and wears its own icon: the
  // Field projects grid shows none of it, yet the category's icon is still its.
  const SUPV: CatalogCheck = {
    ...equip("SUPV", "Supply Vessel", "Vessels", "ship-wheel", 100),
    applies_project: false,
  };
  const FULL = [...LOGISTICS_CHECKS.slice(0, 4), SUPV, ...LOGISTICS_CHECKS.slice(4)];
  const vesselsOf = (columns: GridColumn[]) =>
    columns.find((c): c is Extract<GridColumn, { kind: "category" }> => c.kind === "category" && c.name === "Vessels");

  it("gridColumns keeps the full category's first icon over a filtered list", () => {
    const projectLevel = FULL.filter((c) => c.applies_project);
    expect(categoryIcons(FULL).get("Vessels")).toBe("ship-wheel");
    expect(vesselsOf(gridColumns(projectLevel, null, categoryIcons(FULL)))?.icon_key).toBe("ship-wheel");
    // Given every definition, the first item's icon is the category's anyway.
    expect(vesselsOf(gridColumns(FULL, null))?.icon_key).toBe("ship-wheel");
    // The chart strip agrees.
    expect(stripChecksOf(FULL).find((d) => d.code === categoryCode("Vessels"))?.icon_key).toBe("ship-wheel");
  });

  it("the Field projects grid draws it as the Wells grid and the key do — header and folded cells", async () => {
    team = {
      ...team,
      checks: FULL,
      well_rows: team.well_rows.map((r) => ({
        ...r,
        checks: { ...r.checks, SUPV: wcell("On Track", false, "default", "default") },
      })),
    };
    renderGrid();
    const projects = await screen.findByRole("region", { name: "Field projects" });
    const wells = screen.getByRole("region", { name: "Wells" });
    const projectHead = within(projects).getByRole("button", { name: "Unfold Vessels" });
    const wellHead = within(wells).getByRole("button", { name: "Unfold Vessels" });
    expect(projectHead).toHaveAttribute("data-icon", "ship-wheel");
    expect(wellHead).toHaveAttribute("data-icon", "ship-wheel");
    // The drawn icon itself is the same (the chevron is the first svg).
    expect(projectHead.querySelectorAll("svg")[1].innerHTML).toBe(wellHead.querySelectorAll("svg")[1].innerHTML);
    const projectCell = categoryCellOf(rowOf(projects, "Bonga Phase 3"), "Vessels")!;
    const wellCell = categoryCellOf(rowOf(wells, "W-1"), "Vessels")!;
    expect(projectCell).toHaveAttribute("data-icon", "ship-wheel");
    expect(wellCell).toHaveAttribute("data-icon", "ship-wheel");
    expect(projectCell.querySelector("svg")!.innerHTML).toBe(wellCell.querySelector("svg")!.innerHTML);
    // The header's title still names only the types this grid shows.
    expect(projectHead.getAttribute("title")).not.toContain("SUPV");
    const key = screen.getAllByTestId("category-key").find((e) => e.textContent?.startsWith("Vessels"));
    expect(key).toHaveAttribute("data-icon", "ship-wheel");
  });
});

// ── The All grid ─────────────────────────────────────────────────────────────

describe("All grid — an expanded team folds its categories (spec §8.8)", () => {
  const act = (id: string, well_name: string): Activity =>
    ({
      id, activity_type: "Oil Development", start_date: "2026-11-01", end_date: "2027-01-01",
      well_name, well_project: "Bonga Phase 3", rig_name: "Rig A", location: "SWAMP",
      readiness_required: true, completed_at: null,
    }) as Activity;
  const st = (status: CheckStatus) => ({ status, notes: null, updated_at: null });

  beforeEach(() => {
    server.use(
      http.get("/api/projects/:projectId/activities", () => HttpResponse.json([act("a1", "W-1"), act("a2", "W-2")])),
      http.get("/api/projects/:projectId/readiness", () =>
        HttpResponse.json([
          {
            well_project: "Bonga Phase 3", activity_count: 2,
            checks: Object.fromEntries(BUILTIN_PROJECT_GATES.map((g) => [g.code, st("Completed")])),
          },
        ]),
      ),
    );
  });

  it("shows core checks as columns and each category as one read-only column", async () => {
    render(
      <MemoryRouter>
        <ReadinessCatalogProvider>
          <AllReadinessGrid projectId={PID} onOpenLens={vi.fn()} />
        </ReadinessCatalogProvider>
      </MemoryRouter>,
    );
    await userEvent.click(await screen.findByRole("button", { name: "Unfold Logistics" }));
    const table = screen.getByRole("table");
    const sub = within(table).getAllByRole("row")[1];
    // The Project gates (expanded: they're this user's default lens), then
    // Logistics: its core checks, then one column per category.
    expect(within(sub).getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      ...BUILTIN_PROJECT_GATES.map((g) => g.code),
      "L-BUD",
      "CTR",
      "PO",
      "NAV",
      // Each category: its icon and count on screen, its name for screen readers.
      "Vessels3",
      "Barges2",
      "Lifting1",
    ]);
    // Headers stay on one line ("L-BUD", not "L-" / "BUD"): the table scrolls instead.
    for (const th of table.querySelectorAll("th")) expect(th.className).toContain("whitespace-nowrap");
    const w1 = within(table).getByText("W-1").closest("tr")!;
    expect(categoryCellOf(w1, "Vessels")).toHaveAttribute("title", "Vessels (2): PSV Behind · DSV On Track");
    expect(categoryCellOf(w1, "Lifting")).toHaveAttribute("title", "Lifting (1): CR (Crane) Completed");
    expect(categoryCellOf(w1, "Barges")).toBeNull();
    // NAV doesn't apply because of a row: "—"; nothing opens a menu here.
    expect(within(w1).getByTitle("Naval Clearance: Not applicable")).toHaveTextContent("—");
    expect(within(w1).queryByRole("button")).not.toBeInTheDocument();
  });

  it("the folded team badge is the worst of everything that applies, types included", async () => {
    currentUser = { id: "u1", is_admin: false, teams: [] };
    render(
      <MemoryRouter>
        <ReadinessCatalogProvider>
          <AllReadinessGrid projectId={PID} onOpenLens={vi.fn()} />
        </ReadinessCatalogProvider>
      </MemoryRouter>,
    );
    await screen.findByRole("button", { name: "Unfold Logistics" });
    const w1 = await waitFor(() => {
      const row = screen.getByText("W-1").closest("tr")!;
      expect(within(row).getByLabelText(/^Logistics:/)).toBeInTheDocument();
      return row;
    });
    // PSV Behind wins; the not-selected types are neither counted nor named:
    // six checks apply (L-BUD, CTR, PO, DSV, PSV, CR), two of them done.
    const badge = within(w1).getByLabelText(/^Logistics:/);
    // Its summary line names types, as the All lens's does (spec §8.8), and
    // words a look-alike code with its label (§3.4) — CTR looks like CR, PO
    // like PC, judged over the team's full checks as the team lens does.
    expect(badge.getAttribute("title")).toBe(
      "Logistics: 2 of 6 done · Behind: PSV · On Track: CTR (Contract Availability), PO (Purchase Order), DSV",
    );
    expect(badge.querySelector("svg")!.getAttribute("class")).toContain("text-red-500");
  });
});

// ── The Readiness panel ──────────────────────────────────────────────────────

describe("Readiness panel — category sub-sections (spec §8.8)", () => {
  const ACTIVITY = {
    id: "a1", activity_type: "Oil Development", start_date: "2026-11-01", end_date: "2027-01-15",
    well_name: "W-1", well_project: "Bonga Phase 3", rig_name: "Rig A", location: "SWAMP",
    readiness_required: true, completed_at: null,
  } as unknown as Activity;
  const st = (status: CheckStatus) => ({ status, notes: null, updated_at: null });

  beforeEach(() => {
    server.use(
      http.get("/api/projects/:projectId/readiness", () =>
        HttpResponse.json([
          {
            well_project: "Bonga Phase 3", activity_count: 2,
            checks: Object.fromEntries(BUILTIN_PROJECT_GATES.map((g) => [g.code, st("On Track")])),
          },
        ]),
      ),
    );
  });

  function renderPanel() {
    return render(
      <ReadinessCatalogProvider>
        <ActivityReadinessPanel
          projectId={PID}
          activity={ACTIVITY}
          canEditProjectGates={false}
          open
          onOpenChange={vi.fn()}
        />
      </ReadinessCatalogProvider>,
    );
  }

  it("folds each category to 'Vessels · 2 selected · 1 behind'; core rows stay as they are", async () => {
    renderPanel();
    const logistics = await screen.findByRole("region", { name: "Logistics" });
    await within(logistics).findByText("Budget Availability");
    const vessels = within(logistics).getByRole("button", { name: "Vessels · 2 selected · 1 behind" });
    expect(vessels).toHaveAttribute("aria-expanded", "false");
    expect(within(logistics).getByRole("button", { name: "Lifting · 1 selected" })).toBeInTheDocument();
    // Barges has nothing selected here: no sub-section at all.
    expect(within(logistics).queryByRole("button", { name: /^Barges/ })).not.toBeInTheDocument();
    expect(within(logistics).queryByText("Platform Support Vessel")).not.toBeInTheDocument();

    await userEvent.click(vessels);
    expect(vessels).toHaveAttribute("aria-expanded", "true");
    const group = within(logistics).getByRole("rowgroup", { name: "Vessels" });
    expect(within(group).getByText("Platform Support Vessel")).toBeInTheDocument();
    expect(within(group).getByText("Diving Support Vessel")).toBeInTheDocument();
    // Never the not-selected type.
    expect(within(group).queryByText("Personnel Carrier")).not.toBeInTheDocument();
  });

  it("'Not applicable (N)' lists only checks a row unticked — never one that is not selected", async () => {
    renderPanel();
    const logistics = await screen.findByRole("region", { name: "Logistics" });
    await within(logistics).findByText("Budget Availability");
    const toggle = within(logistics).getByRole("button", { name: "Not applicable (1)" });
    await userEvent.click(toggle);
    const list = within(logistics).getByRole("list", { name: "Not applicable" });
    expect(within(list).getByText("Naval Clearance")).toBeInTheDocument();
    expect(within(list).queryByText(/Personnel Carrier|Jack-up Barge|Crane Barge/)).not.toBeInTheDocument();
    // …and the not-selected types aren't On Track rows either.
    expect(within(logistics).queryByText("Personnel Carrier")).not.toBeInTheDocument();
    expect(within(logistics).queryByText("Jack-up Barge")).not.toBeInTheDocument();
  });

  it("the field-project column is blank where the field project didn't select the type", async () => {
    renderPanel();
    const logistics = await screen.findByRole("region", { name: "Logistics" });
    await userEvent.click(await within(logistics).findByRole("button", { name: "Lifting · 1 selected" }));
    const row = within(logistics).getByText("Crane").closest("tr")!;
    const [, wellCell, projectCell] = within(row).getAllByRole("cell");
    // This well ticked CR itself; Bonga didn't — blank there, not "—".
    expect(within(wellCell).getByTitle("Crane: Completed")).toBeInTheDocument();
    expect(projectCell).not.toHaveTextContent("—");
    expect(projectCell.querySelector("[data-not-selected]")).not.toBeNull();
    expect(within(projectCell).queryByTitle(/Not applicable/)).not.toBeInTheDocument();
  });

  // A project-only type: it carries nothing on a well with no field project
  // (§7.12) — the backend serves no cell for it there.
  const PRMT: CatalogCheck = { ...equip("PRMT", "Site Permit", "Permits", "radiation", 130), applies_well: false };

  it("a categorised type with no cell here makes no sub-section and is never 'selected'", async () => {
    const lone = { ...ACTIVITY, well_name: "W-9", well_project: null } as unknown as Activity;
    team = {
      team: LOGISTICS,
      checks: [LBUD, PRMT],
      locked: false,
      project_rows: [],
      well_rows: [
        {
          well_project: "", well_name: "W-9", activity_type: "Oil Development", activity_count: 1,
          location: "SWAMP", start_date: "2026-11-01", focus_start: "2026-11-01",
          checks: { "L-BUD": wcell("On Track", true, "default", "default") },
        },
      ],
    };
    render(
      <ReadinessCatalogProvider>
        <ActivityReadinessPanel projectId={PID} activity={lone} canEditProjectGates={false} open onOpenChange={vi.fn()} />
      </ReadinessCatalogProvider>,
    );
    const logistics = await screen.findByRole("region", { name: "Logistics" });
    await within(logistics).findByText("Budget Availability");
    expect(within(logistics).queryByRole("rowgroup", { name: "Permits" })).not.toBeInTheDocument();
    expect(within(logistics).queryByText(/Permits · \d+ selected/)).not.toBeInTheDocument();
    expect(within(logistics).queryByText("Site Permit")).not.toBeInTheDocument();
    // Nor "Not applicable": nothing unticked it — it simply isn't carried here.
    expect(within(logistics).queryByRole("button", { name: /^Not applicable/ })).not.toBeInTheDocument();
  });

  it("…while the same type, nominated by a well's field project, still reads 'Permits · 1 selected'", async () => {
    team = {
      team: LOGISTICS,
      checks: [LBUD, PRMT],
      locked: false,
      project_rows: [
        {
          well_project: "Bonga Phase 3", activity_count: 1, focus_start: "2026-11-01",
          checks: { "L-BUD": pcell("On Track"), PRMT: nominated("Behind") },
        },
      ],
      well_rows: [
        {
          well_project: "Bonga Phase 3", well_name: "W-1", activity_type: "Oil Development", activity_count: 1,
          location: "SWAMP", start_date: "2026-11-01", focus_start: "2026-11-01",
          checks: {
            "L-BUD": wcell("On Track", true, "default", "project"),
            PRMT: wcell("Behind", true, "project", "project"),
          },
        },
      ],
    };
    renderPanel();
    const logistics = await screen.findByRole("region", { name: "Logistics" });
    const permits = await within(logistics).findByRole("button", { name: "Permits · 1 selected · 1 behind" });
    await userEvent.click(permits);
    const group = within(logistics).getByRole("rowgroup", { name: "Permits" });
    expect(within(group).getByText("Site Permit")).toBeInTheDocument();
  });
});
