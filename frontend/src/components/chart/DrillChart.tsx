import { useMemo } from "react";
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

const _patternCache = new Map<string, CanvasPattern>();

function makeHatchPattern(baseColor: string): CanvasPattern | string {
  if (_patternCache.has(baseColor)) return _patternCache.get(baseColor)!;
  try {
    const size = 8;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return baseColor;
    ctx.fillStyle = baseColor;
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = "rgba(255,255,255,0.45)";
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(-1, size / 2); ctx.lineTo(size / 2, -1); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(size / 2, size + 1); ctx.lineTo(size + 1, size / 2); ctx.stroke();
    const pattern = ctx.createPattern(canvas, "repeat");
    if (!pattern) return baseColor;
    _patternCache.set(baseColor, pattern);
    return pattern;
  } catch {
    return baseColor;
  }
}

// ── Theme palettes ───────────────────────────────────────────────────────────

interface ChartTheme {
  bg: string;
  axisLabel: string;
  axisLine: string;
  splitLine: string;
  yLabel: string;
  yStripe: [string, string];
  tooltipBg: string;
  tooltipBorder: string;
  tooltipText: string;
  tooltipMuted: string;
  tooltipDivider: string;
  todayLine: string;
  todayLabel: string;
  barLabel: string;
}

const LIGHT_THEME: ChartTheme = {
  bg: "transparent",
  axisLabel: "#64748b",
  axisLine: "#e2e8f0",
  splitLine: "#f1f5f9",
  yLabel: "#334155",
  yStripe: ["rgba(248,250,252,0.6)", "rgba(255,255,255,0)"],
  tooltipBg: "rgba(255,255,255,0.97)",
  tooltipBorder: "#e2e8f0",
  tooltipText: "#1e293b",
  tooltipMuted: "#64748b",
  tooltipDivider: "#e2e8f0",
  todayLine: "#ef4444",
  todayLabel: "#ef4444",
  barLabel: "#ffffff",
};

const DARK_THEME: ChartTheme = {
  bg: "transparent",
  axisLabel: "#94a3b8",
  axisLine: "rgba(255,255,255,0.08)",
  splitLine: "rgba(255,255,255,0.04)",
  yLabel: "#cbd5e1",
  yStripe: ["rgba(255,255,255,0.03)", "rgba(255,255,255,0)"],
  tooltipBg: "rgba(30,30,36,0.97)",
  tooltipBorder: "rgba(255,255,255,0.1)",
  tooltipText: "#e2e8f0",
  tooltipMuted: "#94a3b8",
  tooltipDivider: "rgba(255,255,255,0.1)",
  todayLine: "#f87171",
  todayLabel: "#f87171",
  barLabel: "#ffffff",
};

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

  const { categories, data, activityTypes, categoryToRig } = useMemo(
    () => activitiesToChartData(activities, readinessMap),
    [activities, readinessMap],
  );

  const displayData = useMemo(() => {
    if (!conflictIds?.size) return data;
    return data.map((item) =>
      conflictIds.has(item.activityId) ? { ...item, isConflict: true } : item,
    );
  }, [data, conflictIds]);

  const option: EChartsOption = useMemo(() => {
    const ROW_HEIGHT = 56;
    const ICON_SIZE = 14;
    const ICON_GAP = 2;
    const BAR_TO_ICON_GAP = 4;
    const chartHeight = Math.max(500, categories.length * ROW_HEIGHT + 220);
    const today = Date.now();

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

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const clippedBar = (window as any).echarts?.graphic?.clipRectByRect(
        barRect,
        clipShape,
      ) ?? barRect;

      const baseStyle = api.style() as Record<string, unknown>;
      const item = displayData[params.dataIndex] as {
        isConflict?: boolean;
        tooltip?: { checks?: Record<string, { status: CheckStatus }> | null };
      };
      const isConflict = item?.isConflict ?? false;

      // Bar fill: solid family color from itemStyle, with a conflict hatch
      // overlay when this activity participates in a rig schedule clash. We
      // intentionally do not apply per-sub-type patterns — each activity type
      // gets its own distinct hue in chart-colors.ts so bar + legend always
      // match without relying on canvas pattern reliability.
      const fill =
        isConflict && typeof baseStyle.fill === "string"
          ? makeHatchPattern(baseStyle.fill)
          : baseStyle.fill;

      const children: Array<Record<string, unknown>> = [
        {
          type: "rect",
          shape: clippedBar,
          style: {
            ...baseStyle,
            fill,
            shadowBlur: 2,
            shadowColor: "rgba(0,0,0,0.15)",
            shadowOffsetY: 1,
          },
        },
      ];

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

      dataZoom: [{ type: "inside", xAxisIndex: 0 }],

      series: [
        {
          type: "custom",
          renderItem,
          encode: { x: [1, 2], y: 0 },
          data: displayData,
          // Disable ECharts' built-in series emphasis tinting (which was
          // recolouring our patterned bars to a flat green on hover). We rely
          // on the per-rect emphasis returned from renderItem for the shadow
          // effect — that still fires because emphasis on individual elements
          // inside a custom series is independent of series-level emphasis.
          emphasis: { disabled: true },
          label: {
            show: true,
            position: "inside",
            formatter: (p: unknown) => {
              const params = p as {
                data: { label: { show: boolean; formatter: string } };
              };
              return params.data.label.show ? params.data.label.formatter : "";
            },
            color: theme.barLabel,
            fontSize: 11,
            fontWeight: "500",
            overflow: "truncate",
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
  }, [categories, displayData, theme, resolved, contractsByRig, categoryToRig]);

  const chartHeight = (option as { _chartHeight?: number })._chartHeight ?? 500;

  const onEvents = onActivityClick
    ? {
        click: (params: { data?: { activityId?: string } }) => {
          const id = params.data?.activityId;
          if (id) onActivityClick(id);
        },
      }
    : undefined;

  return (
    <div
      data-testid="drill-chart"
      className="flex w-full flex-col gap-3"
    >
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
