import type { Activity } from "@/api/activities";
import type { CheckCode, CheckStatus } from "@/api/readiness";
import { getActivityColor } from "./chart-colors";
import { terrainRank } from "./gantt-rows";

export type ReadinessMap = Map<string, Record<CheckCode, { status: CheckStatus }>>;

/** The scheduling resource a row represents — a rig or an HWU. */
export interface ChartResource {
  kind: "rig" | "hwu";
  name: string;
}

export interface ChartDataItem {
  activityId: string;
  name: string;
  value: [number, number, number, string, string | null, string | null, string | null, string | null, string | null];
  itemStyle: { color: string; borderRadius: number };
  label: { show: boolean; formatter: string; color: string; fontSize: number };
  tooltip: {
    activity: string;
    well: string | null;
    rig: string | null;
    hwu: string | null;
    project: string | null;
    start: string;
    end: string;
    plan: string | null;
    risk: string | null;
    checks: Record<CheckCode, { status: CheckStatus }> | null;
  };
  isConflict?: boolean;
  isCompleted?: boolean;
}

export interface ChartData {
  categories: string[];
  data: ChartDataItem[];
  activityTypes: string[];
  /** Maps each Y-axis category label back to the resource (rig or HWU) it represents. */
  categoryToResource: Map<string, ChartResource>;
}

/** An activity's resource as a (kind, name) pair — its rig or its HWU, or null. */
function resourceOf(a: Activity): ChartResource | null {
  if (a.rig_name) return { kind: "rig", name: a.rig_name };
  if (a.hwu_name) return { kind: "hwu", name: a.hwu_name };
  return null;
}

/** The Y-axis-facing resource label: rigs as-is, HWUs tagged so they read
 *  distinctly from rigs in the row label (e.g. "HWU · Unit-1"). */
function resourceLabel(a: Activity): string | null {
  const r = resourceOf(a);
  if (!r) return null;
  return r.kind === "hwu" ? `HWU · ${r.name}` : r.name;
}

/** The row's distinguishing second part: its resource (rig / HWU) when it has
 *  one, otherwise its activity type — so a resource-less activity groups under
 *  "location – activity type" instead of collapsing onto a bare-location row. */
function rowSecondary(a: Activity): string {
  return resourceLabel(a) ?? a.activity_type;
}

function getLabel(a: Activity): string {
  const second = rowSecondary(a);
  return a.location ? `${a.location} – ${second}` : second;
}

function sortActivities(activities: Activity[]): Activity[] {
  return [...activities].sort((a, b) => {
    const locDiff = terrainRank(a.location) - terrainRank(b.location);
    if (locDiff !== 0) return locDiff;
    const resCmp = rowSecondary(b).localeCompare(rowSecondary(a));
    if (resCmp !== 0) return resCmp;
    return a.start_date.localeCompare(b.start_date);
  });
}

function toMs(dateStr: string): number {
  return new Date(dateStr + "T00:00:00").getTime();
}

export function activitiesToChartData(activities: Activity[], readinessMap?: ReadinessMap): ChartData {
  const sorted = sortActivities(activities);

  // Build ordered unique category list + a category→resource map so callers (the
  // chart Y-axis label formatter and the contract-expiry marker) can look up which
  // rig / HWU each row represents.
  const seen = new Set<string>();
  const categories: string[] = [];
  const categoryToResource = new Map<string, ChartResource>();
  for (const a of sorted) {
    const lbl = getLabel(a);
    if (!seen.has(lbl)) {
      seen.add(lbl);
      categories.push(lbl);
    }
    const res = resourceOf(a);
    if (res && !categoryToResource.has(lbl)) {
      categoryToResource.set(lbl, res);
    }
  }

  const activityTypes = [...new Set(sorted.map((a) => a.activity_type))];

  const data: ChartDataItem[] = sorted.map((a) => {
    const yIndex = categories.indexOf(getLabel(a));
    const startMs = toMs(a.start_date);
    const endMs = toMs(a.end_date);
    const durationDays = Math.round((endMs - startMs) / 86_400_000);
    const color = getActivityColor(a.activity_type);

    return {
      activityId: a.id,
      name: a.activity_type,
      value: [yIndex, startMs, endMs, a.activity_type, a.well_name, a.rig_name, a.plan_type, a.risk, a.well_project],
      itemStyle: { color, borderRadius: 3 },
      label: {
        show: durationDays >= 10,
        formatter: a.well_name ?? a.activity_type,
        color: "#fff",
        fontSize: 11,
      },
      tooltip: {
        activity: a.activity_type,
        well: a.well_name,
        rig: a.rig_name,
        hwu: a.hwu_name ?? null,
        project: a.well_project,
        start: a.start_date,
        end: a.end_date,
        plan: a.plan_type,
        risk: a.risk,
        // Opt-out activities (readiness_required === false) carry no gates, so
        // suppress the on-bar icon strip and the tooltip's readiness section.
        checks: a.readiness_required === false ? null : (readinessMap?.get(a.id) ?? null),
      },
    };
  });

  return { categories, data, activityTypes, categoryToResource };
}
