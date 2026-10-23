import { describe, it, expect } from "vitest";
import { barStripCodes, worstCheck, iconTier, siblingMarker, tagFits } from "@/lib/chart-layout";

describe("iconTier", () => {
  it("picks the strip tier by bar width, at the exact thresholds", () => {
    expect(iconTier(200)).toBe("full");
    expect(iconTier(135)).toBe("full");
    expect(iconTier(134)).toBe("half");
    expect(iconTier(90)).toBe("half");
    expect(iconTier(89)).toBe("grid");
    expect(iconTier(45)).toBe("grid");
    expect(iconTier(44)).toBe("single");
    expect(iconTier(0)).toBe("single");
  });
});

describe("tagFits", () => {
  it("fits a short tag on a wide bar", () => {
    expect(tagFits("PROJECT_2", 120)).toBe(true);
  });
  it("does not fit a long tag on a narrow bar", () => {
    expect(tagFits("Deepwater Block 17 Phase 2", 60)).toBe(false);
  });
  it("uses the ~6px/char + 10px padding estimate at the boundary", () => {
    // "ABCDE" → 5*6 + 10 = 40
    expect(tagFits("ABCDE", 40)).toBe(true);
    expect(tagFits("ABCDE", 39)).toBe(false);
  });
});

// Strip checks, as the lens hands them over: Project gates lock with the plan,
// a team's checks don't (spec §3.8).
const gate = (code: string) => ({ code, locks_with_plan: true });
const teamCheck = (code: string) => ({ code, locks_with_plan: false });
const GATES = ["FDP", "LLI", "LOC", "BUD"].map(gate);

describe("worstCheck", () => {
  it("returns null for no checks", () => {
    expect(worstCheck(null, GATES)).toBeNull();
    expect(worstCheck(undefined, GATES)).toBeNull();
    expect(worstCheck({}, GATES)).toBeNull();
  });

  it("picks Behind over less-severe statuses", () => {
    const w = worstCheck(
      {
        FDP: { status: "Completed" },
        LLI: { status: "Behind" },
        LOC: { status: "On Track" },
      },
      GATES,
    );
    expect(w).toEqual({ code: "LLI", status: "Behind" });
  });

  it("ranks On Track above Completed", () => {
    expect(
      worstCheck({ FDP: { status: "Completed" }, LLI: { status: "On Track" } }, GATES)?.status,
    ).toBe("On Track");
  });

  it("treats N/A as the least concerning — and all-N/A gates still give N/A (grey)", () => {
    expect(worstCheck({ FDP: { status: "N/A" }, LLI: { status: "Completed" } }, GATES)?.status).toBe(
      "Completed",
    );
    expect(worstCheck({ FDP: { status: "N/A" }, LLI: { status: "N/A" } }, GATES)).toEqual({
      code: "FDP",
      status: "N/A",
    });
  });

  it("drops team cells that don't apply before taking the worst (spec §5.1)", () => {
    const defs = [teamCheck("PO"), teamCheck("NAV")];
    // PO is Behind underneath, but unticked: it never colours the bar.
    expect(
      worstCheck(
        { PO: { status: "Behind", applies: false }, NAV: { status: "Completed", applies: true } },
        defs,
      ),
    ).toEqual({ code: "NAV", status: "Completed" });
    // Nothing applies → no icon at all (not a grey one).
    expect(worstCheck({ PO: { status: "Behind", applies: false } }, defs)).toBeNull();
  });
});

describe("barStripCodes", () => {
  const BADGES = [gate("projects"), teamCheck("wells"), teamCheck("logistics")];

  it("draws every Project gate, set or not (unset gates show their default, N/A grey)", () => {
    expect(barStripCodes(GATES, { FDP: { status: "Behind" }, LLI: { status: "N/A" } }, false)).toEqual(
      GATES.map((g) => g.code),
    );
  });

  it("draws only the team checks that apply, packed left in catalog order", () => {
    const defs = ["L-BUD", "CTR", "PO", "NAV"].map(teamCheck);
    const checks = {
      "L-BUD": { status: "Completed" as const, applies: true },
      CTR: { status: "Behind" as const, applies: false },
      PO: { status: "On Track" as const, applies: true },
      // NAV has no cell here (e.g. a project-only check on a well with no field
      // project): drawn like one that doesn't apply.
    };
    expect(barStripCodes(defs, checks, false)).toEqual(["L-BUD", "PO"]);
  });

  it("draws no strip on a bar where none of the team's checks applies", () => {
    const defs = ["PO", "NAV"].map(teamCheck);
    expect(
      barStripCodes(
        defs,
        { PO: { status: "Completed", applies: false }, NAV: { status: "On Track", applies: false } },
        false,
      ),
    ).toEqual([]);
  });

  it("drops a team with no readiness for the activity under the All lens", () => {
    // A well without a field project: no Project gates badge, only Logistics.
    expect(barStripCodes(BADGES, { logistics: { status: "Behind" } }, true)).toEqual(["logistics"]);
    expect(barStripCodes(BADGES, {}, true)).toEqual([]);
  });

  it("gives no badge to a team where nothing applies, but keeps grey all-N/A gates", () => {
    const checks = {
      projects: { status: "N/A" as const },
      logistics: { status: "N/A" as const, applies: false },
    };
    expect(barStripCodes(BADGES, checks, true)).toEqual(["projects"]);
  });

  it("keeps the strip order under the All lens", () => {
    const checks = { logistics: { status: "Completed" as const }, projects: { status: "On Track" as const } };
    expect(barStripCodes(BADGES, checks, true)).toEqual(["projects", "logistics"]);
  });
});


describe("siblingMarker — a project's other bars flag only blocked checks", () => {
  it("flags Behind and Not available alike (severity, not status text)", () => {
    expect(siblingMarker({ FDP: { status: "Behind" } }, GATES)).toEqual({ code: "FDP", status: "Behind" });
    // Not available survives only in a revision's history (NEQ, withdrawn).
    expect(siblingMarker({ NEQ: { status: "Not available" } }, [teamCheck("NEQ")])).toEqual({
      code: "NEQ",
      status: "Not available",
    });
  });

  it("still flags when an earlier blocked check ties a later Behind", () => {
    // NEQ comes first in catalog order — the old literal "Behind" test hid PO.
    expect(
      siblingMarker(
        { NEQ: { status: "Not available" }, PO: { status: "Behind" } },
        [teamCheck("NEQ"), teamCheck("PO")],
      ),
    ).toEqual({ code: "NEQ", status: "Not available" });
  });

  it("stays silent while nothing is blocked", () => {
    expect(
      siblingMarker({ FDP: { status: "On Track" }, LLI: { status: "Completed" }, BUD: { status: "Completed" } }, GATES),
    ).toBeNull();
    expect(siblingMarker(null, GATES)).toBeNull();
  });

  it("never flags a check that doesn't apply, however far behind it is underneath", () => {
    expect(
      siblingMarker(
        { PO: { status: "Behind", applies: false }, NAV: { status: "On Track", applies: true } },
        [teamCheck("PO"), teamCheck("NAV")],
      ),
    ).toBeNull();
  });
});
