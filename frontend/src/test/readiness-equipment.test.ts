/**
 * Phase 7 "Equipment checks" (docs/readiness-framework-spec.md §3.9, §5.1,
 * §8.4, §8.8): the not-selected rule, the "starts unticked" default in the tick
 * list, categories (grouping, the synthetic strip check per category, the
 * print column count) and the lens / snapshot roll-ups.
 */
import { describe, it, expect, vi } from "vitest";
import { http, HttpResponse } from "msw";

vi.mock("@/lib/auth", () => ({
  getAccessToken: async () => "test-token",
  msalInstance: { getAllAccounts: () => [], logoutRedirect: vi.fn() },
  loginRequest: {},
}));

import type { Activity } from "@/api/activities";
import type {
  CatalogCheck,
  CatalogTeam,
  CheckSource,
  CheckStatus,
  EffectiveCheckState,
  TeamCheckState,
  TeamReadiness,
} from "@/api/readiness";
import { BUILTIN_PROJECT_GATES, BUILTIN_TEAMS, lensChecksOf } from "@/components/readiness/catalog";
import {
  applies,
  appliesByDefault,
  notSelected,
  type ReadinessCell,
} from "@/components/readiness/check-meta";
import type { PrintRow } from "@/components/revisions/RevisionPrintDoc";
import {
  CATEGORY_CODE_PREFIX,
  barStripCodes,
  categoryCell,
  categoryCode,
  categoryStrip,
  iconTier,
  isCategoryCode,
  siblingMarker,
  stripChecksOf,
  stripColumnCount,
  withCategoryCells,
  worstCheck,
} from "@/lib/chart-layout";
import {
  applicabilityBody,
  changedChoices,
  groupTicks,
  groupToggle,
  matchesPickerSearch,
  pickerBadge,
  pickerFooter,
  pickerGroups,
  pickerRows,
} from "@/lib/readiness-applicability";
import { categoriesOf, categoryOf, groupByCategory } from "@/lib/readiness-categories";
import { loadLensReadiness, printedReadiness } from "@/lib/readiness-lens";
import { snapshotRowsForLens } from "@/lib/readiness-snapshot";
import {
  categoryLine,
  categoryPanelLine,
  notApplicableCodesLine,
  notApplicableLine,
  summariseTeam,
  teamDetails,
  teamLine,
} from "@/lib/team-summary";
import { server } from "./mocks/server";

const PID = "cccccccc-0000-0000-0000-000000000001";
const LOGISTICS: CatalogTeam = {
  code: "logistics", name: "Logistics", editor_source: "team_grant", icon_key: "truck", sort_order: 20,
};
const TEAMS = [...BUILTIN_TEAMS, LOGISTICS];

const check = (code: string, over: Partial<CatalogCheck> = {}): CatalogCheck => ({
  code, label: `${code} label`, team_code: "logistics", applies_project: true, applies_well: true,
  status_set: "standard", icon_key: "receipt", locks_with_plan: false, sort_order: 10, ...over,
});

// The seeded Logistics catalog after migration 039 (spec §3.4): six core checks
// (no category, start ticked), then the 21 equipment checks — categorised, each
// wearing its category's icon, starting unticked, sort orders 100 and up.
const CORE = ["L-BUD", "CTR", "FFP", "CTS", "PO", "NAV"].map((code, i) =>
  check(code, { sort_order: 10 * (i + 1), category: "", applies_by_default: true }),
);
const EQUIPMENT_SEED: [string, string, string[]][] = [
  ["Aviation", "helicopter", ["RW"]],
  ["Vessels", "anchor", ["DSV", "SEV", "AHTS", "FSIV", "PSV", "LHT", "TB", "PC"]],
  ["Barges", "container", ["JUB", "ENV", "HB", "CBG", "RP"]],
  ["Land transport", "bus", ["LBT", "FBT", "CB", "ACB", "MB"]],
  ["Lifting", "construction", ["CR"]],
  ["Permits", "radiation", ["NNRA"]],
];
const EQUIPMENT = EQUIPMENT_SEED.flatMap(([category, icon_key, codes]) => codes.map((code) => ({ category, icon_key, code })))
  .map(({ category, icon_key, code }, i) =>
    check(code, { category, icon_key, applies_by_default: false, sort_order: 100 + i }),
  );
const LOGISTICS_CHECKS = [...CORE, ...EQUIPMENT];
const byCode = (code: string) => LOGISTICS_CHECKS.find((c) => c.code === code)!;

/** A live team cell. */
const cell = (
  status: CheckStatus,
  isApplied: boolean,
  appliesSource: CheckSource = "default",
): TeamCheckState => ({ status, notes: null, updated_at: null, applies: isApplied, applies_source: appliesSource });
const wellCell = (
  status: CheckStatus,
  isApplied: boolean,
  appliesSource: CheckSource = "default",
): EffectiveCheckState => ({ ...cell(status, isApplied, appliesSource), source: "default" });

