/**
 * The Sequence chart and checks that apply (spec §3.8, §8.3): a team lens draws
 * only the checks that apply to a bar, packed left, and no strip where none
 * does; its tooltip lists the rest muted ("Not applicable: …"). The All lens
 * gives no badge to a team where nothing applies ("Nothing applies"). The
 * Project gates are unchanged — every gate, N/A drawn grey.
 *
 * Drives the real option: renderItem with a stub API, and the tooltip formatter.
 */
import { render, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { http, HttpResponse } from "msw";

const captured = vi.hoisted(() => ({ option: undefined as unknown }));
vi.mock("echarts-for-react/lib/core", () => ({
  default: ({ option, style }: { option?: unknown; style?: React.CSSProperties }) => {
    captured.option = option;
    return <div data-testid="echarts-instance" style={style} />;
  },
}));

vi.mock("@/lib/auth", () => ({
  getAccessToken: async () => "test-token",
  msalInstance: { getAllAccounts: () => [], logoutRedirect: vi.fn() },
  loginRequest: {},
}));

import type { Activity } from "@/api/activities";
import type { CatalogCheck, CatalogTeam, CheckStatus } from "@/api/readiness";
import { DrillChart } from "@/components/chart/DrillChart";
import {
  BUILTIN_PROJECT_GATES,
  BUILTIN_TEAMS,
  ReadinessCatalogProvider,
  ReadinessLensProvider,
} from "@/components/readiness/catalog";
import { buildCheckSvgDataUri } from "@/lib/check-icon-svg";
import type { ChartCheckState, ReadinessMap } from "@/lib/chart-utils";
import { server } from "./mocks/server";
import { CatalogProbe, catalogLoaded } from "./catalog-probe";

const LOGISTICS: CatalogTeam = {
  code: "logistics", name: "Logistics", editor_source: "team_grant", icon_key: "truck", sort_order: 20,
};
const check = (code: string, icon_key: string, sort_order: number): CatalogCheck => ({
  code, label: `${code} label`, team_code: "logistics", applies_project: true, applies_well: true,
  status_set: "standard", icon_key, locks_with_plan: false, sort_order,
});
const LBUD = check("L-BUD", "hand-coins", 10);
const CTR = check("CTR", "file-signature", 20);
const NAV = check("NAV", "ship", 30);
const PO = check("PO", "receipt", 40);

const ACT = {
  id: "a1", project_id: "p1", activity_type: "Oil Development", start_date: "2026-01-01",
  end_date: "2026-04-01", well_name: "W-1", rig_name: "Rig A", well_project: "Bonga Phase 3",
  location: "SWAMP", project_group: null, risk: null, comment: null, plan_type: "Firm",
  completed_at: null, readiness_required: true, updated_at: "2026-05-25T08:00:00Z",
  updated_by_name: null, locked_by_revision_id: null,
} as unknown as Activity;

beforeEach(() => {
  captured.option = undefined;
  server.use(
    http.get("/api/readiness/catalog", () =>
      HttpResponse.json({
        teams: [...BUILTIN_TEAMS, LOGISTICS],
        checks: [...BUILTIN_PROJECT_GATES, LBUD, CTR, NAV, PO],
        status_sets: {},
      }),
    ),
  );
});

type BarSeries = {
  encode?: { x?: unknown };
  data: { value: unknown[]; tooltip: Record<string, unknown> }[];
  renderItem: (params: unknown, api: unknown) => { children: { type: string; style: { image?: string } }[] };
};
type Option = { series: BarSeries[]; tooltip: { formatter: (p: unknown) => string } };

async function renderChart(lens: string, cells: Record<string, ChartCheckState>, waitFor_: string) {
  const map: ReadinessMap = new Map([["a1", cells]]);
  render(
    <ReadinessCatalogProvider>
      <CatalogProbe team="logistics" />
      <ReadinessLensProvider lens={lens}>
        <DrillChart activities={[ACT]} readinessMap={map} readinessKeyOf={(a) => a.id} />
      </ReadinessLensProvider>
    </ReadinessCatalogProvider>,
  );
  // The live catalog (with the Logistics team) is in the option — a header
  // alone can render from the built-in fallback first (catalog-probe.tsx).
  await catalogLoaded();
  await waitFor(() => expect(tooltipOf()).toContain(waitFor_));
}

function bars(): BarSeries {
  const option = captured.option as Option;
  return option.series.find((s) => Array.isArray(s.encode?.x))!;
}

/** The icon images one bar's renderItem draws, on a wide bar (full tier). */
function stripImages(): string[] {
  const series = bars();
  const item = series.data[0];
  const start = item.value[1] as number;
  const api = {
    value: (i: number) => item.value[i],
    // 4px per day: a 90-day bar is ~360px wide.
    coord: ([x]: [number, number]) => [100 + ((x - start) / 86_400_000) * 4, 200],
    size: () => [0, 56],
    visual: () => "#888888",
  };
  const params = { dataIndex: 0, coordSys: { x: 0, y: 0, width: 100_000, height: 1_000 } };
  return series
    .renderItem(params, api)
    .children.filter((c) => c.type === "image")
    .map((c) => c.style.image ?? "");
}

function tooltipOf(): string {
  const option = captured.option as Option | undefined;
  if (!option) return "";
  const item = bars().data[0];
  return option.tooltip.formatter({ data: item });
}

const icon = (c: Pick<CatalogCheck, "icon_key">, status: CheckStatus) => buildCheckSvgDataUri(c.icon_key, status);
const cell = (status: CheckStatus, applies = true): ChartCheckState => ({ status, applies });

describe("a team lens draws only the checks that apply", () => {
  it("drops unticked checks from the strip, packed left — the status underneath never shows", async () => {
    await renderChart(
      "logistics",
      { "L-BUD": cell("Completed"), CTR: cell("Behind", false), NAV: cell("On Track"), PO: cell("Behind", false) },
      "LOGISTICS READINESS",
    );
    expect(stripImages()).toEqual([icon(LBUD, "Completed"), icon(NAV, "On Track")]);
  });

  it("draws no strip where nothing applies, and skips an omitted cell", async () => {
    await renderChart("logistics", { "L-BUD": cell("Behind", false), CTR: cell("Completed", false) }, "LOGISTICS READINESS");
    expect(stripImages()).toEqual([]);
  });

  it("its tooltip lists the checks that apply, then the rest muted", async () => {
    await renderChart(
      "logistics",
      { "L-BUD": cell("Completed"), CTR: cell("Behind", false), NAV: cell("On Track"), PO: cell("Behind", false) },
      "LOGISTICS READINESS",
    );
    const html = tooltipOf();
    expect(html).toContain("L-BUD label");
    expect(html).toContain("NAV label");
    expect(html).toContain("Not applicable: CTR, PO");
    // The unticked checks aren't listed with a status of their own.
    expect(html).not.toContain("CTR label");
    expect(html).not.toContain(icon(PO, "Behind"));
  });

  it("a bar where nothing applies reads 'Nothing applies'", async () => {
    await renderChart("logistics", { "L-BUD": cell("Behind", false), NAV: cell("On Track", false) }, "LOGISTICS READINESS");
    const html = tooltipOf();
    expect(html).toContain("Nothing applies");
    expect(html).toContain("Not applicable: L-BUD, NAV");
  });
});

describe("the All lens", () => {
  it("gives no badge to a team where nothing applies; its tooltip says so", async () => {
    await renderChart(
      "all",
      {
        projects: { status: "Behind", details: [{ code: "FID", label: "FID", status: "Behind", applies: true }] },
        logistics: {
          status: "N/A",
          applies: false,
          details: [
            { code: "NAV", label: "NAV", status: "Behind", applies: false },
            { code: "PO", label: "PO", status: "Completed", applies: false },
          ],
        },
      },
      "READINESS BY TEAM",
    );
    expect(stripImages()).toEqual([icon(BUILTIN_TEAMS[0], "Behind")]);
    const html = tooltipOf();
    expect(html).toContain("Nothing applies");
    expect(html).toContain("Not applicable: NAV, PO");
    // No grey Logistics badge in the tooltip either.
    expect(html).not.toContain(icon(LOGISTICS, "N/A"));
  });

  it("a team's badge is the worst of the checks that apply; the rest are listed muted", async () => {
    await renderChart(
      "all",
      {
        logistics: {
          status: "On Track",
          details: [
            { code: "NAV", label: "NAV", status: "Behind", applies: false },
            { code: "PO", label: "PO", status: "On Track", applies: true },
          ],
        },
      },
      "READINESS BY TEAM",
    );
    expect(stripImages()).toEqual([icon(LOGISTICS, "On Track")]);
    const html = tooltipOf();
    expect(html).toContain("Not applicable: NAV");
    expect(html).toContain("0 of 1 done");
  });
});

describe("the All lens with a team coded 'constructor' (a valid team code)", () => {
  it("draws no phantom badge and no tooltip block for it on a bar with none", async () => {
    const CONSTRUCTOR: CatalogTeam = {
      code: "constructor", name: "Construction", editor_source: "team_grant", icon_key: "hard-hat", sort_order: 30,
    };
    server.use(
      http.get("/api/readiness/catalog", () =>
        HttpResponse.json({
          teams: [...BUILTIN_TEAMS, LOGISTICS, CONSTRUCTOR],
          checks: [
            ...BUILTIN_PROJECT_GATES, LBUD, CTR, NAV, PO,
            { ...check("CNS", "stamp", 10), team_code: "constructor" },
          ],
          status_sets: {},
        }),
      ),
    );
    await renderChart(
      "all",
      {
        logistics: {
          status: "On Track",
          details: [{ code: "PO", label: "PO", status: "On Track", applies: true }],
        },
      },
      "READINESS BY TEAM",
    );
    expect(stripImages()).toEqual([icon(LOGISTICS, "On Track")]);
    const html = tooltipOf();
    expect(html).not.toContain("Construction");
    expect(html).not.toContain("undefined");
  });
});

describe("the Project gates lens is unchanged", () => {
  it("draws every gate — an N/A gate in grey — and lists them all", async () => {
    const gates = Object.fromEntries(
      BUILTIN_PROJECT_GATES.map((g, i) => [g.code, { status: (i === 0 ? "N/A" : "Completed") as CheckStatus }]),
    );
    await renderChart("projects", gates, "PROJECT READINESS");
    expect(stripImages()).toEqual(
      BUILTIN_PROJECT_GATES.map((g, i) => icon(g, i === 0 ? "N/A" : "Completed")),
    );
    const html = tooltipOf();
    expect(html).toContain("N/A");
    expect(html).not.toContain("Not applicable");
    expect(html).not.toContain("Nothing applies");
  });

  it("an all-N/A field project keeps its grey icons", async () => {
    const gates = Object.fromEntries(BUILTIN_PROJECT_GATES.map((g) => [g.code, { status: "N/A" as CheckStatus }]));
    await renderChart("projects", gates, "PROJECT READINESS");
    expect(stripImages()).toEqual(BUILTIN_PROJECT_GATES.map((g) => icon(g, "N/A")));
  });
});
