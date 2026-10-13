import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { CircleDot } from "lucide-react";

vi.mock("@/lib/auth", () => ({
  getAccessToken: async () => "test-token",
  msalInstance: { getAllAccounts: () => [], logoutRedirect: vi.fn() },
  loginRequest: {},
}));

import type { CatalogCheck } from "@/api/readiness";
import { ChartLegend } from "@/components/chart/ChartLegend";
import {
  BUILTIN_PROJECT_GATES,
  FrozenCatalogProvider,
  ReadinessCatalogProvider,
} from "@/components/readiness/catalog";
import { CHECK_ICONS, ICON_KEYS, checkIcon } from "@/components/readiness/icon-registry";
import { LUCIDE_PATHS, buildCheckSvg } from "@/lib/check-icon-svg";
import { worstCheck } from "@/lib/chart-layout";
import { server } from "./mocks/server";

const relabel = (checks: readonly CatalogCheck[], code: string, label: string) =>
  checks.map((c) => (c.code === code ? { ...c, label } : c));

describe("icon registry", () => {
  it("has a React icon and canvas paths for every icon key, and nothing else", () => {
    expect(Object.keys(CHECK_ICONS).sort()).toEqual([...ICON_KEYS].sort());
    expect(Object.keys(LUCIDE_PATHS).sort()).toEqual([...ICON_KEYS].sort());
  });

  it("covers every built-in gate's icon", () => {
    for (const g of BUILTIN_PROJECT_GATES) {
      expect(ICON_KEYS).toContain(g.icon_key);
    }
  });

  it("falls back to a neutral dot for an unknown key instead of crashing", () => {
    expect(checkIcon("not-a-key")).toBe(CircleDot);
    expect(buildCheckSvg("not-a-key", "Behind")).toContain('r="10"');
  });
});

describe("catalog providers", () => {
  it("renders the built-in gates outside any provider (tests, fixtures)", () => {
    render(<ChartLegend activityTypes={[]} />);
    for (const g of BUILTIN_PROJECT_GATES) {
      expect(screen.getByText(g.label)).toBeInTheDocument();
    }
  });

  it("loads the live catalog — a renamed or retired check shows up without a code change", async () => {
    server.use(
      http.get("/api/readiness/catalog", () =>
        HttpResponse.json({
          teams: [],
          checks: relabel(BUILTIN_PROJECT_GATES, "FID", "Final Investment Decision").filter(
            (c) => c.code !== "LOC",
          ),
          status_sets: {},
        }),
      ),
    );
    render(
      <ReadinessCatalogProvider>
        <ChartLegend activityTypes={[]} />
      </ReadinessCatalogProvider>,
    );
    expect(await screen.findByText("Final Investment Decision")).toBeInTheDocument();
    expect(screen.queryByText("Location")).not.toBeInTheDocument();
  });

  it("keeps the built-in gates when the catalog can't load", async () => {
    server.use(
      http.get("/api/readiness/catalog", () =>
        HttpResponse.json({ detail: "Internal server error" }, { status: 500 }),
      ),
    );
    render(
      <ReadinessCatalogProvider>
        <ChartLegend activityTypes={[]} />
      </ReadinessCatalogProvider>,
    );
    // Give the failed fetch a tick to settle; the gates must still be there.
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByText("Final Inv. Decision")).toBeInTheDocument();
  });

  it("a revision pins its frozen catalog over the live one", async () => {
    server.use(
      http.get("/api/readiness/catalog", () =>
        HttpResponse.json({
          teams: [],
          checks: relabel(BUILTIN_PROJECT_GATES, "LOC", "Live Label"),
          status_sets: {},
        }),
      ),
    );
    render(
      <ReadinessCatalogProvider>
        <FrozenCatalogProvider checks={relabel(BUILTIN_PROJECT_GATES, "LOC", "Label At Submit")}>
          <ChartLegend activityTypes={[]} />
        </FrozenCatalogProvider>
      </ReadinessCatalogProvider>,
    );
    expect(await screen.findByText("Label At Submit")).toBeInTheDocument();
    expect(screen.queryByText("Live Label")).not.toBeInTheDocument();
  });

  it("a pre-catalog revision (no frozen catalog) renders the built-in gates", () => {
    render(
      <FrozenCatalogProvider checks={undefined}>
        <ChartLegend activityTypes={[]} />
      </FrozenCatalogProvider>,
    );
    expect(screen.getByText("Field Development Plan")).toBeInTheDocument();
  });
});

describe("worstCheck order", () => {
  it("breaks ties by the catalog order it is given", () => {
    const checks = { FDP: { status: "Behind" as const }, BUD: { status: "Behind" as const } };
    expect(worstCheck(checks, ["BUD", "FDP"])?.code).toBe("BUD");
    expect(worstCheck(checks, ["FDP", "BUD"])?.code).toBe("FDP");
  });

  it("ignores codes outside the given order (e.g. a retired check's stale value)", () => {
    const checks = { FDP: { status: "Completed" as const }, OLD: { status: "Behind" as const } };
    expect(worstCheck(checks, ["FDP"])).toEqual({ code: "FDP", status: "Completed" });
  });
});