/** A well's cells as the server serves them: every check of the team, the core
 *  ones applying, every equipment type NOT SELECTED except `overrides`. */
function wellCells(overrides: Record<string, EffectiveCheckState> = {}): Record<string, EffectiveCheckState> {
  return Object.fromEntries(
    LOGISTICS_CHECKS.map((c) => [
      c.code,
      overrides[c.code] ??
        (c.applies_by_default === false ? wellCell("On Track", false) : wellCell("On Track", true)),
    ]),
  );
}

describe("notSelected(cell) — a check that starts unticked and reads its default (§3.9)", () => {
  it("is applies: false from the default, and nothing else", () => {
    expect(notSelected({ status: "On Track", applies: false, applies_source: "default" })).toBe(true);
    // Not applicable — a row says so: the target's own, or its field project's.
    expect(notSelected({ status: "On Track", applies: false, applies_source: "well" })).toBe(false);
    expect(notSelected({ status: "On Track", applies: false, applies_source: "project" })).toBe(false);
    // Applies (ticked by default, or nominated).
    expect(notSelected({ status: "On Track", applies: true, applies_source: "default" })).toBe(false);
    expect(notSelected({ status: "Behind", applies: true, applies_source: "project" })).toBe(false);
    // A frozen snapshot cell, a Project gate cell or no cell at all is never "not selected".
    expect(notSelected({ status: "N/A" })).toBe(false);
    expect(notSelected(undefined)).toBe(false);
    expect(notSelected(null)).toBe(false);
  });

  it("applies() is unchanged: it rejects a not-selected cell like any unticked one", () => {
    const psv = byCode("PSV");
    expect(applies({ status: "On Track", applies: false, applies_source: "default" }, psv)).toBe(false);
  });

  it("a definition without applies_by_default starts ticked", () => {
    expect(appliesByDefault({})).toBe(true);
    expect(appliesByDefault({ applies_by_default: true })).toBe(true);
    expect(appliesByDefault({ applies_by_default: false })).toBe(false);
  });
});

describe("team summaries never name a not-selected check (§5.1, §8.8)", () => {
  // W-1 nominated PSV (from its field project) and CR (its own choice); it
  // unticked DSV, which its field project nominated: DSV is "Not applicable".
  // Every other type is not selected.
  const cells = wellCells({
    PSV: wellCell("Behind", true, "project"),
    CR: wellCell("Completed", true, "well"),
    DSV: wellCell("On Track", false, "well"),
    NAV: wellCell("On Track", false, "project"), // a core check unticked by its field project
  });

  it("teamDetails drops the not-selected cells and keeps the ones a row unticked", () => {
    const details = teamDetails(LOGISTICS_CHECKS, cells);
    expect(details.map((d) => d.code)).toEqual(["L-BUD", "CTR", "FFP", "CTS", "PO", "NAV", "DSV", "PSV", "CR"]);
    expect(details.filter((d) => !d.applies).map((d) => d.code)).toEqual(["NAV", "DSV"]);
  });

  it("so 'Not applicable' lists only checks a row unticked — two, not 21", () => {
    const details = teamDetails(LOGISTICS_CHECKS, cells);
    expect(notApplicableLine(details)).toBe("Not applicable: NAV, DSV");
    const summary = summariseTeam(details)!;
    expect(summary.notApplicable.map((d) => d.code)).toEqual(["NAV", "DSV"]);
    // The badge is the worst of everything that applies, types included.
    expect(summary.worst).toBe("Behind");
    expect([summary.done, summary.total]).toEqual([1, 7]);
  });

  it("a target whose cells are all not selected has no details: nothing counted, nothing listed", () => {
    const onlyEquipment = Object.fromEntries(EQUIPMENT.map((c) => [c.code, wellCell("On Track", false)]));
    expect(teamDetails(EQUIPMENT, onlyEquipment)).toEqual([]);
    expect(summariseTeam(teamDetails(EQUIPMENT, onlyEquipment))).toBeUndefined();
  });

  it("a Project gate is never 'not selected' — it has no tick (decision 31)", () => {
    const gate = BUILTIN_PROJECT_GATES[0];
    const odd: ReadinessCell = { status: "N/A", applies: false, applies_source: "default" };
    expect(teamDetails([gate], { [gate.code]: odd })).toHaveLength(1);
  });

  it("caps a 'Not applicable' list at 6 codes plus '+N more'", () => {
    const codes = ["DSV", "SEV", "AHTS", "FSIV", "PSV", "LHT", "TB", "PC"];
    expect(notApplicableCodesLine(codes)).toBe("Not applicable: DSV, SEV, AHTS, FSIV, PSV, LHT · +2 more");
    expect(notApplicableCodesLine(codes.slice(0, 6))).toBe("Not applicable: DSV, SEV, AHTS, FSIV, PSV, LHT");
    expect(notApplicableCodesLine(codes, 2)).toBe("Not applicable: DSV, SEV · +6 more");
    expect(notApplicableCodesLine([])).toBe("");
    const details = codes.map((code) => ({ code, label: code, status: "On Track" as const, applies: false }));
    expect(notApplicableLine(details)).toBe("Not applicable: DSV, SEV, AHTS, FSIV, PSV, LHT · +2 more");
    expect(teamLine(details)).toBe("Nothing applies");
  });

  it("words a category's tooltip and panel lines", () => {
    const types = [
      { code: "PSV", label: "Platform Support Vessel", status: "Behind" as const },
      { code: "DSV", label: "Diving Support Vessel", status: "On Track" as const },
    ];
    expect(categoryLine("Vessels", types)).toBe("Vessels (2): PSV Behind · DSV On Track");
    expect(categoryLine("Vessels", types, (t) => (t.code === "PSV" ? `${t.code} (${t.label})` : t.code))).toBe(
      "Vessels (2): PSV (Platform Support Vessel) Behind · DSV On Track",
    );
    expect(categoryPanelLine("Vessels", types)).toBe("Vessels · 2 selected · 1 behind");
    expect(categoryPanelLine("Lifting", [{ code: "CR", label: "Crane", status: "Completed" }])).toBe(
      "Lifting · 1 selected",
    );
  });
});

