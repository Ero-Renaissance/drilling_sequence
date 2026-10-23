import { describe, it, expect } from "vitest";
import type { CatalogCheck, CheckStatus } from "@/api/readiness";
import { BUILTIN_PROJECT_GATES } from "@/components/readiness/catalog";
import {
  notApplicableLine,
  summariseTeam,
  summaryLine,
  teamDetails,
  teamLine,
  type TeamCheckDetail,
} from "@/lib/team-summary";

const d = (code: string, status: CheckStatus, applies = true): TeamCheckDetail => ({
  code,
  label: code,
  status,
  applies,
});

const teamCheck = (code: string): CatalogCheck => ({
  code,
  label: `${code} label`,
  team_code: "logistics",
  applies_project: true,
  applies_well: true,
  status_set: "standard",
  icon_key: "receipt",
  locks_with_plan: false,
  sort_order: 10,
});

describe("team summary", () => {
  it("counts like the dashboard tiles: Available is done, N/A is not counted", () => {
    const s = summariseTeam([
      d("L-BUD", "Completed"),
      d("NEQ", "Available"),
      d("CTS", "N/A"),
      d("PO", "On Track"),
    ])!;
    expect([s.done, s.total]).toEqual([2, 3]);
    expect(s.worst).toBe("On Track");
    expect(summaryLine(s)).toBe("2 of 3 done · On Track: PO");
  });

  it("names only what needs attention, worst first, grouped by status — no equipment", () => {
    const s = summariseTeam([
      d("L-BUD", "Completed"),
      d("CTR", "On Track"),
      d("NEQ", "Not available"),
      d("FFP", "Behind"),
      d("PO", "Behind"),
    ])!;
    expect(s.worst).toBe("Behind");
    expect(summaryLine(s)).toBe("1 of 5 done · Not available: NEQ · Behind: FFP, PO · On Track: CTR");
  });

  it("caps the named checks and says how many more", () => {
    const s = summariseTeam(["A", "B", "C", "D", "E", "F"].map((c) => d(c, "Behind")))!;
    expect(summaryLine(s)).toBe("0 of 6 done · Behind: A, B, C, D · +2 more");
    expect(summaryLine(s, 2)).toBe("0 of 6 done · Behind: A, B · +4 more");
  });

  it("says when everything is done, or (Project gates) nothing applies", () => {
    expect(summaryLine(summariseTeam([d("A", "Completed"), d("B", "Available"), d("C", "N/A")])!)).toBe(
      "All 2 done",
    );
    expect(summaryLine(summariseTeam([d("A", "N/A")])!)).toBe("Nothing applies (all N/A)");
    expect(summariseTeam([])).toBeUndefined();
  });
});

describe("team checks that don't apply (spec §3.8)", () => {
  it("are dropped before the summary — however far behind they are underneath", () => {
    const s = summariseTeam([d("PO", "Behind", false), d("NAV", "Completed"), d("CTR", "On Track")])!;
    expect(s.worst).toBe("On Track");
    expect([s.done, s.total]).toEqual([1, 2]);
    expect(s.attention.map((x) => x.code)).toEqual(["CTR"]);
    // …but kept for the live tooltip's muted list.
    expect(s.notApplicable.map((x) => x.code)).toEqual(["PO"]);
    expect(summaryLine(s)).toBe("1 of 2 done · On Track: CTR");
  });

  it("a team where every check is unticked has no summary — no badge", () => {
    const details = [d("PO", "Completed", false), d("NAV", "Behind", false)];
    expect(summariseTeam(details)).toBeUndefined();
    expect(teamLine(details)).toBe("Nothing applies");
    expect(notApplicableLine(details)).toBe("Not applicable: PO, NAV");
  });

  it("teamLine is the summary line where something applies, '' with no cells", () => {
    expect(teamLine([d("PO", "Behind"), d("NAV", "Completed", false)])).toBe("0 of 1 done · Behind: PO");
    expect(teamLine([])).toBe("");
    expect(notApplicableLine([d("PO", "Behind")])).toBe("");
  });

  it("teamDetails marks each cell by applies() and skips checks with no cell", () => {
    const checks = [teamCheck("L-BUD"), teamCheck("PO"), teamCheck("NAV"), teamCheck("CTR")];
    const details = teamDetails(checks, {
      "L-BUD": { status: "Completed", applies: true },
      PO: { status: "Behind", applies: false },
      // A frozen / history N/A on a team check: it didn't apply.
      NAV: { status: "N/A" },
    });
    expect(details).toEqual([
      { code: "L-BUD", label: "L-BUD label", status: "Completed", applies: true },
      { code: "PO", label: "PO label", status: "Behind", applies: false },
      { code: "NAV", label: "NAV label", status: "N/A", applies: false },
    ]);
  });

  it("Project gates always apply: all-N/A gates still summarise as grey N/A", () => {
    const gates = BUILTIN_PROJECT_GATES.slice(0, 3);
    const details = teamDetails(
      gates,
      Object.fromEntries(gates.map((g) => [g.code, { status: "N/A" as const }])),
    );
    expect(details.every((x) => x.applies)).toBe(true);
    const s = summariseTeam(details)!;
    expect(s.worst).toBe("N/A");
    expect(s.notApplicable).toEqual([]);
    expect(teamLine(details)).toBe("Nothing applies (all N/A)");
  });
});
