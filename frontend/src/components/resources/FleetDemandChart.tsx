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
    .map((p) => `${p.marker ?? ""} ${p.seriesName}: <b>${p.value ?? 0}</b>`)
    .join("<br/>");
  return `<div style="font-weight:600;margin-bottom:2px">${year}</div>${body}`;
}

/**
 * Per-year fleet demand on the Fleet tab: distinct units with scheduled work
 * each year, stacked awarded vs planned-slot — the "how many awards do we still
 * need, and by when" view. Toggles between rigs and HWUs.
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
  const [activities, setActivities] = useState<Activity[] | null>(null);
  const [registry, setRegistry] = useState<ResourceRecord[]>([]);
  const [error, setError] = useState<string | null>(null);

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
    () => computeFleetDemand(kind, activities ?? [], registry),
    [kind, activities, registry],
  );

  const option = useMemo<EChartsOption>(() => {
    const totals = demand.years.map((_, i) => demand.awarded[i] + demand.planned[i]);
    const unitName = kind === "rig" ? "Rigs" : "HWUs";

    const bars: BarSeriesOption[] = [
      {
        name: "In use — awarded",
        type: "bar",
        stack: "fleet",
        barWidth: "52%",
        itemStyle: { color: AWARDED_COLOR },
        label: { show: true, position: "inside", color: "#ffffff", fontSize: 11, fontWeight: 600 },
        data: demand.awarded.map((v) => ({ value: v, label: { show: v > 0 } })),
      },
      {
        name: "Planned slot (award needed)",
        type: "bar",
        stack: "fleet",
        itemStyle: { color: PLANNED_COLOR },
        label: { show: true, position: "inside", color: "#78350f", fontSize: 11, fontWeight: 600 },
        data: demand.planned.map((v) => ({ value: v, label: { show: v > 0 } })),
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
      grid: { left: 4, right: 4, top: 40, bottom: 4, containLabel: true },
      legend: {
        top: 0,
        left: 0,
        itemWidth: 14,
        itemHeight: 10,
        textStyle: { color: axisLabel, fontSize: 12 },
        data: ["In use — awarded", "Planned slot (award needed)"],
      },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, formatter: tooltipRows },
      xAxis: {
        type: "category",
        data: demand.years.map(String),
        axisLabel: { color: axisLabel },
        axisLine: { lineStyle: { color: axisLine } },
        axisTick: { show: false },
      },
      yAxis: {
        type: "value",
        name: unitName,
        minInterval: 1,
        nameTextStyle: { color: axisLabel },
        axisLabel: { color: axisLabel },
        splitLine: { lineStyle: { color: splitLine } },
      },
      series: bars,
    };
  }, [demand, kind, axisLabel, axisLine, splitLine, totalLabel]);

  return (
    <div
      className="rounded-lg border border-border/70 bg-card p-3 shadow-soft-sm"
      data-testid="fleet-demand-chart"
    >
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-semibold text-foreground">Fleet demand by year</h4>
          <p className="text-xs text-muted-foreground">
            Distinct {kind === "rig" ? "rigs" : "HWUs"} with scheduled work each year — amber slots
            still need an awarded unit.
          </p>
        </div>
        <div className="inline-flex rounded-md border border-border/70 p-0.5" role="tablist">
          {(["rig", "hwu"] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={kind === k}
              data-testid={`fleet-demand-${k}`}
              onClick={() => setKind(k)}
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

      {error ? (
        <p className="px-2 py-8 text-center text-sm text-destructive">{error}</p>
      ) : activities === null ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : demand.years.length === 0 ? (
        <p className="px-2 py-8 text-center text-sm text-muted-foreground">
          No dated {kind === "rig" ? "rig" : "HWU"} activities to chart.
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