describe("the tick list — 'starts unticked' and the grouped, searchable picker (§5.1, §8.8)", () => {
  const PROJECT = { scope: "project" as const, well_project: "Bonga Phase 3" };
  const WELL = {
    scope: "well" as const, well_project: "Bonga Phase 3", well_name: "W-1", activity_type: "Oil Development",
  };
  const LONE_WELL = { ...WELL, well_project: "" };
  const PSV = byCode("PSV");
  const PO = byCode("PO");
  const PERMIT_ONLY = check("PRJ", { applies_well: false, applies_by_default: false, category: "Permits" });

  it("a check that starts unticked reads unticked where no cell says otherwise", () => {
    expect(pickerRows([PSV, PO], PROJECT, {}).map((r) => [r.check.code, r.initial])).toEqual([
      ["PSV", false],
      ["PO", true],
    ]);
    expect(pickerRows([PSV], LONE_WELL, {}).map((r) => r.initial)).toEqual([false]);
    // Project-only, read-only on a well: the field project's (unknown) tick → its default.
    expect(pickerRows([PERMIT_ONLY], WELL, {}).map((r) => [r.kind, r.initial])).toEqual([["project", false]]);
    // A well's own choice under a field project with no cell: Follow project
    // shows the check's default — unticked.
    const [own] = pickerRows([PSV], WELL, { PSV: cell("On Track", true, "well") }, {});
    expect([own.initial, own.projectApplies]).toEqual([true, false]);
    // A definition without the field starts ticked, as before.
    expect(pickerRows([check("OLD")], PROJECT, {}).map((r) => r.initial)).toEqual([true]);
  });

  it("served cells win over the default — nominated on the field project, followed by its well", () => {
    const [onProject] = pickerRows([PSV], PROJECT, { PSV: cell("On Track", true, "project") });
    expect(onProject.initial).toBe(true);
    const [following] = pickerRows([PSV], WELL, { PSV: cell("On Track", true, "project") });
    expect([following.inherits, following.initial, following.projectApplies]).toEqual([true, null, true]);
  });

  it("a field project's body never sends null — and never turns it into a tick", () => {
    expect(applicabilityBody(PROJECT, { PSV: true, DSV: null, PO: false })).toEqual({
      scope: "project", well_project: "Bonga Phase 3", applies: { PSV: true, PO: false },
    });
    // A well keeps null: Follow project.
    expect(applicabilityBody(WELL, { PSV: null }).applies).toEqual({ PSV: null });
  });

  it("groups the core checks first, then one group per category, in catalog order", () => {
    const rows = pickerRows(LOGISTICS_CHECKS, PROJECT, {});
    const groups = pickerGroups(rows);
    expect(groups.core.map((r) => r.check.code)).toEqual(["L-BUD", "CTR", "FFP", "CTS", "PO", "NAV"]);
    expect(groups.categories.map((g) => [g.name, g.items.length])).toEqual([
      ["Aviation", 1], ["Vessels", 8], ["Barges", 5], ["Land transport", 5], ["Lifting", 1], ["Permits", 1],
    ]);
    expect(groups.categories[1].items.map((r) => r.check.code)).toEqual([
      "DSV", "SEV", "AHTS", "FSIV", "PSV", "LHT", "TB", "PC",
    ]);
  });

  it("counts 'n of m selected' with a tri-state box; a group with nothing selected reads none", () => {
    const rows = pickerRows(LOGISTICS_CHECKS, PROJECT, { PSV: cell("On Track", true, "project") });
    const vessels = pickerGroups(rows).categories.find((g) => g.name === "Vessels")!.items;
    const barges = pickerGroups(rows).categories.find((g) => g.name === "Barges")!.items;
    expect(groupTicks(vessels, {})).toEqual({ selected: 1, total: 8, state: "some" });
    expect(groupTicks(barges, {})).toEqual({ selected: 0, total: 5, state: "none" });
    // The dialog's choices win over what was loaded.
    expect(groupTicks(barges, { JUB: true, ENV: true, HB: true, CBG: true, RP: true }).state).toBe("all");
  });

  it("select all ticks only what isn't ticked — explicit ticks, never Follow project", () => {
    const rows = pickerRows(LOGISTICS_CHECKS, PROJECT, { PSV: cell("On Track", true, "project") });
    const vessels = pickerGroups(rows).categories.find((g) => g.name === "Vessels")!.items;
    const patch = groupToggle(vessels, {});
    expect(Object.keys(patch)).toEqual(["DSV", "SEV", "AHTS", "FSIV", "LHT", "TB", "PC"]);
    expect(Object.values(patch).every((v) => v === true)).toBe(true);
    // From "all" it unticks every one.
    const all = { ...patch };
    expect(groupToggle(vessels, all)).toEqual(Object.fromEntries(vessels.map((r) => [r.check.code, false])));
    // An explicit direction overrides the tri-state.
    expect(groupToggle(vessels, {}, false)).toEqual({ PSV: false });
  });

  it("select all leaves a well following its nominating field project alone, and skips read-only rows", () => {
    const rows = pickerRows(
      [PSV, byCode("DSV"), PERMIT_ONLY],
      WELL,
      { PSV: cell("On Track", true, "project"), DSV: cell("On Track", false), PRJ: cell("On Track", false) },
      { PSV: cell("On Track", true, "project") },
    );
    const patch = groupToggle(rows, {}, true);
    expect(patch).toEqual({ DSV: true });
    // …so Save sends only the real change.
    expect(changedChoices(rows, patch)).toEqual({ DSV: true });
  });

  it("searches code or label, ignoring case; filtering never drops a choice", () => {
    const rows = pickerRows(LOGISTICS_CHECKS, PROJECT, {});
    const psv = rows.find((r) => r.check.code === "PSV")!;
    expect(matchesPickerSearch(psv, "psv")).toBe(true);
    expect(matchesPickerSearch(psv, " PSV label ")).toBe(true);
    expect(matchesPickerSearch(psv, "barge")).toBe(false);
    expect(matchesPickerSearch(psv, "  ")).toBe(true);
    const shown = rows.filter((r) => matchesPickerSearch(r, "label") && r.check.code.startsWith("C"));
    // A hidden row's choice still goes into the request.
    expect(changedChoices(rows, { PSV: true, CR: true })).toEqual({ PSV: true, CR: true });
    expect(pickerFooter(shown.length, rows.length, 2)).toBe("Showing 5 of 27 · 2 unsaved changes");
    expect(pickerFooter(27, 27, 1)).toBe("1 unsaved change");
    expect(pickerFooter(27, 27, 0)).toBe("");
  });
});

