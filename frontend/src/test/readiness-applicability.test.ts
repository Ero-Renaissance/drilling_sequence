/**
 * The "Checks that apply" picker's decisions (spec §3.8, §5.1, §8.7) —
 * lib/readiness-applicability.ts: which checks a target lists, how a well's
 * tick inherits, what one Save sends, and how the response folds back in.
 */
import { describe, it, expect } from "vitest";

import type {
  CatalogCheck,
  CheckSource,
  TeamCheckState,
  TeamReadiness,
  TeamWellRow,
} from "@/api/readiness";
import { BUILTIN_PROJECT_GATES } from "@/components/readiness/catalog";
import {
  applicabilityBody,
  changedChoices,
  isOwnChoice,
  isTicked,
  mergeApplicability,
  pickerRows,
  wellsWithOwnChoice,
} from "@/lib/readiness-applicability";

const check = (code: string, over: Partial<CatalogCheck> = {}): CatalogCheck => ({
  code, label: code, team_code: "logistics", applies_project: true, applies_well: true,
  status_set: "standard", icon_key: "receipt", locks_with_plan: false, sort_order: 10, ...over,
});
const PO = check("PO");
const NAV = check("NAV", { sort_order: 20 });
const CTS = check("CTS", { applies_well: false, sort_order: 30 }); // project only
const WEL = check("WEL", { applies_project: false, sort_order: 40 }); // well only
const FDP = BUILTIN_PROJECT_GATES[0];

const cell = (applies: boolean, applies_source: CheckSource = "default"): TeamCheckState => ({
  status: "On Track", notes: null, updated_at: null, applies, applies_source,
});

const PROJECT = { scope: "project" as const, well_project: "Bonga Phase 3" };
const WELL = {
  scope: "well" as const, well_project: "Bonga Phase 3", well_name: "W-1", activity_type: "Oil Development",
};
const LONE_WELL = { ...WELL, well_project: "" };

describe("pickerRows — what a target's picker lists", () => {
  it("never lists a check that locks with the plan: the Project gates use N/A", () => {
    expect(pickerRows([FDP, PO], PROJECT, {})).toHaveLength(1);
    expect(pickerRows([check("OLD", { locks_with_plan: true })], WELL, {})).toEqual([]);
  });

  it("a field project lists its project-level checks, ticked by default", () => {
    const rows = pickerRows([PO, NAV, CTS, WEL], PROJECT, { NAV: cell(false) });
    expect(rows.map((r) => [r.check.code, r.kind, r.inherits, r.initial])).toEqual([
      ["PO", "edit", false, true],
      ["NAV", "edit", false, false],
      ["CTS", "edit", false, true],
    ]);
  });

  it("a well inherits two-level ticks, shows project-only checks read-only, and ticks well-only ones plainly", () => {
    const rows = pickerRows(
      [PO, NAV, CTS, WEL],
      WELL,
      {
        PO: cell(true, "project"), // follows its field project
        NAV: cell(true, "well"), // its own choice, under an unticked project
        CTS: cell(false, "project"),
        WEL: cell(true),
      },
      { NAV: cell(false) },
    );
    expect(rows.map((r) => [r.check.code, r.kind, r.inherits, r.initial, r.projectApplies])).toEqual([
      ["PO", "edit", true, null, true],
      ["NAV", "edit", true, true, false],
      ["CTS", "project", false, false, false],
      ["WEL", "edit", false, true, true],
    ]);
  });

  it("a well with no field project: plain ticks, and project-only checks left out (§7.12)", () => {
    const rows = pickerRows([PO, CTS, WEL], LONE_WELL, { PO: cell(false, "well") });
    expect(rows.map((r) => [r.check.code, r.inherits, r.initial])).toEqual([
      ["PO", false, false],
      ["WEL", false, true],
    ]);
  });
});

