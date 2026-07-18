import { useEffect, useMemo, useState } from "react";
import ReactECharts from "echarts-for-react/lib/core";
import type { EChartsOption, BarSeriesOption } from "echarts";
import { Loader2 } from "lucide-react";

import { listActivities, type Activity } from "@/api/activities";
import { listResources, type ResourceRecord } from "@/api/resources";
import { useThemeStore } from "@/store/theme";
import { echarts } from "@/lib/echarts";
import { computeFleetDemand } from "@/lib/fleet-demand";
import { cn } from "@/lib/utils";

// Awarded matches the registry's neutral slate; planned slots carry the same
// amber the registry badge uses, so the two views read as one vocabulary.
const AWARDED_COLOR = "#475569";
const PLANNED_COLOR = "#f59e0b";

// Legend stays terse; the tooltip has room for the full meaning.
const TIP_LABELS: Record<string, string> = {
  "In use": "In use — awarded",
  Planned: "Planned slot (award needed)",
};

const TERRAIN_FILTERS = [
  { value: "ALL", label: "All" },
  { value: "LAND", label: "Land" },
  { value: "SWAMP", label: "Swamp" },
  { value: "OFFSHORE", label: "Offshore" },
] as const;
type TerrainFilter = (typeof TERRAIN_FILTERS)[number]["value"];

// Same vocabulary as the Overview horizon filters; 0 = no limit.
const HORIZONS = [
  { value: 3, label: "Next 3 years" },
  { value: 5, label: "Next 5 years" },
  { value: 10, label: "Next 10 years" },
  { value: 0, label: "All duration" },
] as const;
const HORIZON_KEY = "ds.fleet-demand-horizon";

function loadHorizon(): number {
  try {
    const raw = window.localStorage.getItem(HORIZON_KEY);
    if (raw === null) return 0;
    const v = Number(raw);
    return HORIZONS.some((h) => h.value === v) ? v : 0;
  } catch {
    return 0;
  }
}

interface TipParam {
  seriesName?: string;
  marker?: string;
  value?: number;
  axisValue?: string;
}

function tooltipRows(params: unknown): string {
  const arr = (Array.isArray(params) ? params : [params]) as TipParam[];
  const year = arr[0]?.axisValue ?? "";
  const body = arr
    .filter((p) => p.seriesName && p.seriesName !== "total")
    .map((p) => `${p.marker ?? ""} ${TIP_LABELS[p.seriesName!] ?? p.seriesName}: <b>${p.value ?? 0}</b>`)
    .join("<br/>");
  return `<div style="font-weight:600;margin-bottom:2px">${year}</div>${body}`;
}

/**
 * Per-year fleet demand on the Fleet tab: distinct units with scheduled work
 * each year, stacked awarded vs planned-slot — the "how many awards do we still
 * need, and by when" view. Toggles rigs/HWUs, scopes by terrain (rigs only) and
 * by a persisted duration horizon.
 */
