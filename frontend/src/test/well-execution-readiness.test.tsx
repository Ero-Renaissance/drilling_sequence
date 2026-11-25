/**
 * Well execution readiness (readiness phase 8,
 * docs/well-execution-readiness-spec.md Part A): the Projects team's checks —
 * the former Project gates. Every well has each check and follows its field
 * project until it is given its own value; they have no tick list (N/A instead)
 * and an unset one reads Not started. The page itself is the shared sheet
 * (`ReadinessSheet.test.tsx`).
 */
import { describe, expect, it } from "vitest";

import { BUILTIN_PROJECT_GATES, BUILTIN_TEAMS, lensLabel } from "@/components/readiness/catalog";
import {
  STATUS_SEVERITY,
  defaultStatusOf,
  pickableStatuses,
  worstStatus,
} from "@/components/readiness/check-meta";
import { sumFigures } from "@/lib/readiness-figures";

describe("the definitions (phase 8)", () => {
  it("names each lens '<Team> Execution Readiness'", () => {
    expect(lensLabel(BUILTIN_TEAMS[0])).toBe("Well Execution Readiness");
    expect(lensLabel({ code: "logistics", name: "Logistics" })).toBe("Logistics Execution Readiness");
    expect(lensLabel({ code: "all", name: "All" })).toBe("All teams");
  });

  it("there are eight checks, at both levels, on the execution set", () => {
    expect(BUILTIN_PROJECT_GATES.map((c) => c.code)).toEqual([
      "FDP", "FID", "BUD", "FE", "EIA", "LLI", "LOC", "WP",
    ]);
    for (const c of BUILTIN_PROJECT_GATES) {
      expect(c.applies_project && c.applies_well && c.locks_with_plan).toBe(true);
      expect(defaultStatusOf(c.status_set)).toBe("Not started");
      // A label equal to its code would read "FID FID" beside the code.
      expect(c.label).not.toBe(c.code);
    }
    expect(pickableStatuses(BUILTIN_PROJECT_GATES[0])).toEqual([
      "Not started", "On Track", "Behind", "Completed", "N/A",
    ]);
  });

  it("Not started is counted but not on track, and ranks between Behind and On Track", () => {
    expect(STATUS_SEVERITY["Not started"]).toBe("not_started");
    expect(worstStatus(["Completed", "On Track", "Not started"])).toBe("Not started");
    expect(worstStatus(["Not started", "Behind"])).toBe("Behind");
    const f = sumFigures([
      { counted: 4, done: 1, in_progress: 1, not_started: 2, behind: 0, ready: false },
    ]);
    expect([f.complete_pct, f.on_track_pct, f.not_started]).toEqual([25, 50, 2]);
  });
});