describe("the Checks… marker — exceptions over the checks that start ticked (§8.7, decision 37)", () => {
  const PROJECT = { scope: "project" as const, well_project: "Bonga Phase 3" };
  const WELL = {
    scope: "well" as const, well_project: "Bonga Phase 3", well_name: "W-1", activity_type: "Oil Development",
  };
  /** A field project's cells as served: core checks apply, equipment not selected. */
  const projectCells = (overrides: Record<string, TeamCheckState> = {}) =>
    Object.fromEntries(
      LOGISTICS_CHECKS.map((c) => [
        c.code,
        overrides[c.code] ?? cell("On Track", c.applies_by_default !== false),
      ]),
    );

  it("an untouched row says nothing — the 21 types that start unticked never count against it", () => {
    expect(pickerBadge(pickerRows(LOGISTICS_CHECKS, PROJECT, projectCells()))).toBe("");
    // No cells at all: every check reads its own default — the same.
    expect(pickerBadge(pickerRows(LOGISTICS_CHECKS, PROJECT, {}))).toBe("");
    expect(pickerBadge(pickerRows(LOGISTICS_CHECKS, WELL, wellCells()))).toBe("");
  });

  it("a core check unticked reads '5 of 6' — counted over the six that start ticked, as in phase 6", () => {
    const rows = pickerRows(LOGISTICS_CHECKS, PROJECT, projectCells({ NAV: cell("On Track", false, "project") }));
    expect(pickerBadge(rows)).toBe("5 of 6");
  });

  it("nominations show apart: '5 of 6 · 2 selected', or just '2 selected'", () => {
    const nominated = { DSV: cell("On Track", true, "project"), PSV: cell("Behind", true, "project") };
    expect(
      pickerBadge(
        pickerRows(LOGISTICS_CHECKS, PROJECT, projectCells({ ...nominated, NAV: cell("On Track", false, "project") })),
      ),
    ).toBe("5 of 6 · 2 selected");
    expect(pickerBadge(pickerRows(LOGISTICS_CHECKS, PROJECT, projectCells(nominated)))).toBe("2 selected");
    // An un-nominated type (not applicable because of a row) isn't selected either.
    expect(
      pickerBadge(pickerRows(LOGISTICS_CHECKS, PROJECT, projectCells({ PSV: cell("Behind", false, "project") }))),
    ).toBe("");
  });

  it("a well counts what it follows from its field project, and read-only project-only rows", () => {
    const followed = pickerRows(
      LOGISTICS_CHECKS,
      WELL,
      wellCells({ PSV: wellCell("Behind", true, "project") }),
      projectCells({ PSV: cell("Behind", true, "project") }),
    );
    expect(pickerBadge(followed)).toBe("1 selected");
    const permit = check("PRJ", { applies_well: false, applies_by_default: false, category: "Permits" });
    const readOnly = pickerRows([...LOGISTICS_CHECKS, permit], WELL, {
      ...wellCells(),
      PRJ: wellCell("On Track", true, "project"),
    });
    expect(readOnly.find((r) => r.check.code === "PRJ")?.kind).toBe("project");
    expect(pickerBadge(readOnly)).toBe("1 selected");
  });

  it("a phase 6 team with no equipment reads exactly as before", () => {
    // Definitions without the phase 7 fields start ticked.
    const phase6 = ["L-BUD", "CTR", "FFP", "CTS", "PO", "NAV"].map((code) => check(code));
    expect(pickerBadge(pickerRows(phase6, PROJECT, {}))).toBe("");
    expect(pickerBadge(pickerRows(phase6, PROJECT, { NAV: cell("On Track", false, "project") }))).toBe("5 of 6");
  });
});

