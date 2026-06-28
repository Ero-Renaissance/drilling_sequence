import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactECharts from "echarts-for-react";
import { ChevronDown } from "lucide-react";
import type {
  EChartsOption,
  CustomSeriesRenderItemParams,
  CustomSeriesRenderItemAPI,
  CustomSeriesRenderItemReturn,
} from "echarts";
import type { Activity } from "@/api/activities";
import type { RigContract } from "@/api/contracts";
import type { HwuContract } from "@/api/hwu-contracts";
import { CHECK_CODES, type CheckCode, type CheckStatus } from "@/api/readiness";
import { activitiesToChartData, type ReadinessMap } from "@/lib/chart-utils";
import { worstCheck, iconTier, tagFits } from "@/lib/chart-layout";
import { terrainRank } from "@/lib/gantt-rows";
import {
  buildAlarmClockSvgDataUri,
  buildCheckSvgDataUri,
  buildDropletSvgDataUri,
} from "@/lib/check-icon-svg";
import { STATUS_LABEL } from "@/components/readiness/check-meta";
import {
  classifyContract,
  daysUntilExpiry,
  URGENCY_VISUAL,
} from "@/lib/contract-urgency";
import { useThemeStore } from "@/store/theme";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { ChartLegend } from "./ChartLegend";

/**
 * All 8 per-activity gates including CON.
 *
 * The Y-axis AlarmClock answers a RIG-level question — "how soon does this
 * rig's contract expire?" — and only fires for in-force (Completed) contracts.
 * The strip answers a per-ACTIVITY question — "does the contract cover THIS
 * specific activity?" — which varies per row even on the same rig once the
 * contract is Completed (Completed vs Behind depending on activity dates).
 * Both signals are useful, so we render CON in both places.
 */
const BAR_STRIP_CODES = CHECK_CODES;

interface DrillChartProps {
  activities: Activity[];
  readinessMap?: ReadinessMap;
  /** Map of rig_name → contract. Drives the per-row contract-expiry marker. */
  contractsByRig?: Map<string, RigContract>;
  /** Map of hwu_name → contract — the HWU parallel to contractsByRig. */
  contractsByHwu?: Map<string, HwuContract>;
  conflictIds?: Set<string>;
  onActivityClick?: (activityId: string) => void;
  /** Show the multi-select project + location filters (each dims the bars it
   *  doesn't match). Off in the read-only revision snapshot view; on for the
   *  live project chart. */
  enableFilters?: boolean;
  /** Initial filter selections — lets a caller (e.g. the presentation view) open
   *  the chart already filtered. */
  initialProjects?: string[];
  initialLocations?: string[];
  /** Fires when the project/location filters change, so a parent can carry the
   *  current selection (e.g. into the presentation link). */
  onFiltersChange?: (filters: { projects: string[]; locations: string[] }) => void;
  /** Where the legend sits relative to the chart. "right" is for the wide
   *  presentation view (aligned with the chart, below the filters); "bottom"
   *  (default) everywhere else. */
  legendPosition?: "bottom" | "right";
}

/** Pill styling for the focus-year strip — solid when active, outline otherwise. */
function yearChipClass(active: boolean): string {
  return [
    "rounded-md px-2 py-0.5 text-xs font-medium transition-colors",
    active
      ? "bg-primary text-primary-foreground shadow-soft-sm"
      : "border border-border/70 text-muted-foreground hover:bg-muted hover:text-foreground",
  ].join(" ");
}

// ── Theme palettes ───────────────────────────────────────────────────────────

interface ChartTheme {
  bg: string;
  axisLabel: string;
  axisLine: string;
  splitLine: string;
  yLabel: string;
  yStripe: [string, string];
  xBand: string;
  tooltipBg: string;
  tooltipBorder: string;
  tooltipText: string;
  tooltipMuted: string;
  tooltipDivider: string;
  todayLine: string;
  todayLabel: string;
  barLabel: string;
  completedFill: string;
  /** Bold, high-contrast colour for the per-bar project tag (and its soft chip). */
  projectLabel: string;
  projectChip: string;
}

const LIGHT_THEME: ChartTheme = {
  bg: "transparent",
  axisLabel: "#64748b",
  axisLine: "#e2e8f0",
  splitLine: "#f1f5f9",
  yLabel: "#334155",
  yStripe: ["rgba(248,250,252,0.6)", "rgba(255,255,255,0)"],
  xBand: "rgba(15,23,42,0.04)",
  tooltipBg: "rgba(255,255,255,0.97)",
  tooltipBorder: "#e2e8f0",
  tooltipText: "#1e293b",
  tooltipMuted: "#64748b",
  tooltipDivider: "#e2e8f0",
  todayLine: "#ef4444",
  todayLabel: "#ef4444",
  barLabel: "#ffffff",
  completedFill: "#94a3b8",
  projectLabel: "#0f172a",
  projectChip: "rgba(15,23,42,0.08)",
};

