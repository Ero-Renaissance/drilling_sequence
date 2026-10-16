import { describe, it, expect } from "vitest";
import type { CheckStatus } from "@/api/readiness";
import { summariseTeam, summaryLine, type TeamCheckDetail } from "@/lib/team-summary";

const d = (code: string, status: CheckStatus, tags?: string[]): TeamCheckDetail => ({
  code,
  label: code,
  status,
  ...(tags ? { tags } : {}),
});

describe("team summary", () => {
  it("counts like the dashboard tiles: Available is done, N/A is not counted", () => {
    const s = summariseTeam([
      d("L-BUD", "Completed"),
      d("NEQ", "Available", ["RW"]),
      d("CTS", "N/A"),
      d("PO", "On Track"),
    ])!;
    expect([s.done, s.total]).toEqual([2, 3]);
    expect(s.worst).toBe("On Track");
    expect(summaryLine(s)).toBe("2 of 3 done · On Track: PO");
  });

  it("names only what needs attention, worst first, grouped by status, with equipment", () => {
    const s = summariseTeam([
      d("L-BUD", "Completed"),
      d("CTR", "On Track"),
      d("NEQ", "Not available", ["RW", "DSV"]),
      d("FFP", "Behind"),
      d("PO", "Behind"),
    ])!;
    expect(s.worst).toBe("Behind");
    expect(summaryLine(s)).toBe(
      "1 of 5 done · Not available: NEQ (RW, DSV) · Behind: FFP, PO · On Track: CTR",
    );
  });

  it("caps the named checks and says how many more", () => {
    const s = summariseTeam(["A", "B", "C", "D", "E", "F"].map((c) => d(c, "Behind")))!;
    expect(summaryLine(s)).toBe("0 of 6 done · Behind: A, B, C, D · +2 more");
    expect(summaryLine(s, 2)).toBe("0 of 6 done · Behind: A, B · +4 more");
  });

  it("says when everything is done, or nothing applies", () => {
    expect(summaryLine(summariseTeam([d("A", "Completed"), d("B", "Available"), d("C", "N/A")])!)).toBe(
      "All 2 done",
    );
    expect(summaryLine(summariseTeam([d("A", "N/A")])!)).toBe("Nothing applies (all N/A)");
    expect(summariseTeam([])).toBeUndefined();
  });
});