describe("categories (§3.9, decision 39)", () => {
  it("group by exact text; core checks first; categories in order of their first check", () => {
    const groups = groupByCategory(LOGISTICS_CHECKS);
    expect(groups.core).toHaveLength(6);
    expect(categoriesOf(LOGISTICS_CHECKS)).toEqual([
      "Aviation", "Vessels", "Barges", "Land transport", "Lifting", "Permits",
    ]);
    expect(categoriesOf([check("A", { category: "Vessels" }), check("B", { category: "vessels" })])).toEqual([
      "Vessels", "vessels",
    ]);
  });

  it("a check that locks with the plan, or one frozen before 039, has none", () => {
    expect(categoryOf({ locks_with_plan: true, category: "Vessels" })).toBe("");
    expect(categoryOf({ locks_with_plan: false })).toBe("");
    expect(categoryOf({ locks_with_plan: false, category: "Vessels" })).toBe("Vessels");
  });
});

describe("the synthetic strip check per category (§8.8 'How it's built')", () => {
  it("a seeded Logistics strip is 6 core icons + 6 category icons, each wearing its first type's icon", () => {
    const strip = stripChecksOf(LOGISTICS_CHECKS);
    expect(strip.map((c) => c.code)).toEqual([
      "L-BUD", "CTR", "FFP", "CTS", "PO", "NAV",
      "category:Aviation", "category:Vessels", "category:Barges", "category:Land transport",
      "category:Lifting", "category:Permits",
    ]);
    const vessels = strip.find((c) => c.code === categoryCode("Vessels"))!;
    expect(vessels).toMatchObject({
      label: "Vessels", icon_key: "anchor", locks_with_plan: false, team_code: "logistics",
      applies_project: true, applies_well: true, status_set: "standard",
    });
    expect(vessels.members).toEqual(["DSV", "SEV", "AHTS", "FSIV", "PSV", "LHT", "TB", "PC"]);
    expect(strip.map((c) => c.icon_key).slice(6)).toEqual([
      "helicopter", "anchor", "container", "bus", "construction", "radiation",
    ]);
    // The core checks come back as they are.
    expect(strip[0]).toBe(LOGISTICS_CHECKS[0]);
  });

  it("a category's icon is its FIRST type's", () => {
    const strip = stripChecksOf([
      check("X1", { category: "Mixed", icon_key: "ship-wheel", sort_order: 1 }),
      check("X2", { category: "Mixed", icon_key: "anchor", sort_order: 2 }),
    ]);
    expect(strip).toHaveLength(1);
    expect(strip[0].icon_key).toBe("ship-wheel");
  });

  it("leaves the Project gates, the All lens's badges and pre-039 definitions as they are", () => {
    expect(stripChecksOf(BUILTIN_PROJECT_GATES)).toEqual([...BUILTIN_PROJECT_GATES]);
    const all = lensChecksOf(BUILTIN_PROJECT_GATES, "all", TEAMS);
    expect(stripChecksOf(all)).toEqual(all);
    const old = [check("PO"), check("NAV")];
    expect(stripChecksOf(old)).toEqual(old);
  });

  it("is idempotent, and its codes can't collide with a check or team code", () => {
    const once = stripChecksOf(LOGISTICS_CHECKS);
    expect(stripChecksOf(once).map((c) => c.code)).toEqual(once.map((c) => c.code));
    expect(isCategoryCode(categoryCode("Vessels"))).toBe(true);
    expect(isCategoryCode("PSV")).toBe(false);
    expect(CATEGORY_CODE_PREFIX).toMatch(/[^A-Za-z0-9-]/);
  });

  it("a print strip's column count is its uncategorised checks plus its categories", () => {
    expect(stripColumnCount(LOGISTICS_CHECKS)).toBe(12);
    expect(stripColumnCount(EQUIPMENT)).toBe(6);
    expect(stripColumnCount(BUILTIN_PROJECT_GATES)).toBe(7);
    expect(stripColumnCount(lensChecksOf(BUILTIN_PROJECT_GATES, "all", TEAMS))).toBe(2);
  });
});

