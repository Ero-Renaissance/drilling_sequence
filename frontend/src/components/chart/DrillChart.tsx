import { useCallback, useMemo, useState } from "react";
import ReactECharts from "echarts-for-react";
import type {
  EChartsOption,
  CustomSeriesRenderItemParams,
  CustomSeriesRenderItemAPI,
  CustomSeriesRenderItemReturn,
} from "echarts";
import type { Activity } from "@/api/activities";
import type { RigContract } from "@/api/contracts";
import { CHECK_CODES, type CheckCode, type CheckStatus } from "@/api/readiness";
import { activitiesToChartData, type ReadinessMap } from "@/lib/chart-utils";
import {
  buildAlarmClockSvgDataUri,
  buildCheckSvgDataUri,
} from "@/lib/check-icon-svg";
import {
  classifyContract,
  isCompletedUrgency,
  URGENCY_VISUAL,
} from "@/lib/contract-urgency";
import { useThemeStore } from "@/store/theme";
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

/**
 * Reduce the 7 per-activity checks into the single most-concerning check so we
 * can render an informative summary on bars too small for the full icon strip.
 *
 * Severity order (highest → lowest): Behind > In Progress > Not Started > Completed > N/A.
 * Returns the WORST check's code + status so we can render its identifying icon.
 */
function worstCheck(
  checks: Record<string, { status: CheckStatus }> | null | undefined,
): { code: CheckCode; status: CheckStatus } | null {
  if (!checks) return null;
  const rank: Record<CheckStatus, number> = {
    Behind: 4,
    "In Progress": 3,
    "Not Started": 2,
    Completed: 1,
    "N/A": 0,
  };
  let winner: { code: CheckCode; status: CheckStatus } | null = null;
  for (const code of BAR_STRIP_CODES) {
    const s = checks[code]?.status as CheckStatus | undefined;
    if (!s) continue;
    if (!winner || rank[s] > rank[winner.status]) {
      winner = { code, status: s };
    }
  }
  return winner;
}

interface DrillChartProps {
  activities: Activity[];
  readinessMap?: ReadinessMap;
  /** Map of rig_name → contract. When present the Y-axis shows an expiry dot per rig. */
  contractsByRig?: Map<string, RigContract>;
  conflictIds?: Set<string>;
  onActivityClick?: (activityId: string) => void;
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
};

/**
 * Alternating shaded bands for the time axis, as ECharts `markArea` pairs. Only
 * every other interval is emitted (the shaded ones); the gaps stay the chart
 * background. Granularity adapts to zoom: "month" when focused on a single year,
 * "year" across the full span (where month bands would be hair-thin noise).
 */
function buildTimeBands(
  from: number,
  to: number,
  unit: "month" | "year",
  color: string,
): Array<[{ xAxis: number; itemStyle: { color: string } }, { xAxis: number }]> {
  const areas: Array<[{ xAxis: number; itemStyle: { color: string } }, { xAxis: number }]> = [];
  const start = new Date(from);
  let cur =
    unit === "month"
      ? new Date(start.getFullYear(), start.getMonth(), 1)
      : new Date(start.getFullYear(), 0, 1);
  for (let i = 0; cur.getTime() < to; i++) {
    const next =
      unit === "month"
        ? new Date(cur.getFullYear(), cur.getMonth() + 1, 1)
        : new Date(cur.getFullYear() + 1, 0, 1);
    if (i % 2 === 1) {
      areas.push([{ xAxis: cur.getTime(), itemStyle: { color } }, { xAxis: next.getTime() }]);
    }
    cur = next;
  }
  return areas;
}

// ── Component ────────────────────────────────────────────────────────────────