const DARK_THEME: ChartTheme = {
  bg: "transparent",
  axisLabel: "#94a3b8",
  axisLine: "rgba(255,255,255,0.08)",
  splitLine: "rgba(255,255,255,0.04)",
  yLabel: "#cbd5e1",
  yStripe: ["rgba(255,255,255,0.03)", "rgba(255,255,255,0)"],
  xBand: "rgba(255,255,255,0.045)",
  tooltipBg: "rgba(30,30,36,0.97)",
  tooltipBorder: "rgba(255,255,255,0.1)",
  tooltipText: "#e2e8f0",
  tooltipMuted: "#94a3b8",
  tooltipDivider: "rgba(255,255,255,0.1)",
  todayLine: "#f87171",
  todayLabel: "#f87171",
  barLabel: "#ffffff",
  completedFill: "#64748b",
  projectLabel: "#f1f5f9",
  projectChip: "rgba(255,255,255,0.14)",
};

type BandArea = [{ xAxis: number; itemStyle: { color: string } }, { xAxis: number }];

/**
 * Alternating shaded bands for the time axis, as ECharts `markArea` pairs — only
 * the shaded (alternate) intervals are emitted. No labels: unlike the static
 * print, the interactive chart's bottom time axis already names the dates, so an
 * extra centred label row just competes with it. Shading keys off calendar parity
 * (not loop index) so the stripe pattern stays put while panning. Granularity
 * ("month"/"year") is chosen by the caller from the visible span.
 */
function buildTimeBands(from: number, to: number, unit: "month" | "year", color: string): BandArea[] {
  const areas: BandArea[] = [];
  const d0 = new Date(from);
  let cur =
    unit === "month" ? new Date(d0.getFullYear(), d0.getMonth(), 1) : new Date(d0.getFullYear(), 0, 1);
  while (cur.getTime() < to) {
    const next =
      unit === "month"
        ? new Date(cur.getFullYear(), cur.getMonth() + 1, 1)
        : new Date(cur.getFullYear() + 1, 0, 1);
    const parity = unit === "month" ? cur.getMonth() : cur.getFullYear();
    if (parity % 2 === 1) {
      areas.push([{ xAxis: cur.getTime(), itemStyle: { color } }, { xAxis: next.getTime() }]);
    }
    cur = next;
  }
  return areas;
}

/** Silent markArea — bands only; the axis labels the dates. */
function bandMarkArea(areas: BandArea[]) {
  return { silent: true, data: areas };
}

/**
 * Multi-select picker (projects, locations, …). An empty selection means "no
 * filter" — every bar shows at full strength; once one or more values are
 * picked, the chart dims the rest (handled in renderItem). Toggling keeps the
 * menu open so several can be (de)selected in one pass.
 */
