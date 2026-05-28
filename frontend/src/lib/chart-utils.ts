import type { Activity } from "@/api/activities";
import type { CheckCode, CheckStatus } from "@/api/readiness";
import { getActivityColor } from "./chart-colors";

const LOCATION_ORDER: Record<string, number> = { LAND: 0, SWAMP: 1, OFFSHORE: 2 };

export type ReadinessMap = Map<string, Record<CheckCode, { status: CheckStatus }>>;

export interface ChartDataItem {
  activityId: string;
  name: string;
  value: [number, number, number, string, string | null, string | null, string | null, string | null];
  itemStyle: { color: string; borderRadius: number };
  label: { show: boolean; formatter: string; color: string; fontSize: number };
  tooltip: {
    activity: string;
    well: string | null;
    rig: string | null;
    start: string;
    end: string;
    plan: string | null;
    risk: string | null;
    checks: Record<CheckCode, { status: CheckStatus }> | null;
  };
}

export interface ChartData {
  categories: string[];
  data: ChartDataItem[];
  activityTypes: string[];
  /** Maps each Y-axis category label back to the rig_name it represents. */
  categoryToRig: Map<string, string>;
}

function getLabel(a: Activity): string {
  const parts: string[] = [];
  if (a.location) parts.push(a.location);
  if (a.rig_name) parts.push(a.rig_name);
  if (a.well_name) parts.push(a.well_name);
  if (parts.length >= 2) return `${parts[0]} – ${parts[1]}`;
  if (parts.length === 1) return parts[0];
  return a.activity_type;
}

function sortActivities(activities: Activity[]): Activity[] {
  return [...activities].sort((a, b) => {
    const locDiff = (LOCATION_ORDER[a.location ?? ""] ?? 99) - (LOCATION_ORDER[b.location ?? ""] ?? 99);
    if (locDiff !== 0) return locDiff;
    const rigCmp = (b.rig_name ?? "").localeCompare(a.rig_name ?? "");
    if (rigCmp !== 0) return rigCmp;
    return a.start_date.localeCompare(b.start_date);
  });
}

function toMs(dateStr: string): number {
  return new Date(dateStr + "T00:00:00").getTime();
}

export function activitiesToChartData(activities: Activity[], readinessMap?: ReadinessMap): ChartData {
  const sorted = sortActivities(activities);

  // Build ordered unique category list + a category→rig map so callers (the
  // chart Y-axis label formatter) can look up which rig each row represents.
  const seen = new Set<string>();
  const categories: string[] = [];
  const categoryToRig = new Map<string, string>();
  for (const a of sorted) {
    const lbl = getLabel(a);
    if (!seen.has(lbl)) {
      seen.add(lbl);
      categories.push(lbl);
    }
    if (a.rig_name && !categoryToRig.has(lbl)) {
      categoryToRig.set(lbl, a.rig_name);
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
      value: [yIndex, startMs, endMs, a.activity_type, a.well_name, a.rig_name, a.plan_type, a.risk],
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
        start: a.start_date,
        end: a.end_date,
        plan: a.plan_type,
        risk: a.risk,
        checks: readinessMap?.get(a.id) ?? null,
      },
    };
  });

  return { categories, data, activityTypes, categoryToRig };
}