describe("a category's cell — the worst of its types that apply (§3.9)", () => {
  const VESSELS = EQUIPMENT.filter((c) => c.category === "Vessels");

  it("reads only the types that apply, worst first, ties in catalog order", () => {
    const cells = wellCells({
      DSV: wellCell("On Track", true, "project"),
      PSV: wellCell("Behind", true, "well"),
      TB: wellCell("Completed", true, "project"),
      PC: wellCell("On Track", true, "well"),
      // Unticked by a row: Behind underneath, never counted.
      LHT: wellCell("Behind", false, "well"),
    });
    const c = categoryCell(VESSELS, cells)!;
    expect(c.status).toBe("Behind");
    expect(c.applies).toBe(true);
    expect(c.types.map((t) => [t.code, t.status])).toEqual([
      ["PSV", "Behind"], ["DSV", "On Track"], ["PC", "On Track"], ["TB", "Completed"],
    ]);
    expect(c.types[0].label).toBe("PSV label");
  });

  it("no cell when none of its types applies — not selected, unticked, missing or N/A in a snapshot", () => {
    expect(categoryCell(VESSELS, wellCells())).toBeUndefined();
    expect(categoryCell(VESSELS, wellCells({ PSV: wellCell("Behind", false, "project") }))).toBeUndefined();
    expect(categoryCell(VESSELS, {})).toBeUndefined();
    expect(categoryCell(VESSELS, null)).toBeUndefined();
    expect(categoryCell(VESSELS, { PSV: { status: "N/A" } })).toBeUndefined();
    // A snapshot cell that applied is read like a live one.
    expect(categoryCell(VESSELS, { PSV: { status: "Completed" } })?.status).toBe("Completed");
  });

  it("withCategoryCells adds one cell per category that has a type applying, keeping every type cell", () => {
    const cells = wellCells({ PSV: wellCell("Behind", true, "project"), CR: wellCell("Completed", true, "well") });
    const rolled = withCategoryCells(LOGISTICS_CHECKS, cells);
    expect(Object.keys(rolled).filter(isCategoryCode)).toEqual(["category:Vessels", "category:Lifting"]);
    expect(rolled["category:Vessels"]).toMatchObject({ status: "Behind", applies: true });
    // The type cells pass through untouched — the tooltip and panel read them.
    expect(rolled.PSV).toBe(cells.PSV);
    expect(Object.keys(rolled)).toHaveLength(LOGISTICS_CHECKS.length + 2);
    // Recomputed each time: twice is once, and a stale category cell goes.
    expect(withCategoryCells(LOGISTICS_CHECKS, rolled)).toEqual(rolled);
    const unNominated = { ...rolled, PSV: wellCell("On Track", false) };
    expect(withCategoryCells(LOGISTICS_CHECKS, unNominated)["category:Vessels"]).toBeUndefined();
  });
});