export function DrillChart({
  activities,
  readinessMap,
  contractsByRig,
  conflictIds,
  onActivityClick,
}: DrillChartProps) {
  const resolved = useThemeStore((s) => s.resolved);
  const theme = resolved === "dark" ? DARK_THEME : LIGHT_THEME;

  const [activeYear, setActiveYear] = useState<number | null>(null);

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

  // Focus the chart on one calendar year, or the full span (null). We drive this
  // through the option's dataZoom window (see below) rather than an imperative
  // dispatchAction: each change becomes a clean notMerge re-render, so no stale
  // custom-series elements (bars/labels) linger from the previous window.
  const focusYear = useCallback((year: number | null) => setActiveYear(year), []);

  const { categories, data, activityTypes, categoryToRig } = useMemo(
    () => activitiesToChartData(activities, readinessMap),
    [activities, readinessMap],
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

    // Alternating time bands behind the bars, so a reader can place an activity in
    // its month. Month granularity when focused on one year; year granularity across
    // the full span (12 narrow month bands per year would just be noise zoomed out).
    const allTimes = displayData.flatMap((d) =>
      Array.isArray(d.value) ? [Number(d.value[1]), Number(d.value[2])] : [],
    );
    const bandAreas =
      activeYear === null
        ? buildTimeBands(
            allTimes.length ? Math.min(...allTimes) : today,
            allTimes.length ? Math.max(...allTimes) : today,
            "year",
            theme.xBand,
          )
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

      const coordSys = params.coordSys as {
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

      const children: Array<Record<string, unknown>> = [
        {
          type: "rect",
          shape: clippedBar,
          style: {
            ...baseStyle,
            fill,
            stroke: isConflict ? conflictStroke : undefined,
            lineWidth: isConflict ? 2 : 0,
            shadowBlur: isCompleted ? 0 : 2,
            shadowColor: "rgba(0,0,0,0.15)",
            shadowOffsetY: 1,
          },
        },
      ];

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
            width: clippedBar.width - 12,
            overflow: "truncate",
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

        if (barWidth >= 135) {
          for (let i = 0; i < BAR_STRIP_CODES.length; i++) {
            const code = BAR_STRIP_CODES[i];
            const status = (checks[code]?.status ?? "Not Started") as CheckStatus;
            placeIcon(code, status, stripX + i * (ICON_SIZE + ICON_GAP), stripY, ICON_SIZE);
          }
        } else if (barWidth >= 90) {
          const SMALL = 10;
          const SMALL_GAP = 1;
          for (let i = 0; i < BAR_STRIP_CODES.length; i++) {
            const code = BAR_STRIP_CODES[i];
            const status = (checks[code]?.status ?? "Not Started") as CheckStatus;
            placeIcon(code, status, stripX + i * (SMALL + SMALL_GAP), stripY + 2, SMALL);
          }
        } else if (barWidth >= 45) {
          // 4×2 mini grid — 8 icons split evenly (4 in each row)
          const GRID_SIZE = 9;
          const GRID_GAP = 1;
          for (let i = 0; i < BAR_STRIP_CODES.length; i++) {
            const code = BAR_STRIP_CODES[i];
            const status = (checks[code]?.status ?? "Not Started") as CheckStatus;
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

      return {
        type: "group",
        children,
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
              tooltip: {
                activity: string;
                well: string | null;
                rig: string | null;
                start: string;
                end: string;
                plan: string | null;
                risk: string | null;
                checks: Record<string, { status: CheckStatus }> | null;
              };
            };
          };
          const t = params.data.tooltip;
          const row = (label: string, val: string | null) =>
            val
              ? `<div style="display:flex;gap:8px;margin-top:4px"><span style="color:${theme.tooltipMuted};min-width:60px">${label}</span><span style="font-weight:500">${val}</span></div>`
              : "";

          let checksHtml = "";
          if (t.checks) {
            const cells = CHECK_CODES.map((code) => {
              const status =
                (t.checks?.[code]?.status as CheckStatus | undefined) ?? "Not Started";
              // Embed the same Lucide icon used in the on-bar strip + readiness
              // grid, status-coloured. Renders as an HTML <img> via data URI.
              const iconSrc = buildCheckSvgDataUri(code, status);
              return `<div style="display:flex;align-items:center;gap:6px;font-size:11px">
                <img src="${iconSrc}" width="13" height="13" style="display:block;flex-shrink:0" alt="" />
                <span style="color:${theme.tooltipText};font-weight:600">${code}</span>
                <span style="color:${theme.tooltipMuted}">${status}</span>
              </div>`;
            }).join("");
            checksHtml = `
              <div style="margin-top:10px;padding-top:8px;border-top:1px solid ${theme.tooltipDivider}">
                <div style="font-size:10px;font-weight:700;letter-spacing:0.06em;color:${theme.tooltipMuted};margin-bottom:6px">READINESS</div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 12px">${cells}</div>
              </div>`;
          }

          return `
            <div style="font-weight:600;font-size:14px;margin-bottom:6px;color:${theme.tooltipText}">${t.activity}</div>
            ${row("Well", t.well)}
            ${row("Rig", t.rig)}
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
        axisLabel: {
          width: 220,
          overflow: "truncate",
          color: theme.yLabel,
          fontSize: 12,
          fontWeight: "500",
          formatter: (value: string) => {
            if (!contractsByRig) return value;
            const rigName = categoryToRig.get(value);
            if (!rigName) return value;
            const urgency = classifyContract(contractsByRig.get(rigName));
            // Alarm clock is only meaningful for COMPLETED (in-force) contracts.
            // For workflow states (not_started / in_progress / na) we don't
            // pretend there's an expiry to watch — just render the plain label.
            if (!urgency || !isCompletedUrgency(urgency)) return value;
            return `{alarm_${urgency}|}  {label|${value}}`;
          },
          rich: {
            alarm_healthy: {
              backgroundColor: {
                image: buildAlarmClockSvgDataUri(URGENCY_VISUAL.healthy.hex),
              },
              width: 16,
              height: 16,
            },
            alarm_soon: {
              backgroundColor: {
                image: buildAlarmClockSvgDataUri(URGENCY_VISUAL.soon.hex),
              },
              width: 16,
              height: 16,
            },
            alarm_critical: {
              backgroundColor: {
                image: buildAlarmClockSvgDataUri(URGENCY_VISUAL.critical.hex),
              },
              width: 16,
              height: 16,
            },
            alarm_expired: {
              backgroundColor: {
                image: buildAlarmClockSvgDataUri(URGENCY_VISUAL.expired.hex),
              },
              width: 16,
              height: 16,
            },
            alarm_incomplete: {
              backgroundColor: {
                image: buildAlarmClockSvgDataUri(URGENCY_VISUAL.incomplete.hex),
              },
              width: 16,
              height: 16,
            },
            label: { color: theme.yLabel, fontSize: 12, fontWeight: "500" },
          },
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
          markArea: {
            silent: true,
            itemStyle: { color: theme.xBand },
            data: bandAreas,
          },
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
      ],

      _chartHeight: chartHeight,
    } as EChartsOption;
  }, [categories, displayData, theme, resolved, contractsByRig, categoryToRig, activeYear]);

  const chartHeight = (option as { _chartHeight?: number })._chartHeight ?? 500;

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
    }),
    [focusYear, onActivityClick],
  );

  return (
    <div
      data-testid="drill-chart"
      className="flex w-full flex-col gap-3"
    >
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
      <div className="overflow-x-auto rounded-xl border border-border/70 bg-card shadow-soft-sm">
        <ReactECharts
          option={option}
          style={{ height: chartHeight, minWidth: 700 }}
          notMerge
          lazyUpdate
          opts={{ renderer: "canvas", devicePixelRatio: window.devicePixelRatio }}
          onEvents={onEvents}
        />
      </div>
      <ChartLegend
        activityTypes={activityTypes}
        showReadiness={!!readinessMap}
        showContractExpiry={!!contractsByRig}
      />
    </div>
  );
}
