import { useMemo, useState } from "react";
import ReactECharts from "echarts-for-react/lib/core";
import type { EChartsOption, BarSeriesOption, LineSeriesOption } from "echarts";

import { useThemeStore } from "@/store/theme";
import { echarts } from "@/lib/echarts";
import { composeSpuds, type CapacityData, type CapacityLocation } from "@/lib/campaign-capacity";

// Locations stack dark → light (Land at the base), matching the Excel one-sheet.
const LOCATION_COLORS: Record<"LAND" | "SWAMP" | "OFFSHORE", string> = {
  LAND: "#475569",
  SWAMP: "#94a3b8",
  OFFSHORE: "#cbd5e1",
};
const OIL_COLOR = "#dc2626";
const DOMESTIC_GAS_COLOR = "#16a34a";
const EXPORT_GAS_COLOR = "#06b6d4";
const UNASSIGNED_GAS_COLOR = "#94a3b8";
const EXPLORATION_COLOR = "#8b5cf6";

interface TipParam {
  seriesName?: string;
  marker?: string;
  value?: number;
  axisValue?: string;
}

/** Axis tooltip rows, skipping the invisible stack-total helper series. */
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
 * One campaign's combo chart: stacked rigs-by-location bars (left axis) plus oil
 * and gas well-spud lines (right axis), by year. Reused per campaign so two can be
 * stacked for comparison.
 */
const LOC_META: { key: CapacityLocation; name: string; labelColor: string }[] = [
  { key: "LAND", name: "Land", labelColor: "#ffffff" },
  { key: "SWAMP", name: "Swamp", labelColor: "#ffffff" },
  { key: "OFFSHORE", name: "Offshore", labelColor: "#334155" },
];

