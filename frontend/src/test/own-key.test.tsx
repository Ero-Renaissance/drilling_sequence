/**
 * Team codes key the All lens's per-bar badges (chart, print) and are any
 * `^[a-z][a-z0-9-]{1,31}$` — so "constructor", an Object member, is a valid team
 * code. A bar with no badge for such a team must draw nothing for it: lookups
 * read own entries only (`lib/own-key.ts::ownValue`), never the inherited
 * `Object.prototype.constructor`.
 */
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  getAccessToken: async () => "test-token",
  msalInstance: { getAllAccounts: () => [], logoutRedirect: vi.fn() },
  loginRequest: {},
}));

import type { CatalogCheck, CatalogTeam } from "@/api/readiness";
import type { RevisionDetail } from "@/api/revisions";
import {
  BUILTIN_PROJECT_GATES,
  BUILTIN_TEAMS,
  ReadinessCatalogProvider,
  ReadinessLensProvider,
  statusOf,
  teamSummaryCheck,
} from "@/components/readiness/catalog";
import { RevisionPrintDoc, type PrintRow } from "@/components/revisions/RevisionPrintDoc";
import { barStripCodes, siblingMarker, worstCheck } from "@/lib/chart-layout";
import { ownValue } from "@/lib/own-key";
import { CatalogProbe, catalogLoaded } from "./catalog-probe";
import { server } from "./mocks/server";

const CONSTRUCTOR: CatalogTeam = {
  code: "constructor", name: "Construction", editor_source: "team_grant", icon_key: "hard-hat", sort_order: 30,
};
const CNS: CatalogCheck = {
  code: "CNS", label: "Construction permit", team_code: "constructor", applies_project: true,
  applies_well: true, status_set: "standard", icon_key: "stamp", locks_with_plan: false, sort_order: 10,
};
const TEAMS = [...BUILTIN_TEAMS, CONSTRUCTOR];
// The All lens's strip: one summary check per team.
const ALL_STRIP = TEAMS.map(teamSummaryCheck);

describe("ownValue", () => {
  it("reads own entries only", () => {
    expect(ownValue({ projects: 1 }, "projects")).toBe(1);
    expect(ownValue({ projects: 1 }, "constructor")).toBeUndefined();
    expect(ownValue({ projects: 1 }, "toString")).toBeUndefined();
    expect(ownValue({ constructor: 2 }, "constructor")).toBe(2);
    expect(ownValue(null, "projects")).toBeUndefined();
    expect(ownValue(undefined, "projects")).toBeUndefined();
  });

  it("statusOf reads its default for a code the row doesn't carry", () => {
    expect(statusOf({}, "constructor")).toBe("On Track");
  });
});

describe("the All lens strip with a team coded 'constructor'", () => {
  const cells = { projects: { status: "Behind" as const } };

  it("draws no badge for it on a bar with none", () => {
    expect(barStripCodes(ALL_STRIP, cells, true)).toEqual(["projects"]);
  });

  it("never picks it as the bar's worst or its marker", () => {
    expect(worstCheck(cells, ALL_STRIP)).toEqual({ code: "projects", status: "Behind" });
    expect(siblingMarker({}, ALL_STRIP)).toBeNull();
    expect(worstCheck({}, ALL_STRIP)).toBeNull();
  });

  it("still draws its badge where the bar has one", () => {
    expect(barStripCodes(ALL_STRIP, { ...cells, constructor: { status: "Completed" as const } }, true)).toEqual([
      "projects",
      "constructor",
    ]);
  });
});

describe("the All lens print with a team coded 'constructor'", () => {
  it("prints only the badges a row carries", async () => {
    server.use(
      http.get("/api/readiness/catalog", () =>
        HttpResponse.json({ teams: TEAMS, checks: [...BUILTIN_PROJECT_GATES, CNS], status_sets: {} }),
      ),
    );
    const row: PrintRow = {
      id: "w1", activity_type: "Drilling", start_date: "2033-01-05", end_date: "2033-02-20",
      well_name: "W-1", well_project: "Bonga Phase 3", rig_name: "RIG1", location: "LAND",
      plan_type: null, risk: null, readiness: { projects: "Completed" },
    };
    render(
      <ReadinessCatalogProvider>
        <CatalogProbe team="constructor" />
        <ReadinessLensProvider lens="all">
          <RevisionPrintDoc
            revision={{ id: "rev-1", rev_number: 1, status: "draft", integrity_digest: null, reviewer_status: [], approver_status: [], signatures: [] } as unknown as RevisionDetail}
            project={null}
            rows={[row]}
            chart="readiness"
            includeSchedule
            signatures="wetink"
          />
        </ReadinessLensProvider>
      </ReadinessCatalogProvider>,
    );
    await catalogLoaded();
    const strip = screen.getAllByTestId("gantt-readiness-strip")[0];
    // The Project gates badge only — no phantom "Construction" badge.
    expect(strip.querySelectorAll("svg")).toHaveLength(1);
  });
});