export function FleetDemandChart({
  projectId,
  refreshToken = 0,
}: {
  projectId: string;
  /** Bump to re-fetch (the registry notifies after unit add/edit). */
  refreshToken?: number;
}) {
  const dark = useThemeStore((s) => s.resolved) === "dark";
  const axisLabel = dark ? "#94a3b8" : "#64748b";
  const axisLine = dark ? "rgba(255,255,255,0.12)" : "#e2e8f0";
  const splitLine = dark ? "rgba(255,255,255,0.06)" : "#f1f5f9";
  const totalLabel = dark ? "#e2e8f0" : "#0f172a";

  const [kind, setKind] = useState<"rig" | "hwu">("rig");
  const [terrain, setTerrain] = useState<TerrainFilter>("ALL");
  const [horizon, setHorizon] = useState<number>(loadHorizon);
  const [activities, setActivities] = useState<Activity[] | null>(null);
  const [registry, setRegistry] = useState<ResourceRecord[]>([]);
  const [error, setError] = useState<string | null>(null);

  function updateHorizon(next: number) {
    setHorizon(next);
    try {
      window.localStorage.setItem(HORIZON_KEY, String(next));
    } catch {
      // storage unavailable — the in-session choice still applies
    }
  }

  useEffect(() => {
    let stale = false;
    (async () => {
      setError(null);
      try {
        const [acts, res] = await Promise.all([
          listActivities(projectId),
          listResources(projectId).catch(() => [] as ResourceRecord[]),
        ]);
        if (stale) return;
        setActivities(acts);
        setRegistry(res);
      } catch (err: unknown) {
        if (!stale) setError(err instanceof Error ? err.message : "Failed to load fleet demand");
      }
    })();
    return () => {
      stale = true;
    };
  }, [projectId, refreshToken]);

  const demand = useMemo(
    () =>
      computeFleetDemand(kind, activities ?? [], registry, {
        terrain: kind === "rig" && terrain !== "ALL" ? terrain : undefined,
      }),
    [kind, terrain, activities, registry],
  );

  // Horizon slices the computed years down to [this year, this year + N).
  // The unscheduled list is timeless, so it is not horizon-scoped.
  const view = useMemo(() => {
    if (horizon === 0) return demand;
    const nowYear = new Date().getFullYear();
    const keep = demand.years
      .map((y, i) => ({ y, i }))
      .filter(({ y }) => y >= nowYear && y < nowYear + horizon);
    return {
      ...demand,
      years: keep.map(({ y }) => y),
      awarded: keep.map(({ i }) => demand.awarded[i]),
      planned: keep.map(({ i }) => demand.planned[i]),
    };
  }, [demand, horizon]);

  const option = useMemo<EChartsOption>(() => {
    const totals = view.years.map((_, i) => view.awarded[i] + view.planned[i]);

    const bars: BarSeriesOption[] = [
      {
        name: "In use",
        type: "bar",
        stack: "fleet",
        barWidth: "52%",
        // Sparse selections (one terrain, short horizon) otherwise yield
        // comically wide bars.
        barMaxWidth: 64,
        itemStyle: { color: AWARDED_COLOR },
        label: { show: true, position: "inside", color: "#ffffff", fontSize: 11, fontWeight: 600 },
        data: view.awarded.map((v) => ({ value: v, label: { show: v > 0 } })),
      },
      {
        name: "Planned",
        type: "bar",
        stack: "fleet",
        itemStyle: { color: PLANNED_COLOR },
        label: { show: true, position: "inside", color: "#78350f", fontSize: 11, fontWeight: 600 },
        data: view.planned.map((v) => ({ value: v, label: { show: v > 0 } })),
      },
      {
        // Invisible 0-height bar on top of the stack → carries the total label.
        name: "total",
        type: "bar",
        stack: "fleet",
        silent: true,
        itemStyle: { color: "transparent", borderColor: "transparent" },
        label: { show: true, position: "top", color: totalLabel, fontWeight: "bold", fontSize: 12 },
        data: totals.map((t) => ({ value: 0, label: { show: t > 0, formatter: String(t) } })),
      },
    ];

    return {
      // Synchronous first paint: the bars are the information here, and growth
      // animation only delays them (and stalls entirely under rAF throttling).
      animation: false,
      grid: { left: 4, right: 4, top: 34, bottom: 4, containLabel: true },
      legend: {
        top: 0,
        left: 0,
        itemWidth: 14,
        itemHeight: 10,
        textStyle: { color: axisLabel, fontSize: 12 },
        data: ["In use", "Planned"],
      },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, formatter: tooltipRows },
      xAxis: {
        type: "category",
        data: view.years.map(String),
        axisLabel: { color: axisLabel },
        axisLine: { lineStyle: { color: axisLine } },
        axisTick: { show: false },
      },
      // No axis title — the Rigs/HWUs toggle already names the unit, and a
      // title here collides with the legend.
      yAxis: {
        type: "value",
        minInterval: 1,
        axisLabel: { color: axisLabel },
        splitLine: { lineStyle: { color: splitLine } },
      },
      series: bars,
    };
  }, [view, axisLabel, axisLine, splitLine, totalLabel]);

  const unitWord = kind === "rig" ? "rig" : "HWU";
  const scopedOut = view.years.length === 0 && demand.years.length > 0;

  return (
    <div
      className="rounded-lg border border-border/70 bg-card p-3 shadow-soft-sm"
      data-testid="fleet-demand-chart"
    >
      <div className="mb-1.5 flex flex-wrap items-start justify-between gap-2">
        <h4 className="text-sm font-semibold text-foreground">Fleet demand by year</h4>
        <div className="flex flex-wrap items-center gap-2">
          <div
            className={cn(
              "inline-flex rounded-md border border-border/70 p-0.5",
              kind === "hwu" && "pointer-events-none opacity-40",
            )}
            role="group"
            aria-label="Terrain filter"
            title={kind === "hwu" ? "HWUs are mobile — no terrain" : undefined}
          >
            {TERRAIN_FILTERS.map((t) => (
              <button
                key={t.value}
                type="button"
                aria-pressed={terrain === t.value}
                data-testid={`fleet-demand-terrain-${t.value.toLowerCase()}`}
                onClick={() => setTerrain(t.value)}
                disabled={kind === "hwu"}
                className={cn(
                  "rounded px-2 py-1 text-xs font-medium transition-colors",
                  terrain === t.value
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
          <select
            aria-label="Demand horizon"
            value={String(horizon)}
            onChange={(e) => updateHorizon(Number(e.target.value))}
            className="rounded-md border border-border bg-background px-1.5 py-1 text-xs text-foreground"
          >
            {HORIZONS.map((h) => (
              <option key={h.value} value={String(h.value)}>
                {h.label}
              </option>
            ))}
          </select>
          <div className="inline-flex rounded-md border border-border/70 p-0.5" role="tablist">
            {(["rig", "hwu"] as const).map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={kind === k}
                data-testid={`fleet-demand-${k}`}
                onClick={() => {
                  setKind(k);
                  if (k === "hwu") setTerrain("ALL");
                }}
                className={cn(
                  "rounded px-2.5 py-1 text-xs font-medium transition-colors",
                  kind === k
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {k === "rig" ? "Rigs" : "HWUs"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error ? (
        <p className="px-2 py-8 text-center text-sm text-destructive">{error}</p>
      ) : activities === null ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : view.years.length === 0 ? (
        <p className="px-2 py-8 text-center text-sm text-muted-foreground">
          {scopedOut
            ? `No ${unitWord} activity within the selected filters.`
            : `No dated ${unitWord} activities to chart.`}
        </p>
      ) : (
        <ReactECharts
          echarts={echarts}
          option={option}
          style={{ height: 260 }}
          notMerge
          lazyUpdate
          opts={{ renderer: "canvas" }}
        />
      )}

      {demand.unscheduled.length > 0 && (
        <p className="mt-1.5 border-t border-border/60 pt-1.5 text-xs text-muted-foreground">
          Registered, not yet scheduled: {demand.unscheduled.join(", ")}
        </p>
      )}
    </div>
  );
}
