/**
 * Phase 7 on the Sequence chart (docs/readiness-framework-spec.md §8.8): under a
 * team lens a category draws ONE icon — the worst of its types that apply —
 * after the core checks; the tooltip names its types worst first ("Vessels (2):
 * PSV Behind · DSV On Track"), words look-alike codes with their label, and
 * lists only the checks a row unticked as "Not applicable" (at most 6, then
 * "+N more") — never one that is not selected. The legend shows the core checks
 * plus one entry per category.
 *
 * Drives the real option: renderItem with a stub API, and the tooltip formatter.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
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
import type { CatalogCheck, CheckStatus } from "@/api/readiness";
import { ChartLegend } from "@/components/chart/ChartLegend";
import { DrillChart } from "@/components/chart/DrillChart";
import {
  BUILTIN_PROJECT_GATES,
  BUILTIN_TEAMS,
  FrozenCatalogProvider,
  ReadinessCatalogProvider,
  ReadinessLensProvider,
} from "@/components/readiness/catalog";
import { buildCheckSvgDataUri } from "@/lib/check-icon-svg";
import type { ChartCheckState, ReadinessMap } from "@/lib/chart-utils";
import { summariseTeam, teamDetails } from "@/lib/team-summary";
import {
  CTR,
  LBUD,
  LOGISTICS,
  LOGISTICS_CHECKS,
  PO,
  W1_CELLS,
  wcell,
} from "./equipment-fixtures";
import { server } from "./mocks/server";
import { CatalogProbe, catalogLoaded } from "./catalog-probe";

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
        checks: [...BUILTIN_PROJECT_GATES, ...LOGISTICS_CHECKS],
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

/** The icon images one bar's renderItem draws, at `pxPerDay` (4 → a ~360px bar). */
function stripImages(pxPerDay = 4): string[] {
  const series = bars();
  const item = series.data[0];
  const start = item.value[1] as number;
  const api = {
    value: (i: number) => item.value[i],
    coord: ([x]: [number, number]) => [100 + ((x - start) / 86_400_000) * pxPerDay, 200],
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
  return option.tooltip.formatter({ data: bars().data[0] });
}

const icon = (c: Pick<CatalogCheck, "icon_key">, status: CheckStatus) => buildCheckSvgDataUri(c.icon_key, status);

describe("a team lens rolls each category up to one icon", () => {
  it("draws the core checks that apply, then one icon per category with a type that applies", async () => {
    await renderChart("logistics", W1_CELLS, "LOGISTICS READINESS");
    // L-BUD, CTR, PO apply (NAV unticked); Vessels is Behind (PSV), Lifting
    // Completed (CR); Barges has no type that applies — no icon.
    expect(stripImages()).toEqual([
      icon(LBUD, "Completed"),
      icon(CTR, "On Track"),
      icon(PO, "On Track"),
      buildCheckSvgDataUri("anchor", "Behind"),
      buildCheckSvgDataUri("construction", "Completed"),
    ]);
  });

  it("the single-icon tier shows the worst — a category's when it is", async () => {
    await renderChart("logistics", W1_CELLS, "LOGISTICS READINESS");
    // A ~20px bar: one icon, the worst of the strip — Vessels' Behind.
    expect(stripImages(0.25)).toEqual([buildCheckSvgDataUri("anchor", "Behind")]);
  });

  it("a bar whose types are all not selected draws only its core checks — figures don't move", async () => {
    const cells = Object.fromEntries(
      Object.entries(W1_CELLS).map(([code, c]) =>
        LOGISTICS_CHECKS.find((d) => d.code === code)?.category
          ? [code, wcell("On Track", false, "default", "default")]
          : [code, c],
      ),
    );
    await renderChart("logistics", cells, "LOGISTICS READINESS");
    expect(stripImages()).toEqual([icon(LBUD, "Completed"), icon(CTR, "On Track"), icon(PO, "On Track")]);
    const html = tooltipOf();
    expect(html).not.toContain("Vessels");
    expect(html).toContain("Not applicable: NAV");
    expect(html).not.toMatch(/DSV|PSV|PC|JUB|CBG|CR\b/);
  });
});

describe("the team-lens tooltip names a category's types", () => {
  it("one line per category, worst first; look-alike codes get their label", async () => {
    await renderChart("logistics", W1_CELLS, "LOGISTICS READINESS");
    const html = tooltipOf();
    expect(html).toContain("Vessels (2): PSV Behind · DSV On Track");
    expect(html).toContain("Lifting (1): CR (Crane) Completed");
    expect(html).not.toContain("Barges");
    // Core lines as before.
    expect(html).toContain("Budget Availability");
    // Only a check a row unticked is "Not applicable" — not the 3 not selected.
    expect(html).toContain("Not applicable: NAV");
    expect(html).not.toMatch(/JUB|CBG|Personnel Carrier/);
  });

  it("caps 'Not applicable' at 6 codes, then '+N more'", async () => {
    // Eight checks a row unticked.
    const cells: Record<string, ChartCheckState> = Object.fromEntries(
      LOGISTICS_CHECKS.map((c) => [
        c.code,
        c.code === "CTR" || c.code === "PO"
          ? wcell("On Track", true, "default", "default")
          : wcell("Completed", false, "well", "well"),
      ]),
    );
    await renderChart("logistics", cells, "LOGISTICS READINESS");
    expect(tooltipOf()).toContain(
      "Not applicable: L-BUD, NAV, DSV, PSV, PC (Personnel Carrier), JUB · +2 more",
    );
  });

  it("escapes admin-entered category names woven into the tooltip HTML", async () => {
    const evil = { ...LOGISTICS_CHECKS[4], category: "<img src=x onerror=alert(1)>" };
    server.use(
      http.get("/api/readiness/catalog", () =>
        HttpResponse.json({
          teams: [...BUILTIN_TEAMS, LOGISTICS],
          checks: [...BUILTIN_PROJECT_GATES, ...LOGISTICS_CHECKS.slice(0, 4), evil],
          status_sets: {},
        }),
      ),
    );
    await renderChart("logistics", W1_CELLS, "LOGISTICS READINESS");
    const html = tooltipOf();
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt; (1): DSV On Track");
  });

  it("the Project gates lens is unchanged", async () => {
    const gates = Object.fromEntries(
      BUILTIN_PROJECT_GATES.map((g) => [g.code, { status: "Completed" as CheckStatus }]),
    );
    await renderChart("projects", gates, "PROJECT READINESS");
    expect(stripImages()).toEqual(BUILTIN_PROJECT_GATES.map((g) => icon(g, "Completed")));
  });
});

describe("the All-lens tooltip words look-alike codes like the team lens (spec §3.4)", () => {
  it("labels CR/CTR and PC/PO in a team's summary and 'Not applicable' lines", async () => {
    // W-1, but CR Behind and PC unticked on the well itself — "Not
    // applicable" (a row says so), not "not selected".
    const cells = {
      ...W1_CELLS,
      CR: wcell("Behind", true, "well", "well"),
      PC: wcell("On Track", false, "well", "well"),
    };
    // The badge as readiness-lens.ts builds it: details over the team's FULL checks.
    const details = teamDetails(LOGISTICS_CHECKS, cells);
    const badge: ChartCheckState = { status: summariseTeam(details)!.worst, details };
    await renderChart("all", { logistics: badge }, "READINESS BY TEAM");
    const html = tooltipOf();
    expect(html).toContain(
      "1 of 6 done · Behind: PSV, CR (Crane) · On Track: CTR (Contract Availability), PO (Purchase Order) · +1 more",
    );
    expect(html).toContain("Not applicable: NAV, PC (Personnel Carrier)");
    // Codes with no look-alike stay bare; the not-selected types aren't named.
    expect(html).not.toContain("PSV (");
    expect(html).not.toMatch(/JUB|CBG/);
  });

  it("the Project gates badge keeps bare codes", async () => {
    const gates = BUILTIN_PROJECT_GATES;
    const details = teamDetails(
      gates,
      Object.fromEntries(gates.map((g) => [g.code, { status: "Behind" as CheckStatus }])),
    );
    await renderChart("all", { projects: { status: "Behind", details } }, "READINESS BY TEAM");
    expect(tooltipOf()).toContain(`Behind: ${gates.slice(0, 4).map((g) => g.code).join(", ")}`);
  });
});

describe("ChartLegend — core checks plus one entry per category", () => {
  it("names each category once, not its types", () => {
    render(
      <FrozenCatalogProvider checks={[...BUILTIN_PROJECT_GATES, ...LOGISTICS_CHECKS]}>
        <ReadinessLensProvider lens="logistics">
          <ChartLegend activityTypes={["Drilling"]} />
        </ReadinessLensProvider>
      </FrozenCatalogProvider>,
    );
    const section = screen.getByText("Readiness").parentElement!;
    const entries = within(section).getAllByTitle(/.+/).map((e) => e.textContent);
    expect(entries).toEqual([
      "L-BUDBudget Availability",
      "CTRContract Availability",
      "POPurchase Order",
      "NAVNaval Clearance",
      "Vessels",
      "Barges",
      "Lifting",
    ]);
    expect(within(section).getByTitle("Vessels: DSV, PSV, PC")).toBeInTheDocument();
    expect(section).not.toHaveTextContent("Platform Support Vessel");
  });

  it("the Project gates legend is unchanged — seven gates", () => {
    render(
      <FrozenCatalogProvider checks={[...BUILTIN_PROJECT_GATES, ...LOGISTICS_CHECKS]}>
        <ReadinessLensProvider lens="projects">
          <ChartLegend activityTypes={["Drilling"]} />
        </ReadinessLensProvider>
      </FrozenCatalogProvider>,
    );
    const section = screen.getByText("Readiness").parentElement!;
    expect(within(section).getAllByTitle(/.+/)).toHaveLength(BUILTIN_PROJECT_GATES.length);
  });
});