describe("ticks — inheritance, Follow project and the request", () => {
  const [po, nav] = pickerRows([PO, NAV], WELL, { PO: cell(true, "project"), NAV: cell(true, "well") }, {
    NAV: cell(false),
  });

  it("a following well shows its field project's tick; its own choice is marked", () => {
    expect([isTicked(po, null), isOwnChoice(po, null)]).toEqual([true, false]);
    expect([isTicked(nav, true), isOwnChoice(nav, true)]).toEqual([true, true]);
    // Follow project: back to the field project's (unticked) choice.
    expect([isTicked(nav, null), isOwnChoice(nav, null)]).toEqual([false, false]);
  });

  it("previews against the field project's tick as loaded: a choice matching it reads 'from project'", () => {
    // The following PO: unticking it is the well's own choice; ticking it again
    // matches its (ticked) field project.
    expect(isOwnChoice(po, false)).toBe(true);
    expect(isOwnChoice(po, true)).toBe(false);
    // NAV's own choice, unticked: matches its (unticked) field project.
    expect([isTicked(nav, false), isOwnChoice(nav, false)]).toEqual([false, false]);
    // A plain tick (no field project to follow) is never "set on this well".
    const [lone] = pickerRows([PO], LONE_WELL, {});
    expect(isOwnChoice(lone, false)).toBe(false);
  });

  it("an own choice that came to match its field project stays marked until Follow project (§3.8)", () => {
    const [same] = pickerRows([PO], WELL, { PO: cell(true, "well") }, { PO: cell(true) });
    expect([same.initial, same.projectApplies]).toEqual([true, true]);
    expect(isOwnChoice(same, true)).toBe(true);
    expect(isOwnChoice(same, null)).toBe(false);
  });

  it("a box click is sent as its explicit tick — never null, even where it matches the loaded project tick", () => {
    // As loaded: the field project is unticked; W-1 has its own choice to apply.
    const [own] = pickerRows([PO], WELL, { PO: cell(true, "well") }, { PO: cell(false, "project") });
    expect([own.initial, own.projectApplies]).toEqual([true, false]);
    // The user unticks W-1's box: an explicit "doesn't apply". The server weighs
    // it against the field project's CURRENT tick (§4.4), so a concurrent
    // re-tick there can't flip it.
    expect(applicabilityBody(WELL, changedChoices([own], { PO: false })).applies).toEqual({ PO: false });
    // A following well's box, back on: an explicit "applies", not "follow".
    expect(changedChoices([po], { PO: true })).toEqual({ PO: true });
    expect(changedChoices([po], { PO: false })).toEqual({ PO: false });
  });

  it("sends only what changed — true, false or null (Follow project)", () => {
    const [p, n, w] = pickerRows([PO, NAV, WEL], WELL, {
      PO: cell(true, "project"), NAV: cell(true, "well"), WEL: cell(true),
    });
    expect(changedChoices([p, n, w], { PO: null, NAV: true, WEL: true })).toEqual({});
    expect(changedChoices([p, n, w], { PO: false, NAV: null, WEL: false })).toEqual({
      PO: false, NAV: null, WEL: false,
    });
  });

  it("never sends a read-only project-only row", () => {
    const rows = pickerRows([CTS], WELL, { CTS: cell(true, "project") });
    expect(changedChoices(rows, { CTS: false })).toEqual({});
  });

  it("builds the body with names in it, never null for a field project", () => {
    expect(applicabilityBody(WELL, { PO: null, NAV: false })).toEqual({ ...WELL, applies: { PO: null, NAV: false } });
    expect(applicabilityBody(PROJECT, { PO: false, NAV: true })).toEqual({
      scope: "project", well_project: "Bonga Phase 3", applies: { PO: false, NAV: true },
    });
  });
});

describe("folding a response into the team's rows", () => {
  const wellRow = (name: string, wp: string, choice: CheckSource = "project"): TeamWellRow => ({
    well_project: wp, well_name: name, activity_type: "Oil Development", activity_count: 1,
    location: "SWAMP", start_date: "2026-11-01", focus_start: "2026-11-01",
    checks: { PO: { ...cell(true, choice), source: "default" }, CTS: { ...cell(true, "project"), source: "project" } },
  });
  const data: TeamReadiness = {
    team: { code: "logistics", name: "Logistics", editor_source: "team_grant", icon_key: "truck", sort_order: 20 },
    checks: [PO, CTS],
    project_rows: [
      { well_project: "Bonga Phase 3", activity_count: 2, checks: { PO: cell(true), CTS: cell(true) } },
      { well_project: "Egbema", activity_count: 1, checks: { PO: cell(true), CTS: cell(true) } },
    ],
    well_rows: [wellRow("W-1", "Bonga Phase 3"), wellRow("W-2", "Bonga Phase 3", "well"), wellRow("E-1", "Egbema")],
    locked: false,
  };

  it("replaces exactly the rows the response carries", () => {
    const unticked = { ...data.project_rows[0], checks: { PO: cell(false), CTS: cell(true) } };
    const w1 = { ...wellRow("W-1", "Bonga Phase 3"), checks: { PO: { ...cell(false, "project"), source: "default" as const } } };
    const merged = mergeApplicability(data, { project_rows: [unticked], well_rows: [w1] });
    expect(merged.project_rows[0]).toBe(unticked);
    expect(merged.project_rows[1]).toBe(data.project_rows[1]);
    expect(merged.well_rows.map((r) => r.checks.PO.applies)).toEqual([false, true, true]);
    expect(merged.well_rows[2]).toBe(data.well_rows[2]);
  });

  it("counts the wells under a field project with their own choice", () => {
    expect(wellsWithOwnChoice(data.well_rows, "Bonga Phase 3", data.checks)).toBe(1);
    expect(wellsWithOwnChoice(data.well_rows, "Egbema", data.checks)).toBe(0);
  });
});
