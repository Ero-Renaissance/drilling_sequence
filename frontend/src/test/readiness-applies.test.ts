/**
 * Phase 6 "Checks that apply" (docs/readiness-framework-spec.md §3.3, §3.8,
 * §5.1, §8.3, §8.4, §8.7): the one `applies()` rule, the pickable-status and
 * legend rules, the wording helpers, and the applicability API client.
 */
import { describe, it, expect, vi } from "vitest";
import { http, HttpResponse } from "msw";

vi.mock("@/lib/auth", () => ({
  getAccessToken: async () => "test-token",
  msalInstance: { getAllAccounts: () => [], logoutRedirect: vi.fn() },
  loginRequest: {},
}));

import { ApiError } from "@/api/http";
import {
  setApplicability,
  setReadiness,
  type ApplicabilityResult,
  type CatalogCheck,
  type CatalogTeam,
  type CheckStatus,
  type TeamReadiness,
} from "@/api/readiness";
import { BUILTIN_PROJECT_GATES, BUILTIN_TEAMS, lensChecksOf } from "@/components/readiness/catalog";
import {
  NOTHING_APPLIES,
  NOT_APPLICABLE,
  STATUS_SETS,
  applies,
  legendStatuses,
  notApplicableLabel,
  pickableStatuses,
  statusLabelOf,
  worstStatus,
} from "@/components/readiness/check-meta";
import { barStripCodes, worstCheck } from "@/lib/chart-layout";
import { notCountedLabel, readinessFiguresHint } from "@/lib/readiness-figures";
import { loadLensReadiness, printedReadiness } from "@/lib/readiness-lens";
import { server } from "./mocks/server";

const PID = "cccccccc-0000-0000-0000-000000000001";
const LOGISTICS: CatalogTeam = {
  code: "logistics", name: "Logistics", editor_source: "team_grant", icon_key: "truck", sort_order: 20,
};
const teamCheck = (code: string, over: Partial<CatalogCheck> = {}): CatalogCheck => ({
  code, label: code, team_code: "logistics", applies_project: true, applies_well: true,
  status_set: "standard", icon_key: "receipt", locks_with_plan: false, sort_order: 10, ...over,
});
const FDP = BUILTIN_PROJECT_GATES[0];
const PO = teamCheck("PO");
const NAV = teamCheck("NAV", { sort_order: 20 });
const CTR = teamCheck("CTR", { sort_order: 30 });

describe("applies(cell, check) — the one rule (spec §5.1)", () => {
  it("a Project gate always applies — N/A is its status, drawn grey", () => {
    expect(applies({ status: "N/A" }, FDP)).toBe(true);
    expect(applies({ status: "Behind" }, FDP)).toBe(true);
    // An unset gate reads its default.
    expect(applies(undefined, FDP)).toBe(true);
  });

  it("a live team cell applies unless it says applies: false", () => {
    expect(applies({ status: "Completed", applies: true }, PO)).toBe(true);
    // Unticked: the status underneath is kept, but the cell doesn't apply.
    expect(applies({ status: "Completed", applies: false }, PO)).toBe(false);
  });

  it("a frozen snapshot cell (no `applies`) reading N/A didn't apply", () => {
    expect(applies({ status: "N/A" }, PO)).toBe(false);
    expect(applies({ status: "Behind" }, PO)).toBe(true);
    // NEQ's history statuses still render.
    expect(applies({ status: "Not available" }, teamCheck("NEQ", { status_set: "availability" }))).toBe(true);
  });

  it("a team check never draws N/A — and a missing team cell is drawn like one that doesn't apply", () => {
    expect(applies({ status: "N/A", applies: true }, PO)).toBe(false);
    expect(applies(undefined, PO)).toBe(false);
    expect(applies(null, PO)).toBe(false);
  });

  it("follows the definition, not the team: a governed check keeps N/A wherever it sits", () => {
    // A check that locks with the plan outside the Projects team (possible only
    // between 2026-10-13 and -16) keeps N/A and gets no tick (spec §3.8).
    expect(applies({ status: "N/A" }, teamCheck("OLD", { locks_with_plan: true }))).toBe(true);
  });
});

describe("pickableStatuses — what a status menu offers (spec §3.3)", () => {
  it("a team check: On Track, Behind, Completed — no N/A (untick it instead)", () => {
    expect(pickableStatuses(PO)).toEqual(["On Track", "Behind", "Completed"]);
    expect(pickableStatuses(PO)).not.toContain("N/A");
  });

  it("a Project gate keeps N/A", () => {
    expect(pickableStatuses(FDP)).toEqual(["On Track", "Behind", "Completed", "N/A"]);
  });

  it("a history-only set offers nothing; an unknown set reads as standard", () => {
    expect(STATUS_SETS.availability.history_only).toBe(true);
    expect(pickableStatuses(teamCheck("NEQ", { status_set: "availability" }))).toEqual([]);
    expect(pickableStatuses(teamCheck("X", { status_set: "nope" }))).toEqual(["On Track", "Behind", "Completed"]);
  });

  it("never mutates the shared STATUS_SETS literal", () => {
    pickableStatuses(FDP).pop();
    expect(STATUS_SETS.standard.statuses).toContain("N/A");
  });
});