describe("the chart strip with categories (§8.8 'Chart (team lens)')", () => {
  const cells = wellCells({
    PSV: wellCell("Behind", true, "project"),
    DSV: wellCell("Completed", true, "project"),
    CR: wellCell("Completed", true, "well"),
    LBT: wellCell("On Track", false, "well"), // unticked by the well: Not applicable
    NAV: wellCell("On Track", false, "project"),
  });
  const strip = categoryStrip(LOGISTICS_CHECKS, cells);

  it("draws the core checks that apply, then one icon per category with a type that applies", () => {
    const codes = barStripCodes(strip.defs, strip.cells!, false);
    expect(codes).toEqual(["L-BUD", "CTR", "FFP", "CTS", "PO", "category:Vessels", "category:Lifting"]);
    // The tier is sized by the icons drawn — never more than 12 for Logistics.
    expect(iconTier(16 * 7 + 23, codes.length)).toBe("full");
    expect(barStripCodes(stripChecksOf(LOGISTICS_CHECKS), withCategoryCells(LOGISTICS_CHECKS, wellCells({
      ...Object.fromEntries(EQUIPMENT.map((c) => [c.code, wellCell("On Track", true, "project")])),
    })), false)).toHaveLength(12);
  });

  it("the single-icon tier and a sibling bar's marker show the category", () => {
    expect(worstCheck(strip.cells, strip.defs)).toEqual({ code: "category:Vessels", status: "Behind" });
    expect(siblingMarker(strip.cells, strip.defs)).toEqual({ code: "category:Vessels", status: "Behind" });
    // Nothing behind → no marker.
    const calm = categoryStrip(LOGISTICS_CHECKS, wellCells({ CR: wellCell("Completed", true, "well") }));
    expect(siblingMarker(calm.cells, calm.defs)).toBeNull();
  });

  it("a bar where nothing applies draws no strip — the equipment adds nothing on deploy", () => {
    const quiet = Object.fromEntries(
      LOGISTICS_CHECKS.map((c) => [c.code, wellCell("On Track", false, c.category ? "default" : "project")]),
    );
    const s = categoryStrip(LOGISTICS_CHECKS, quiet);
    expect(barStripCodes(s.defs, s.cells!, false)).toEqual([]);
    expect(worstCheck(s.cells, s.defs)).toBeNull();
    expect(categoryStrip(LOGISTICS_CHECKS, null).cells).toBeNull();
  });
});

function act(id: string, over: Partial<Activity> = {}): Activity {
  return {
    id, activity_type: "Oil Development", start_date: "2026-11-01", end_date: "2027-01-01",
    well_name: "W-1", well_project: "Bonga Phase 3", rig_name: "Rig A", location: "SWAMP",
    readiness_required: true, completed_at: null, ...over,
  } as Activity;
}

function teamData(cellsW1: Record<string, EffectiveCheckState>, cellsW2 = wellCells()): TeamReadiness {
  const row = (well_name: string, checks: Record<string, EffectiveCheckState>) => ({
    well_project: "Bonga Phase 3", well_name, activity_type: "Oil Development", activity_count: 1,
    location: "SWAMP", start_date: "2026-11-01", focus_start: "2026-11-01", checks,
  });
  return {
    team: LOGISTICS,
    checks: LOGISTICS_CHECKS,
    project_rows: [],
    well_rows: [row("W-1", cellsW1), row("W-2", cellsW2)],
    locked: false,
  };
}

