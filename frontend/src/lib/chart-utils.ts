import type { Activity } from "@/api/activities";
import type { CheckCode, CheckStatus } from "@/api/readiness";
import { getActivityColor } from "./chart-colors";
import { formatDate } from "./utils";
import { terrainRank } from "./gantt-rows";

/**
 * Readiness is per FIELD-DEVELOPMENT PROJECT, so this map is keyed by an
 * activity's `well_project` (e.g. "Bonga Phase 3") — every activity sharing a
 * field project resolves to the same gates. Activities with no `well_project`
 * have no entry (and show no gates).
 */
export type ReadinessMap = Map<string, Record<CheckCode, { status: CheckStatus }>>;

/** The scheduling resource a row represents — a rig or an HWU. */
export interface ChartResource {
  kind: "rig" | "hwu";
  name: string;
  /** The rig lane's terrain (activity location); null for HWUs (mobile). */
  terrain?: string | null;
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
  /** How the bar renders its project's gates. Readiness is per FIELD PROJECT,
   *  so repeating the full strip on every bar of a project would be redundant
   *  ink that reads as per-activity state (the exact misreading behind the old
   *  data model). Instead: "anchor" = the project's earliest pending bar
   *  carries the full strip (the decision point); "sibling" = its other
   *  pending bars show a single worst-gate marker ONLY while a gate is Behind
   *  (exception display — silence means fine); "none" = no gates (no project,
   *  opt-out, or completed). Every bar's tooltip still lists the full gates. */
  readinessRole: "anchor" | "sibling" | "none";
}

export interface ChartData {
  categories: string[];
  data: ChartDataItem[];
  activityTypes: string[];
  /** Maps each Y-axis category label back to the resource (rig or HWU) it represents. */
  categoryToResource: Map<string, ChartResource>;
}

/** An activity's resource — rig or HWU — with the rig's terrain (rig identity is
 *  (terrain, name); HWUs are mobile so their terrain is null). */
function resourceOf(a: Activity): ChartResource | null {
  if (a.rig_name) return { kind: "rig", name: a.rig_name, terrain: a.location ?? null };
  if (a.hwu_name) return { kind: "hwu", name: a.hwu_name, terrain: null };
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

  // The readiness ANCHOR per field project: its earliest not-completed,
  // gate-carrying activity (opt-outs skipped — they never anchor). Completed
  // work has no "are we ready" question left, so a fully-completed project
  // anchors nowhere; its gates remain reachable via every bar's tooltip.
  const gatesFor = (a: Activity) =>
    a.readiness_required === false || !a.well_project
      ? null
      : (readinessMap?.get(a.well_project) ?? null);
  const anchorByProject = new Map<string, string>(); // well_project → activity id
  for (const a of sorted) {
    if (a.completed_at || !gatesFor(a)) continue;
    const current = anchorByProject.get(a.well_project!);
    if (current === undefined) {
      anchorByProject.set(a.well_project!, a.id);
    } else {
      const cur = sorted.find((x) => x.id === current)!;
      if (
        a.start_date < cur.start_date ||
        (a.start_date === cur.start_date && a.id < cur.id)
      ) {
        anchorByProject.set(a.well_project!, a.id);
      }
    }
  }

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
        start: formatDate(a.start_date),
        end: formatDate(a.end_date),
        plan: a.plan_type,
        risk: a.risk,
        // Readiness is per field project — resolve the activity's gates by its
        // `well_project`. Opt-out activities (readiness_required === false) and
        // those with no field project carry no gates, so suppress the on-bar icon
        // strip and the tooltip's readiness section.
        checks: gatesFor(a),
      },
      readinessRole:
        gatesFor(a) === null || a.completed_at
          ? "none"
          : anchorByProject.get(a.well_project!) === a.id
            ? "anchor"
            : "sibling",
    };
  });

  return { categories, data, activityTypes, categoryToResource };
}