describe("legendStatuses — a legend lists what its icons can show (spec §8.4)", () => {
  it("a team lens's legend has no N/A", () => {
    expect(legendStatuses([PO, NAV])).toEqual(["On Track", "Behind", "Completed"]);
  });

  it("the Project gates' legend, and the All lens's, keep N/A", () => {
    expect(legendStatuses(BUILTIN_PROJECT_GATES)).toContain("N/A");
    const all = lensChecksOf(BUILTIN_PROJECT_GATES, "all", [...BUILTIN_TEAMS, LOGISTICS]);
    expect(legendStatuses(all)).toEqual(["On Track", "Behind", "Completed", "N/A"]);
    // …because the Project gates badge locks with the plan.
    expect(all.find((c) => c.code === "projects")?.locks_with_plan).toBe(true);
    expect(all.find((c) => c.code === "logistics")?.locks_with_plan).toBe(false);
  });
});

describe("wording (spec §8.7)", () => {
  it("a team check that doesn't apply reads 'Not applicable'; a gate keeps 'N/A'", () => {
    expect(NOT_APPLICABLE).toBe("Not applicable");
    expect(NOTHING_APPLIES).toBe("Nothing applies");
    expect(notApplicableLabel(PO)).toBe("Not applicable");
    expect(notApplicableLabel(FDP)).toBe("N/A");
    expect(statusLabelOf("N/A", PO)).toBe("Not applicable");
    expect(statusLabelOf("N/A", FDP)).toBe("N/A");
    expect(statusLabelOf("Behind", PO)).toBe("Behind");
  });

  it("figures hints and not-counted labels follow the view", () => {
    expect(readinessFiguresHint(true)).toMatch(/N\/A isn't counted/);
    expect(readinessFiguresHint(false)).toMatch(/a check that doesn't apply isn't counted/);
    expect(readinessFiguresHint(false)).not.toMatch(/N\/A/);
    expect(notCountedLabel(true)).toBe("N/A");
    expect(notCountedLabel(false)).toBe("not applicable");
  });

  it("worstStatus is unchanged: callers drop what doesn't apply first", () => {
    expect(worstStatus(["N/A", "N/A"])).toBe("N/A");
    expect(worstStatus([])).toBeUndefined();
  });
});

describe("a team lens on the chart", () => {
  function team(): TeamReadiness {
    const cell = (status: CheckStatus, isApplied: boolean, source: "well" | "project" | "default") => ({
      status, notes: null, updated_at: null, source,
      applies: isApplied, applies_source: isApplied ? ("default" as const) : source,
    });
    return {
      team: LOGISTICS,
      checks: [PO, NAV, CTR],
      project_rows: [],
      well_rows: [
        {
          well_project: "Bonga Phase 3", well_name: "W-1", activity_type: "Oil Development",
          activity_count: 1, location: "SWAMP", start_date: "2026-11-01", focus_start: "2026-11-01",
          checks: {
            PO: cell("On Track", true, "default"),
            NAV: cell("Behind", false, "project"),
            CTR: cell("Completed", true, "well"),
          },
        },
        {
          well_project: "Bonga Phase 3", well_name: "W-2", activity_type: "Oil Development",
          activity_count: 1, location: "SWAMP", start_date: "2026-12-01", focus_start: "2026-12-01",
          checks: {
            PO: cell("Completed", false, "well"),
            NAV: cell("Behind", false, "project"),
            CTR: cell("Completed", false, "well"),
          },
        },
      ],
      locked: false,
    };
  }

  it("keeps unticked cells for the tooltip, but draws only the checks that apply", async () => {
    server.use(http.get("/api/projects/:projectId/readiness/teams/:team", () => HttpResponse.json(team())));
    const { map } = await loadLensReadiness(PID, "logistics");
    const w1 = map.get("Bonga Phase 3\u0001W-1\u0001Oil Development")!;
    expect(w1.NAV).toMatchObject({ status: "Behind", applies: false });
    // Packed left: PO, CTR — NAV (Behind underneath) is neither drawn nor worst.
    expect(barStripCodes([PO, NAV, CTR], w1, false)).toEqual(["PO", "CTR"]);
    expect(worstCheck(w1, [PO, NAV, CTR])).toEqual({ code: "PO", status: "On Track" });

    // A well where every check is unticked draws no strip and no single icon.
    const w2 = map.get("Bonga Phase 3\u0001W-2\u0001Oil Development")!;
    expect(barStripCodes([PO, NAV, CTR], w2, false)).toEqual([]);
    expect(worstCheck(w2, [PO, NAV, CTR])).toBeNull();
  });
});

describe("printedReadiness — a live print row's icons (spec §8.4)", () => {
  it("never prints the status kept under an unticked team check", () => {
    const cells = {
      PO: { status: "Behind" as CheckStatus, applies: false },
      NAV: { status: "Completed" as CheckStatus, applies: true },
    };
    expect(printedReadiness(cells, [PO, NAV, CTR], false)).toEqual({ NAV: "Completed" });
    expect(printedReadiness({ PO: cells.PO }, [PO, NAV], false)).toBeUndefined();
    expect(printedReadiness(undefined, [PO], false)).toBeUndefined();
  });

  it("prints the Project gates as they read — N/A included", () => {
    const gates = BUILTIN_PROJECT_GATES.slice(0, 2);
    const cells = { [gates[0].code]: { status: "N/A" as CheckStatus }, [gates[1].code]: { status: "Behind" as CheckStatus } };
    expect(printedReadiness(cells, gates, false)).toEqual({ [gates[0].code]: "N/A", [gates[1].code]: "Behind" });
  });

  it("prints no All-lens badge for a team where nothing applies", () => {
    const strip = lensChecksOf(BUILTIN_PROJECT_GATES, "all", [...BUILTIN_TEAMS, LOGISTICS]);
    expect(
      printedReadiness(
        { projects: { status: "N/A" }, logistics: { status: "N/A", applies: false } },
        strip,
        true,
      ),
    ).toEqual({ projects: "N/A" });
  });
});

describe("setApplicability — PUT …/readiness/teams/{team}/applicability", () => {
  const result: ApplicabilityResult = { project_rows: [], well_rows: [] };

  it("sends the target and the listed codes in the body — never a name in the URL", async () => {
    const seen: { url?: string; method?: string; body?: unknown } = {};
    server.use(
      http.put("/api/projects/:projectId/readiness/teams/:team/applicability", async ({ request }) => {
        Object.assign(seen, { url: request.url, method: request.method, body: await request.json() });
        return HttpResponse.json(result);
      }),
    );
    const body = {
      scope: "well" as const,
      well_project: "Egbema Node FOD + IOGD",
      well_name: "EGB-12",
      activity_type: "Oil Development",
      applies: { PO: false, NAV: true, CTR: null },
    };
    await expect(setApplicability(PID, "logistics", body)).resolves.toEqual(result);
    expect(seen.method).toBe("PUT");
    expect(new URL(seen.url!).pathname).toBe(
      `/api/projects/${PID}/readiness/teams/logistics/applicability`,
    );
    expect(seen.url).not.toContain("Egbema");
    expect(seen.body).toEqual(body);
  });

  it("encodes the team code in the path", async () => {
    let path = "";
    server.use(
      http.put("/api/projects/:projectId/readiness/teams/:team/applicability", ({ request }) => {
        path = new URL(request.url).pathname;
        return HttpResponse.json(result);
      }),
    );
    await setApplicability(PID, "supply chain", {
      scope: "project",
      well_project: "Bonga Phase 3",
      applies: { PO: true },
    });
    expect(path).toBe(`/api/projects/${PID}/readiness/teams/supply%20chain/applicability`);
  });

  it.each([
    [403, "Insufficient role for this action"],
    [422, "The Project gates use N/A"],
  ])("surfaces the server's %i detail", async (status, detail) => {
    server.use(
      http.put("/api/projects/:projectId/readiness/teams/:team/applicability", () =>
        HttpResponse.json({ detail }, { status }),
      ),
    );
    const call = setApplicability(PID, "logistics", {
      scope: "project",
      well_project: "Bonga Phase 3",
      applies: { PO: false },
    });
    await expect(call).rejects.toBeInstanceOf(ApiError);
    await expect(call).rejects.toMatchObject({ status, message: detail });
  });

  it("the status PUT sends no tags any more (the server forbids unknown fields)", async () => {
    let body: Record<string, unknown> = {};
    server.use(
      http.put("/api/projects/:projectId/readiness/:checkCode", async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({});
      }),
    );
    await setReadiness(PID, "PO", { scope: "project", well_project: "Bonga Phase 3" }, "Behind");
    expect(body).toEqual({ scope: "project", well_project: "Bonga Phase 3", status: "Behind", notes: null });
  });
});