describe("lens data rolls categories up (§8.8)", () => {
  it("a team lens's cells carry each category's synthetic cell, beside every type cell", async () => {
    const w1 = wellCells({ PSV: wellCell("Behind", true, "project"), DSV: wellCell("Completed", true, "project") });
    server.use(http.get("/api/projects/:projectId/readiness/teams/:team", () => HttpResponse.json(teamData(w1))));
    const { map, keyOf } = await loadLensReadiness(PID, "logistics");
    const cells = map.get(keyOf(act("a1"))!)!;
    expect(cells["category:Vessels"]).toMatchObject({ status: "Behind", applies: true });
    expect(cells["category:Vessels"].types?.map((t) => t.code)).toEqual(["PSV", "DSV"]);
    expect(cells["category:Barges"]).toBeUndefined();
    expect(cells.PSV).toMatchObject({ status: "Behind", applies: true, applies_source: "project" });
    expect(barStripCodes(stripChecksOf(LOGISTICS_CHECKS), cells, false)).toEqual([
      "L-BUD", "CTR", "FFP", "CTS", "PO", "NAV", "category:Vessels",
    ]);
  });

  it("the All lens: the Logistics badge is the worst of everything that applies; not-selected types are never listed", async () => {
    const w1 = wellCells({
      PSV: wellCell("Behind", true, "project"),
      DSV: wellCell("On Track", false, "well"), // unticked by the well
    });
    server.use(
      http.get("/api/projects/:projectId/readiness/teams/:team", () => HttpResponse.json(teamData(w1))),
      http.get("/api/projects/:projectId/readiness", () => HttpResponse.json([])),
    );
    const { map } = await loadLensReadiness(PID, "all", { activities: [act("a1")], teams: TEAMS });
    const badge = map.get("a1")!.logistics;
    expect(badge.status).toBe("Behind");
    expect(badge.details?.map((d) => d.code)).toEqual(["L-BUD", "CTR", "FFP", "CTS", "PO", "NAV", "DSV", "PSV"]);
    expect(notApplicableLine(badge.details ?? [])).toBe("Not applicable: DSV");
  });

  it("the All lens: a team whose cells are all not selected reads 'Nothing applies', with no badge", async () => {
    const equipmentOnly: TeamReadiness = {
      ...teamData(Object.fromEntries(EQUIPMENT.map((c) => [c.code, wellCell("On Track", false)]))),
      checks: EQUIPMENT,
    };
    server.use(
      http.get("/api/projects/:projectId/readiness/teams/:team", () => HttpResponse.json(equipmentOnly)),
      http.get("/api/projects/:projectId/readiness", () => HttpResponse.json([])),
    );
    const { map } = await loadLensReadiness(PID, "all", { activities: [act("a1"), act("a9", { well_name: "W-9" })], teams: TEAMS });
    expect(map.get("a1")?.logistics).toEqual({ status: "N/A", applies: false, details: [] });
    const strip = lensChecksOf(BUILTIN_PROJECT_GATES, "all", TEAMS);
    expect(barStripCodes(strip, map.get("a1")!, true)).toEqual([]);
    // A well with no row in the team at all has no entry.
    expect(map.get("a9")).toBeUndefined();
  });

  it("a live print row prints one icon per category, keyed by the category", () => {
    const cells = wellCells({ PSV: wellCell("Behind", true, "project"), CR: wellCell("Completed", true, "well") });
    expect(printedReadiness(cells, LOGISTICS_CHECKS, false)).toEqual({
      "L-BUD": "On Track", CTR: "On Track", FFP: "On Track", CTS: "On Track", PO: "On Track", NAV: "On Track",
      "category:Vessels": "Behind", "category:Lifting": "Completed",
    });
    // Nothing nominated, every core check unticked by the field project: no strip.
    const quiet = Object.fromEntries(
      LOGISTICS_CHECKS.map((c) => [c.code, wellCell("Behind", false, c.category ? "default" : "project")]),
    );
    expect(printedReadiness(quiet, LOGISTICS_CHECKS, false)).toBeUndefined();
    // Pre-039 definitions print each check, as before.
    expect(printedReadiness({ PO: wellCell("Behind", true) }, [check("PO")], false)).toEqual({ PO: "Behind" });
  });
});

describe("a revision print rolls categories up from its FROZEN catalog (§6, §8.8)", () => {
  const row = (id: string, atSubmission: PrintRow["readiness_at_submission"]): PrintRow => ({
    id, activity_type: "Oil Development", start_date: "2026-11-01", end_date: "2027-01-01",
    well_name: id, well_project: "Bonga Phase 3", rig_name: "Rig A", location: "SWAMP",
    plan_type: null, risk: null, readiness: { FDP: "Completed" }, readiness_at_submission: atSubmission,
  });
  // A not-selected type isn't recorded at all; one a row unticked is recorded N/A.
  const rows = [
    row("W-1", {
      PO: { status: "Completed", source: "project" },
      PSV: { status: "Behind", source: "project" },
      DSV: { status: "N/A", source: "default" },
      CR: { status: "Completed", source: "well" },
    }),
    row("W-2", { DSV: { status: "N/A", source: "default" } }),
  ];
  const frozen = [...BUILTIN_PROJECT_GATES, ...LOGISTICS_CHECKS];

  it("a team lens prints its core checks and one icon per category that applied", () => {
    const [w1, w2] = snapshotRowsForLens(rows, "logistics", frozen, TEAMS);
    expect(w1.readiness).toEqual({ PO: "Completed", "category:Vessels": "Behind", "category:Lifting": "Completed" });
    expect(w1.readiness_key).toBe("Bonga Phase 3\u0001W-1\u0001Oil Development");
    // Only an N/A type: nothing applied, no strip.
    expect(w2.readiness).toBeUndefined();
    expect(w2.readiness_required).toBe(false);
  });

  it("a catalog frozen before categories prints each check on its own", () => {
    const old = frozen.map(({ category: _c, applies_by_default: _a, ...rest }) => rest);
    const [w1] = snapshotRowsForLens(rows, "logistics", old, TEAMS);
    expect(w1.readiness).toEqual({ PO: "Completed", PSV: "Behind", CR: "Completed" });
  });

  it("the All lens's Logistics badge is the worst of everything that applied", () => {
    const [w1, w2] = snapshotRowsForLens(rows, "all", frozen, TEAMS);
    expect(w1.readiness).toEqual({ projects: "Completed", logistics: "Behind" });
    expect(w2.readiness).toEqual({ projects: "Completed" });
  });

  it("the Project gates print as stored", () => {
    expect(snapshotRowsForLens(rows, "projects", frozen, TEAMS)).toEqual(rows);
  });
});