export function CapacityChart({ title, data }: { title: string; data: CapacityData }) {
  const dark = useThemeStore((s) => s.resolved) === "dark";
  const axisLabel = dark ? "#94a3b8" : "#64748b";
  const axisLine = dark ? "rgba(255,255,255,0.12)" : "#e2e8f0";
  const splitLine = dark ? "rgba(255,255,255,0.06)" : "#f1f5f9";
  const totalLabel = dark ? "#e2e8f0" : "#0f172a";

  // The legend is a genuine FILTER here, not a cosmetic hide: deselecting a
  // terrain re-counts the spud lines and the bar-total labels for the
  // remaining terrains, so we own the selection state and rebuild the option.
  // (Absent key = selected, matching echarts' own semantics.)
  const [legendSelected, setLegendSelected] = useState<Record<string, boolean>>({});
  // Stable identity — echarts-for-react disposes/recreates the chart when
  // onEvents changes, killing listeners (see FleetTab).
  const onEvents = useMemo(
    () => ({
      legendselectchanged: (e: { selected: Record<string, boolean> }) =>
        setLegendSelected({ ...e.selected }),
    }),
    [],
  );

  const option = useMemo<EChartsOption>(() => {
    const locMeta = LOC_META;
    const selectedLocs = locMeta
      .filter((m) => legendSelected[m.name] !== false)
      .map((m) => m.key);
    // Spud lines + bar totals re-count over the SELECTED terrains only
    // (unlocated wells always count — they belong to no terrain).
    const spuds = composeSpuds(data, selectedLocs);
    const totals = data.years.map((_, i) =>
      selectedLocs.reduce((acc, k) => acc + data.rigsByLocation[k][i], 0),
    );

    const barSeries: BarSeriesOption[] = locMeta.map((m) => ({
      name: m.name,
      type: "bar",
      stack: "rigs",
      yAxisIndex: 0,
      barWidth: "52%",
      itemStyle: { color: LOCATION_COLORS[m.key] },
      label: { show: true, position: "inside", color: m.labelColor, fontSize: 11, fontWeight: 600 },
      // Hide the label on empty segments.
      data: data.rigsByLocation[m.key].map((v) => ({ value: v, label: { show: v > 0 } })),
    }));

    // Invisible 0-height bar on top of the stack → carries the stack-total label.
    const totalSeries: BarSeriesOption = {
      name: "total",
      type: "bar",
      stack: "rigs",
      yAxisIndex: 0,
      silent: true,
      itemStyle: { color: "transparent", borderColor: "transparent" },
      label: { show: true, position: "top", color: totalLabel, fontWeight: "bold", fontSize: 12 },
      data: totals.map((t) => ({ value: 0, label: { show: t > 0, formatter: String(t) } })),
    };

    // Gas is split by the project's Market. The no-market line only appears
    // while unassigned gas spuds exist — a nudge to assign, not a fixture.
    const lineDefs = [
      { name: "Well spuds — Oil", color: OIL_COLOR, values: spuds.oilSpuds, exists: true, dashed: false },
      {
        name: "Well spuds — Exploration",
        color: EXPLORATION_COLOR,
        values: spuds.explorationSpuds,
        // Conditional lines key their EXISTENCE on the all-terrain totals so a
        // terrain toggle narrows their values without dropping them from the
        // legend mid-interaction.
        exists: data.explorationSpuds.some((v) => v > 0),
        dashed: false,
      },
      {
        name: "Well spuds — Domestic Gas",
        color: DOMESTIC_GAS_COLOR,
        values: spuds.domesticGasSpuds,
        exists: true,
        dashed: false,
      },
      {
        name: "Well spuds — Export Gas",
        color: EXPORT_GAS_COLOR,
        values: spuds.exportGasSpuds,
        exists: true,
        dashed: false,
      },
      {
        name: "Well spuds — Gas (no market)",
        color: UNASSIGNED_GAS_COLOR,
        values: spuds.unassignedGasSpuds,
        exists: data.unassignedGasSpuds.some((v) => v > 0),
        dashed: true,
      },
    ].filter((s) => s.exists);

    const lineSeries: LineSeriesOption[] = lineDefs.map((s) => ({
      name: s.name,
      type: "line",
      yAxisIndex: 1,
      symbol: "circle",
      symbolSize: 6,
      lineStyle: { width: 2.5, color: s.color, type: s.dashed ? "dashed" : "solid" },
      itemStyle: { color: s.color },
      data: s.values,
    }));

    return {
      grid: { left: 4, right: 4, top: 52, bottom: 4, containLabel: true },
      legend: {
        top: 0,
        left: 0,
        itemWidth: 14,
        itemHeight: 10,
        textStyle: { color: axisLabel, fontSize: 12 },
        // Omit the "total" helper series from the legend.
        data: ["Land", "Swamp", "Offshore", ...lineDefs.map((s) => s.name)],
        selected: legendSelected,
      },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, formatter: tooltipRows },
      xAxis: {
        type: "category",
        data: data.years.map(String),
        axisLabel: { color: axisLabel },
        axisLine: { lineStyle: { color: axisLine } },
        axisTick: { show: false },
      },
      yAxis: [
        {
          type: "value",
          name: "Rigs",
          minInterval: 1,
          nameTextStyle: { color: axisLabel },
          axisLabel: { color: axisLabel },
          splitLine: { lineStyle: { color: splitLine } },
        },
        {
          type: "value",
          name: "Well spuds",
          minInterval: 1,
          nameTextStyle: { color: axisLabel },
          axisLabel: { color: axisLabel },
          splitLine: { show: false },
        },
      ],
      series: [...barSeries, totalSeries, ...lineSeries],
    };
  }, [data, legendSelected, axisLabel, axisLine, splitLine, totalLabel]);

  return (
    <div className="rounded-lg border border-border/70 bg-card p-3 shadow-soft-sm">
      <h4 className="mb-1.5 text-sm font-semibold text-foreground">
        # of rigs &amp; well spuds — {title}
      </h4>
      {data.years.length === 0 ? (
        <p className="px-2 py-10 text-center text-sm text-muted-foreground">
          No dated activities to chart.
        </p>
      ) : (
        <ReactECharts
          echarts={echarts}
          option={option}
          onEvents={onEvents}
          style={{ height: "clamp(320px, 30vh, 440px)" }}
          notMerge
          lazyUpdate
          opts={{ renderer: "canvas" }}
        />
      )}
    </div>
  );
}