function MultiSelectFilter({
  items,
  selected,
  onChange,
  allLabel,
  filterLabel,
}: {
  items: string[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  /** Trigger text when nothing is picked, e.g. "All projects". */
  allLabel: string;
  /** Menu heading, e.g. "Filter by project". */
  filterLabel: string;
}) {
  const toggle = (p: string) => {
    const next = new Set(selected);
    if (next.has(p)) next.delete(p);
    else next.add(p);
    onChange(next);
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md border border-border/70 px-2 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {selected.size === 0 ? allLabel : `${selected.size} selected`}
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 w-60 overflow-y-auto">
        <div className="flex items-center justify-between px-2 py-1.5 text-xs">
          <span className="font-medium text-muted-foreground">{filterLabel}</span>
          {selected.size > 0 && (
            <button
              type="button"
              onClick={() => onChange(new Set())}
              className="font-medium text-primary hover:underline"
            >
              Clear
            </button>
          )}
        </div>
        <DropdownMenuSeparator />
        {items.map((p) => (
          <DropdownMenuCheckboxItem
            key={p}
            checked={selected.has(p)}
            onCheckedChange={() => toggle(p)}
            onSelect={(e) => e.preventDefault()}
            className="text-xs"
          >
            {p}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── Component ────────────────────────────────────────────────────────────────

export function DrillChart({
  activities,
  readinessMap,
  contractsByRig,
  contractsByHwu,
  conflictIds,
  onActivityClick,
  enableFilters = false,
  initialProjects,
  initialLocations,
  onFiltersChange,
  legendPosition = "bottom",
}: DrillChartProps) {
  const resolved = useThemeStore((s) => s.resolved);
  const theme = resolved === "dark" ? DARK_THEME : LIGHT_THEME;

  const [activeYear, setActiveYear] = useState<number | null>(null);
  // Selected projects to single out — empty Set means "no filter" (all vivid).
  const [selectedProjects, setSelectedProjects] = useState<Set<string>>(() => new Set(initialProjects));
  // Selected locations (terrains) — empty Set means "no filter"; otherwise only
  // rows in these terrains are shown (the rest are removed, not dimmed).
  const [selectedLocations, setSelectedLocations] = useState<Set<string>>(() => new Set(initialLocations));

  // Surface filter changes so a parent can carry the selection (e.g. into the
  // presentation link). Fires on the initial selection too.
  useEffect(() => {
    onFiltersChange?.({ projects: [...selectedProjects], locations: [...selectedLocations] });
  }, [selectedProjects, selectedLocations, onFiltersChange]);

  // Distinct calendar years the campaign spans — drives the focus-year strip.
  const years = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    for (const a of activities) {
      const sy = Number(a.start_date.slice(0, 4));
      const ey = Number(a.end_date.slice(0, 4));
      if (Number.isFinite(sy) && sy < min) min = sy;
      if (Number.isFinite(ey) && ey > max) max = ey;
    }
    if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) return [];
    return Array.from({ length: max - min + 1 }, (_, i) => min + i);
  }, [activities]);

  // The location filter HARD-FILTERS (unlike the project filter, which only
  // dims): when one or more terrains are picked, every row in the others is
  // removed from the chart entirely — the Y-axis, height and legends reflect
  // just the selected locations. An empty selection shows everything.
  const visibleActivities = useMemo(
    () =>
      selectedLocations.size === 0
        ? activities
        : activities.filter((a) => a.location && selectedLocations.has(a.location)),
    [activities, selectedLocations],
  );

  // Distinct, sorted project names among the VISIBLE rows — drives the project
  // filter's checklist (so it never offers a project the location filter has
  // already removed, which would otherwise dim the whole chart).
  const projects = useMemo(() => {
    const s = new Set<string>();
    for (const a of visibleActivities) if (a.well_project) s.add(a.well_project);
    return Array.from(s).sort((x, y) => x.localeCompare(y));
  }, [visibleActivities]);

  // Distinct locations (terrains) in domain order (LAND → SWAMP → OFFSHORE),
  // any unknown value sorted last then alphabetically — drives the location
  // filter's checklist.
  const locations = useMemo(() => {
    const s = new Set<string>();
    for (const a of activities) if (a.location) s.add(a.location);
    return Array.from(s).sort(
      (x, y) => terrainRank(x) - terrainRank(y) || x.localeCompare(y),
    );
  }, [activities]);

  // Whether any VISIBLE activity carries flood risk — gates the legend's Risk
  // section (kept in step with the location filter).
  const hasFlood = useMemo(
    () => visibleActivities.some((a) => a.risk === "Flood Risk"),
    [visibleActivities],
  );

  // Drop any selected project that no longer exists once the data changes, so a
  // stale selection can't dim the whole chart (every bar failing to match).
  useEffect(() => {
    setSelectedProjects((prev) => {
      const next = new Set([...prev].filter((p) => projects.includes(p)));
      return next.size === prev.size ? prev : next;
    });
  }, [projects]);

  // Same guard for locations — a vanished terrain selection must not blank the
  // chart (it would otherwise filter every row away).
  useEffect(() => {
    setSelectedLocations((prev) => {
      const next = new Set([...prev].filter((l) => locations.includes(l)));
      return next.size === prev.size ? prev : next;
    });
  }, [locations]);

  // Focus the chart on one calendar year, or the full span (null). We drive this
  // through the option's dataZoom window (see below) rather than an imperative
  // dispatchAction: each change becomes a clean notMerge re-render, so no stale
  // custom-series elements (bars/labels) linger from the previous window.
  const focusYear = useCallback((year: number | null) => setActiveYear(year), []);

  const { categories, data, activityTypes, categoryToResource } = useMemo(
    () => activitiesToChartData(visibleActivities, readinessMap),
    [visibleActivities, readinessMap],
  );

  const completedIds = useMemo(
    () => new Set(activities.filter((a) => a.completed_at).map((a) => a.id)),
    [activities],
  );

  const displayData = useMemo(() => {
    return data.map((item) => {
      // ECharts renders a data item's own `label` config regardless of
      // series.label.show — per-item config wins. That built-in label is
      // centered on the bar and is NOT clip-aware, so when zoomed it spills
      // into the axis gutter. We draw bar labels ourselves (clip-aware) in
      // renderItem, so neutralise the per-item label here and stash its text
      // under a private field the renderItem reads (_barText: null when the
      // bar is too short to be worth labelling).
      const next = {
        ...item,
        label: { ...item.label, show: false },
        _barText: item.label?.show ? item.label?.formatter : null,
      };
      if (conflictIds?.has(item.activityId)) next.isConflict = true;
      if (completedIds.has(item.activityId)) next.isCompleted = true;
      return next;
    });
  }, [data, conflictIds, completedIds]);

  // Full data time-extent — drives the default bands and the zoom-adaptive refine.
  const [dataMin, dataMax] = useMemo<[number, number]>(() => {
    const t = displayData.flatMap((d) =>
      Array.isArray(d.value) ? [Number(d.value[1]), Number(d.value[2])] : [],
    );
    return t.length ? [Math.min(...t), Math.max(...t)] : [Date.now(), Date.now()];
  }, [displayData]);

  const option: EChartsOption = useMemo(() => {
    const ROW_HEIGHT = 56;
    const ICON_SIZE = 14;
    const ICON_GAP = 2;
    const BAR_TO_ICON_GAP = 4;
    const chartHeight = Math.max(500, categories.length * ROW_HEIGHT + 220);
    const today = Date.now();

    // Focus-year zoom window. null → full span. Local-time year bounds match how
    // bars are positioned (chart-utils builds timestamps from local midnight).
    const focusZoom =
      activeYear === null
        ? {}
        : {
            startValue: new Date(activeYear, 0, 1).getTime(),
            endValue: new Date(activeYear + 1, 0, 1).getTime(),
          };

    // Default bands for the current React render: year granularity across the full
    // span, month granularity when a year is focused. Free scroll/pinch zoom is
    // refined imperatively in updateBands() (notMerge would otherwise reset zoom).
    const bandAreas =
      activeYear === null
        ? buildTimeBands(dataMin, dataMax, "year", theme.xBand)
        : buildTimeBands(
            new Date(activeYear, 0, 1).getTime(),
            new Date(activeYear + 1, 0, 1).getTime(),
            "month",
            theme.xBand,
          );

    function renderItem(
      params: CustomSeriesRenderItemParams,
      api: CustomSeriesRenderItemAPI,
    ): CustomSeriesRenderItemReturn {
      const yIndex = api.value(0) as number;
      const start = api.coord([api.value(1), yIndex]);
      const end = api.coord([api.value(2), yIndex]);
      const rowH = (api.size!([0, 1]) as number[])[1];
      const barH = Math.min(26, Math.max(18, rowH * 0.42));

      const coordSys = params.coordSys as unknown as {
        x: number;
        y: number;
        width: number;
        height: number;
      };
      const clipShape = {
        x: coordSys.x,
        y: coordSys.y,
        width: coordSys.width,
        height: coordSys.height,
      };

      // Bar sits in the UPPER half of the row; icon strip sits BELOW the bar.
      const barTop = start[1] - barH / 2 - rowH * 0.12;
      const barRect = {
        x: start[0],
        y: barTop,
        width: Math.max(end[0] - start[0], 1),
        height: barH,
      };

      // Clip the bar to the plot area horizontally (the only zoomed axis) so a
      // bar that extends past the focused window doesn't spill over the Y-axis
      // labels or the right edge. We clamp the rect ourselves rather than rely on
      // echarts.graphic.clipRectByRect — that global isn't exposed by
      // echarts-for-react, so the call was a silent no-op (it only ever looked
      // fine because the un-zoomed axis auto-fits the data extent).
      const clipX1 = Math.max(barRect.x, clipShape.x);
      const clipX2 = Math.min(barRect.x + barRect.width, clipShape.x + clipShape.width);
      const clippedBar = {
        x: clipX1,
        y: barRect.y,
        width: Math.max(0, clipX2 - clipX1),
        height: barRect.height,
      };

      const baseStyle = api.style() as Record<string, unknown>;
      const item = displayData[params.dataIndex] as {
        isConflict?: boolean;
        isCompleted?: boolean;
        _barText?: string | null;
        tooltip?: { checks?: Record<string, { status: CheckStatus }> | null };
      };
      const isConflict = item?.isConflict ?? false;
      const isCompleted = item?.isCompleted ?? false;

      // Bar fill: solid family color straight from itemStyle. Each activity type
      // gets its own distinct hue in chart-colors.ts so bar + legend always match.
      // Completed activities read as "done": a neutral grey (not a dimmed
      // version of the activity-type hue, which looked like another oil shade).
      const fill = isCompleted ? theme.completedFill : baseStyle.fill;

      // A rig double-booking is physically impossible, so it must be unmissable.
      // We outline the bar in solid red rather than overlaying a hatch pattern —
      // a plain stroke renders reliably in every browser, whereas a canvas
      // createPattern fill is flaky inside an ECharts custom series and can drop
      // out (leaving an off-looking bar). Keep the activity-type fill so the bar
      // still reads as its type; the red border is the conflict signal.
      const conflictStroke = "#ef4444";

      // Project filter DIMS (the location filter, by contrast, removes rows
      // upstream): when a project selection is active, a bar whose project
      // isn't selected (or that has none) fades to background context — no
      // outline / label / icons / marker.
      const project = api.value(8) as string | null;
      const risk = api.value(7) as string | null;
      const dimmed =
        enableFilters &&
        selectedProjects.size > 0 &&
        (!project || !selectedProjects.has(project));

      const children: Array<Record<string, unknown>> = [
        {
          type: "rect",
          shape: clippedBar,
          style: {
            ...baseStyle,
            fill,
            opacity: dimmed ? 0.16 : 1,
            stroke: isConflict && !dimmed ? conflictStroke : undefined,
            lineWidth: isConflict && !dimmed ? 2 : 0,
            shadowBlur: isCompleted || dimmed ? 0 : 2,
            shadowColor: "rgba(0,0,0,0.15)",
            shadowOffsetY: 1,
          },
        },
      ];

      // A dimmed bar is pure context — skip every label, icon and marker.
      if (dimmed) {
        return { type: "group", children } as unknown as CustomSeriesRenderItemReturn;
      }

      // Flood-risk wells get a droplet at the bar's right edge (wide bars only);
      // reserve room so the well-name label doesn't run under it.
      const floodMark = risk === "Flood Risk" && clippedBar.width >= 24;

      // Draw the bar label here (rather than via the series-level label) so it
      // tracks the *clipped* rect: it centers in the visible portion and is
      // dropped entirely once a zoomed bar shrinks to a sliver — otherwise a
      // label anchored to an off-screen bar leaks a fragment into the gutter.
      const barText = item?._barText;
      if (barText && clippedBar.width >= 36) {
        children.push({
          type: "text",
          silent: true,
          style: {
            text: barText,
            // Anchor at the visible LEFT edge of the (clipped) bar and truncate
            // rightward. Centering would let the text overflow a thin left-edge
            // sliver and get head-clipped by the plot edge, leaving a fragment
            // like "…4-01" in the gutter. Left-align + truncate can't overflow.
            x: clippedBar.x + 6,
            y: clippedBar.y + clippedBar.height / 2,
            align: "left",
            verticalAlign: "middle",
            fill: theme.barLabel,
            fontSize: 11,
            fontWeight: 500,
            width: clippedBar.width - 12 - (floodMark ? 18 : 0),
            overflow: "truncate",
          },
        });
      }

      // The well's project, as a bold tag just above the bar — gated on bar width
      // (like the well-name label). It hugs the text as a soft chip when it fits,
      // and falls back to a bar-width truncating band for a long project name.
      if (project && clippedBar.width >= 36) {
        children.push({
          type: "text",
          silent: true,
          style: {
            text: project,
            x: clippedBar.x + 3,
            y: clippedBar.y - 1,
            align: "left",
            verticalAlign: "bottom",
            fill: theme.projectLabel,
            fontSize: 10,
            fontWeight: 600,
            backgroundColor: theme.projectChip,
            padding: [1, 4],
            borderRadius: 3,
            ...(tagFits(String(project), clippedBar.width)
              ? {}
              : { width: clippedBar.width - 4, overflow: "truncate" }),
          },
        });
      }

      // Readiness icon strip below the bar — 4 adaptive tiers by bar width.
      // Thresholds tuned for the 8-icon set (7 readiness gates + CON).
      //   ≥ 135px → 8 full-size icons (14px) in a single row
      //   90–135  → 8 half-size icons (10px) in a single row
      //   45–90   → 4×2 mini grid (9px icons, 4 + 4 across two rows)
      //   <  45   → single worst-status icon (12px) — identifies the failing check
      const checks = item?.tooltip?.checks ?? null;
      const barWidth = Math.max(end[0] - start[0], 1);
      if (checks) {
        const stripY = barTop + barH + BAR_TO_ICON_GAP;
        const stripX = start[0];
        const minX = coordSys.x;
        const maxX = coordSys.x + coordSys.width;

        const placeIcon = (
          code: CheckCode,
          status: CheckStatus,
          x: number,
          y: number,
          size: number,
        ) => {
          if (x + size < minX || x > maxX) return;
          children.push({
            type: "image",
            silent: true,
            style: {
              image: buildCheckSvgDataUri(code, status),
              x,
              y,
              width: size,
              height: size,
            },
          });
        };

        const tier = iconTier(barWidth);
        if (tier === "full") {
          for (let i = 0; i < BAR_STRIP_CODES.length; i++) {
            const code = BAR_STRIP_CODES[i];
            const status = (checks[code]?.status ?? "On Track") as CheckStatus;
            placeIcon(code, status, stripX + i * (ICON_SIZE + ICON_GAP), stripY, ICON_SIZE);
          }
        } else if (tier === "half") {
          const SMALL = 10;
          const SMALL_GAP = 1;
          for (let i = 0; i < BAR_STRIP_CODES.length; i++) {
            const code = BAR_STRIP_CODES[i];
            const status = (checks[code]?.status ?? "On Track") as CheckStatus;
            placeIcon(code, status, stripX + i * (SMALL + SMALL_GAP), stripY + 2, SMALL);
          }
        } else if (tier === "grid") {
          // 4×2 mini grid — 8 icons split evenly (4 in each row)
          const GRID_SIZE = 9;
          const GRID_GAP = 1;
          for (let i = 0; i < BAR_STRIP_CODES.length; i++) {
            const code = BAR_STRIP_CODES[i];
            const status = (checks[code]?.status ?? "On Track") as CheckStatus;
            const row = Math.floor(i / 4);
            const col = i % 4;
            const x = stripX + col * (GRID_SIZE + GRID_GAP);
            const y = stripY + row * (GRID_SIZE + GRID_GAP);
            placeIcon(code, status, x, y, GRID_SIZE);
          }
        } else {
          // Single worst-status icon — keeps identity even at the smallest size
          const worst = worstCheck(checks);
          if (worst) {
            const ICON = 12;
            const x = stripX + Math.max(0, (barWidth - ICON) / 2);
            placeIcon(worst.code, worst.status, x, stripY + 4, ICON);
          }
        }
      }

      // Flood-risk droplet — solid blue, at the bar's right edge, on top of the fill.
      if (floodMark) {
        const FLOOD = 13;
        children.push({
          type: "image",
          silent: true,
          style: {
            image: buildDropletSvgDataUri(),
            x: clippedBar.x + clippedBar.width - FLOOD - 3,
            y: clippedBar.y + (clippedBar.height - FLOOD) / 2,
            width: FLOOD,
            height: FLOOD,
          },
        });
      }

      return {
        type: "group",
        children,
      } as unknown as CustomSeriesRenderItemReturn;
    }

    // Contract-expiry markers: one per rig with an in-force contract that has an end
    // date, placed at that date along the rig's row (replaces the old Y-axis alarm).
    // Each marker carries a tooltip payload — rig, formatted expiry date,
    // days-remaining and contract-status label — surfaced on hover.
    const fmtExpiry = (iso: string) => {
      const [yy, mm, dd] = iso.slice(0, 10).split("-").map(Number);
      const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      return `${dd} ${MONTHS[mm - 1]} ${yy}`;
    };
    const relExpiry = (days: number) => {
      if (days === 0) return "today";
      if (days > 0) return `in ${days} day${days === 1 ? "" : "s"}`;
      const n = -days;
      return `${n} day${n === 1 ? "" : "s"} ago`;
    };
    const contractMarkers: {
      value: [number, number];
      hex: string;
      contract: { kind: "rig" | "hwu"; name: string; date: string; rel: string; status: string };
    }[] = [];
    if (contractsByRig || contractsByHwu) {
      categories.forEach((cat, i) => {
        // Each row is one resource (rig or HWU); mark its contract's expiry.
        const res = categoryToResource.get(cat);
        const contract = res
          ? (res.kind === "rig" ? contractsByRig : contractsByHwu)?.get(res.name)
          : undefined;
        const urgency = classifyContract(contract);
        // #5: the Gantt flags EXPIRED contracts only (the dashboard keeps the
        // full Healthy → Expired gradient for early-warning planning).
        if (contract?.contract_end && urgency === "expired") {
          contractMarkers.push({
            value: [new Date(contract.contract_end).getTime(), i],
            hex: URGENCY_VISUAL[urgency].hex,
            contract: {
              kind: res?.kind ?? "rig",
              name: res?.name ?? "—",
              date: fmtExpiry(contract.contract_end),
              rel: relExpiry(daysUntilExpiry(contract) ?? 0),
              status: URGENCY_VISUAL[urgency].label,
            },
          });
        }
      });
    }

    function renderContractMarker(
      params: CustomSeriesRenderItemParams,
      api: CustomSeriesRenderItemAPI,
    ): CustomSeriesRenderItemReturn {
      const [cx, cy] = api.coord([api.value(0), api.value(1)]);
      const hex = contractMarkers[params.dataIndex]?.hex ?? URGENCY_VISUAL.healthy.hex;
      return {
        type: "image",
        style: {
          image: buildAlarmClockSvgDataUri(hex),
          x: cx - 8,
          y: cy - 8,
          width: 16,
          height: 16,
        },
      } as unknown as CustomSeriesRenderItemReturn;
    }

    return {
      backgroundColor: theme.bg,
      animation: true,
      animationDuration: 600,
      animationEasing: "cubicOut",

      tooltip: {
        trigger: "item",
        appendToBody: true,
        confine: true,
        backgroundColor: theme.tooltipBg,
        borderColor: theme.tooltipBorder,
        borderWidth: 1,
        padding: [10, 14],
        textStyle: { color: theme.tooltipText, fontSize: 13 },
        extraCssText:
          (resolved === "dark"
            ? "box-shadow: 0 16px 40px -8px rgba(0,0,0,0.6), 0 4px 12px -2px rgba(0,0,0,0.4); border-radius: 8px;"
            : "box-shadow: 0 10px 32px -8px rgba(15,23,42,0.18); border-radius: 8px;") +
          " z-index: 100;",
        formatter: (p: unknown) => {
          const params = p as {
            data: {
              hex?: string;
              contract?: { kind: "rig" | "hwu"; name: string; date: string; rel: string; status: string };
              tooltip?: {
                activity: string;
                well: string | null;
                rig: string | null;
                hwu: string | null;
                project: string | null;
                start: string;
                end: string;
                plan: string | null;
                risk: string | null;
                checks: Record<string, { status: CheckStatus }> | null;
              };
            };
          };
          // Contextually HTML-encode any data-supplied text (rig / well / activity
          // names) before it lands in the tooltip's innerHTML — a stored value is
          // not trusted just because it round-tripped the database.
          const esc = (s: string) =>
            s.replace(
              /[&<>"']/g,
              (ch) =>
                ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] as string,
            );
          const row = (label: string, val: string | null) =>
            val
              ? `<div style="display:flex;gap:8px;margin-top:4px"><span style="color:${theme.tooltipMuted};min-width:60px">${label}</span><span style="font-weight:500">${esc(val)}</span></div>`
              : "";

          // Contract-expiry clock marker → a resource / date / urgency card.
          const c = params.data.contract;
          if (c) {
            return `
              <div style="font-weight:600;font-size:14px;margin-bottom:6px;color:${theme.tooltipText}">Contract expiry</div>
              ${row(c.kind === "hwu" ? "HWU" : "Rig", c.name)}
              ${row("Expires", c.date)}
              <div style="display:flex;gap:8px;margin-top:2px"><span style="min-width:60px"></span><span style="color:${theme.tooltipMuted}">${esc(c.rel)}</span></div>
              <div style="display:flex;gap:8px;margin-top:4px"><span style="color:${theme.tooltipMuted};min-width:60px">Status</span><span style="font-weight:600;color:${params.data.hex ?? theme.tooltipText}">${esc(c.status)}</span></div>
            `;
          }

          const t = params.data.tooltip;
          if (!t) return "";

          let checksHtml = "";
          if (t.checks) {
            const cells = CHECK_CODES.map((code) => {
              const status =
                (t.checks?.[code]?.status as CheckStatus | undefined) ?? "On Track";
              // Embed the same Lucide icon used in the on-bar strip + readiness
              // grid, status-coloured. Renders as an HTML <img> via data URI.
              const iconSrc = buildCheckSvgDataUri(code, status);
              return `<div style="display:flex;align-items:center;gap:6px;font-size:11px">
                <img src="${iconSrc}" width="13" height="13" style="display:block;flex-shrink:0" alt="" />
                <span style="color:${theme.tooltipText};font-weight:600">${code}</span>
                <span style="color:${theme.tooltipMuted}">${STATUS_LABEL[status]}</span>
              </div>`;
            }).join("");
            checksHtml = `
              <div style="margin-top:10px;padding-top:8px;border-top:1px solid ${theme.tooltipDivider}">
                <div style="font-size:10px;font-weight:700;letter-spacing:0.06em;color:${theme.tooltipMuted};margin-bottom:6px">READINESS</div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 12px">${cells}</div>
              </div>`;
          }

          return `
            <div style="font-weight:600;font-size:14px;margin-bottom:6px;color:${theme.tooltipText}">${esc(t.activity)}</div>
            ${row("Well", t.well)}
            ${row("Rig", t.rig)}
            ${row("HWU", t.hwu)}
            ${row("Project", t.project)}
            ${row("Start", t.start)}
            ${row("End", t.end)}
            ${row("Plan", t.plan)}
            ${row("Risk", t.risk)}
            ${checksHtml}
          `;
        },
      },

      grid: { top: 16, left: 12, right: 16, bottom: 20, containLabel: true },

      xAxis: {
        type: "time",
        axisLabel: {
          formatter: (val: number) => {
            const d = new Date(val);
            return `${d.toLocaleString("default", { month: "short" })}\n${d.getFullYear()}`;
          },
          color: theme.axisLabel,
          fontSize: 11,
          // Emit click events from axis labels so a tap on a month/year focuses
          // that whole calendar year (handled in onEvents.click).
          triggerEvent: true,
        },
        axisLine: { lineStyle: { color: theme.axisLine } },
        splitLine: { show: true, lineStyle: { color: theme.splitLine, type: "solid" } },
      },

      yAxis: {
        type: "category",
        data: categories,
        inverse: true,
        // The contract-expiry alarm used to live here on the rig label; it now sits
        // on the timeline at the actual expiry date (see the contract-marker series).
        axisLabel: {
          width: 220,
          overflow: "truncate",
          color: theme.yLabel,
          fontSize: 12,
          fontWeight: "500",
        },
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
        splitArea: {
          show: true,
          areaStyle: { color: theme.yStripe },
        },
      },

      // filterMode "none" keeps bars that straddle the focused window visible
      // (clipped by renderItem) instead of dropping them — correct for a Gantt.
      // startValue/endValue (when a year is focused) come from focusZoom.
      dataZoom: [{ type: "inside", xAxisIndex: 0, filterMode: "none", ...focusZoom }],

      series: [
        {
          type: "custom",
          renderItem,
          // Clip elements (incl. bar labels) that exceed the coordinate system
          // when zoomed into a single year — belt-and-braces with the manual
          // rect clamp in renderItem.
          clip: true,
          encode: { x: [1, 2], y: 0 },
          data: displayData,
          // Disable ECharts' built-in series emphasis tinting (which would
          // recolour our activity-type bars to a flat green on hover and could
          // wash out the red conflict outline). We rely on the per-rect emphasis
          // returned from renderItem for the shadow effect — that still fires
          // because emphasis on individual elements inside a custom series is
          // independent of series-level emphasis.
          emphasis: { disabled: true },
          // Bar labels are drawn clip-aware inside renderItem (see above), so the
          // series-level label is disabled to avoid double labels that escape
          // the plot area when zoomed.
          label: { show: false },
          // Alternating month/year bands behind the bars (silent → no hover/tooltip).
          // The bottom time axis names the dates, so the bands carry no labels.
          markArea: bandMarkArea(bandAreas),
          markLine: {
            silent: true,
            symbol: ["none", "none"],
            data: [{ xAxis: today }],
            lineStyle: {
              color: theme.todayLine,
              type: "dashed",
              width: 2,
              opacity: 0.8,
            },
            label: {
              formatter: "Today",
              position: "insideEndTop",
              color: theme.todayLabel,
              fontSize: 11,
              fontWeight: "600",
            },
          },
        },
        {
          // Contract-expiry alarm markers, on top of the bars; clipped to the
          // zoom window so off-screen expiries simply don't show.
          type: "custom",
          z: 6,
          // Not silent: the markers feed the item tooltip, so hovering a clock
          // surfaces the rig, expiry date, days-remaining and contract status.
          silent: false,
          clip: true,
          renderItem: renderContractMarker,
          data: contractMarkers,
        },
      ],

      _chartHeight: chartHeight,
    } as unknown as EChartsOption;
  }, [categories, displayData, theme, resolved, contractsByRig, contractsByHwu, categoryToResource, activeYear, dataMin, dataMax, selectedProjects, enableFilters]);

  const chartHeight = (option as { _chartHeight?: number })._chartHeight ?? 500;

  // Zoom-adaptive bands: on free scroll/pinch zoom (no React re-render under
  // notMerge) recompute the bands from the live visible window and merge just the
  // markArea, so granularity follows the zoom without resetting it. Month bands
  // once the visible window is ≲2 years, coarser year bands when wider.
  const chartRef = useRef<ReactECharts>(null);
  const bandRaf = useRef(false);
  const updateBands = useCallback(() => {
    const inst = chartRef.current?.getEchartsInstance();
    if (!inst) return;
    const dz = (
      inst.getOption() as {
        dataZoom?: Array<{ start?: number; end?: number; startValue?: number; endValue?: number }>;
      }
    ).dataZoom?.[0];
    const span = Math.max(1, dataMax - dataMin);
    let vs: number;
    let ve: number;
    if (dz?.startValue != null && dz?.endValue != null) {
      vs = Number(dz.startValue);
      ve = Number(dz.endValue);
    } else {
      vs = dataMin + (span * (dz?.start ?? 0)) / 100;
      ve = dataMin + (span * (dz?.end ?? 100)) / 100;
    }
    const days = (ve - vs) / 86_400_000;
    const unit: "month" | "year" = days <= 800 ? "month" : "year";
    const pad = (ve - vs) * 0.05;
    const areas = buildTimeBands(
      Math.max(dataMin, vs - pad),
      Math.min(dataMax + 86_400_000, ve + pad),
      unit,
      theme.xBand,
    );
    inst.setOption(
      { series: [{ markArea: bandMarkArea(areas) }] } as unknown as EChartsOption,
      { notMerge: false, lazyUpdate: true },
    );
  }, [dataMin, dataMax, theme]);

  const onEvents = useMemo(
    () => ({
      click: (params: {
        componentType?: string;
        value?: number | string;
        data?: { activityId?: string };
      }) => {
        // A click on an x-axis (month/year) label focuses that whole year.
        if (params.componentType === "xAxis") {
          const ts =
            typeof params.value === "number"
              ? params.value
              : Date.parse(String(params.value));
          if (!Number.isNaN(ts)) focusYear(new Date(ts).getFullYear());
          return;
        }
        const id = params.data?.activityId;
        if (id) onActivityClick?.(id);
      },
      // Refresh the bands as the user scroll/pinch zooms (coalesced to one per frame).
      dataZoom: () => {
        if (bandRaf.current) return;
        bandRaf.current = true;
        requestAnimationFrame(() => {
          bandRaf.current = false;
          updateBands();
        });
      },
    }),
    [focusYear, onActivityClick, updateBands],
  );

  const chartEl = (
    <div
      className={`overflow-x-auto rounded-xl border border-border/70 bg-card shadow-soft-sm${
        legendPosition === "right" ? " min-w-0 flex-1" : ""
      }`}
    >
      <ReactECharts
        ref={chartRef}
        option={option}
        style={{ height: chartHeight, minWidth: 700 }}
        notMerge
        lazyUpdate
        opts={{ renderer: "canvas", devicePixelRatio: window.devicePixelRatio }}
        onEvents={onEvents}
      />
    </div>
  );
  const legendEl = (
    <ChartLegend
      activityTypes={activityTypes}
      showReadiness={!!readinessMap}
      showContractExpiry={!!(contractsByRig || contractsByHwu)}
      showFloodRisk={hasFlood}
      className={
        legendPosition === "right"
          ? "self-start lg:w-60 lg:shrink-0 lg:flex-col lg:flex-nowrap lg:gap-3"
          : undefined
      }
    />
  );

  return (
    <div
      data-testid="drill-chart"
      className="flex w-full flex-col gap-3"
    >
      {(years.length > 1 ||
        (enableFilters && (projects.length > 1 || locations.length > 1))) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {years.length > 1 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-xs font-medium text-muted-foreground">
                Focus year
              </span>
              <button
                type="button"
                onClick={() => focusYear(null)}
                aria-pressed={activeYear === null}
                className={yearChipClass(activeYear === null)}
              >
                All
              </button>
              {years.map((y) => (
                <button
                  key={y}
                  type="button"
                  onClick={() => focusYear(y)}
                  aria-pressed={activeYear === y}
                  className={yearChipClass(activeYear === y)}
                >
                  {y}
                </button>
              ))}
            </div>
          )}
          {enableFilters && projects.length > 1 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-xs font-medium text-muted-foreground">
                Projects
              </span>
              <MultiSelectFilter
                items={projects}
                selected={selectedProjects}
                onChange={setSelectedProjects}
                allLabel="All projects"
                filterLabel="Filter by project"
              />
            </div>
          )}
          {enableFilters && locations.length > 1 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-xs font-medium text-muted-foreground">
                Location
              </span>
              <MultiSelectFilter
                items={locations}
                selected={selectedLocations}
                onChange={setSelectedLocations}
                allLabel="All locations"
                filterLabel="Filter by location"
              />
            </div>
          )}
        </div>
      )}
      {legendPosition === "right" ? (
        <div className="flex flex-col gap-3 lg:flex-row lg:gap-4">
          {chartEl}
          {legendEl}
        </div>
      ) : (
        <>
          {chartEl}
          {legendEl}
        </>
      )}
    </div>
  );
}
