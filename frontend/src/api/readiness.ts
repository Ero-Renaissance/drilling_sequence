import { getAccessToken } from "@/lib/auth";
import { throwApiError } from "./http";

/**
 * Readiness checks come from the admin-curated catalog
 * (`GET /api/readiness/catalog`), not a hard-coded list — a code is any catalog
 * code, validated server-side. Statuses stay a code-defined set (the "standard"
 * set below; more sets arrive with later phases).
 */
export type CheckCode = string;
export type CheckStatus =
  | "On Track"
  | "Completed"
  | "Behind"
  | "N/A"
  // "availability" status set (e.g. Nominated Equipment)
  | "Available"
  | "Pending"
  | "Not available";
export type Severity = "done" | "in_progress" | "blocked" | "not_counted";

export interface CatalogTeam {
  code: string;
  name: string;
  editor_source: "planner" | "team_grant";
  icon_key: string;
  sort_order: number;
}

/** One check definition. Also the shape a revision freezes at submit
 *  (`readiness_catalog` on the revision detail). */
export interface CatalogCheck {
  code: string;
  label: string;
  team_code: string;
  applies_project: boolean;
  applies_well: boolean;
  status_set: string;
  icon_key: string;
  locks_with_plan: boolean;
  sort_order: number;
  /** "" = none; else the controlled tag list it carries ("equipment"). Optional
   *  for definitions frozen before tag lists existed. */
  tag_list?: string;
}

/** One item of a controlled tag list — e.g. an equipment type. */
export interface TagItem {
  tag_list: string;
  code: string;
  label: string;
  category: string;
  sort_order: number;
}

export interface ReadinessCatalog {
  teams: CatalogTeam[];
  checks: CatalogCheck[];
  status_sets: Record<string, { statuses: { status: string; severity: Severity }[]; default: string }>;
  tag_items?: TagItem[];
}

export interface CheckState {
  status: CheckStatus;
  notes: string | null;
  updated_at: string | null;
  /** The entry's own tags (checks with a tag list). */
  tags?: string[];
}

/**
 * Readiness gates are tracked per FIELD-DEVELOPMENT PROJECT — the "Project"
 * column (`well_project` on an activity, e.g. "Bonga Phase 3"), NOT per activity.
 * Every activity/well under a field project shares that project's 7 gates. The
 * backend returns one entry per distinct field project in the campaign;
 * activities with no `well_project` are omitted.
 */
/** One row's readiness by the server's rollup (spec §3.7) — each row is one
 *  target. Grids add the counts of the rows they show; they never decide which
 *  cells count. */
export interface RowFigures {
  /** Cells that count (N/A doesn't). */
  counted: number;
  done: number;
  /** On track (On Track, Pending). */
  in_progress: number;
  /** Behind or Not available. */
  behind: number;
  /** Not counted (N/A). */
  na?: number;
  /** At least one counted cell, and every counted cell done. */
  ready: boolean;
}

export interface ProjectReadiness {
  well_project: string;
  /** Keyed by catalog check code — the active project gates, in catalog order. */
  checks: Record<CheckCode, CheckState>;
  /** Number of activities under this field project (shown as the row subtitle). */
  activity_count: number;
  /** Frozen while a revision is awaiting approval — the dots are disabled. */
  locked?: boolean;
  /** Earliest start (ISO date) of a not-done, readiness-required activity under
   *  this field project — the same signal the Overview readiness KPI uses. Drives
   *  the page's time filter: a project is "in the next N months" iff
   *  `focus_start <= today + N`. Null when the project has no pending readiness
   *  work (all done or opt-out), so it never falls inside a window. */
  focus_start?: string | null;
  /** Days from the SERVER's today to `focus_start` — the window is applied on the
   *  server's calendar, exactly as the Overview tile applies it. */
  focus_in_days?: number | null;
  /** The row's rollup over its gates (server-computed). */
  figures?: RowFigures;
}

async function authHeaders(): Promise<HeadersInit> {
  const token = await getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function fetchReadinessCatalog(): Promise<ReadinessCatalog> {
  const resp = await fetch("/api/readiness/catalog", { headers: await authHeaders() });
  if (!resp.ok) await throwApiError(resp, "Failed to fetch the readiness catalog");
  return resp.json();
}

export async function listReadiness(projectId: string): Promise<ProjectReadiness[]> {
  const resp = await fetch(`/api/projects/${projectId}/readiness`, {
    headers: await authHeaders(),
  });
  if (!resp.ok) await throwApiError(resp, "Failed to fetch readiness data");
  return resp.json();
}

/**
 * Set ONE readiness gate for a whole field project. `wellProject` is free-form
 * (e.g. "Gbaran 31/30", "Egbema Node FOD + IOGD"), so it travels in the JSON
 * body — never the URL path, where IIS request filtering rejects '+'/'%2B'
 * before the request reaches the API (ticket DS-001). The path carries only the
 * fixed check code.
 */
export async function upsertCheck(
  projectId: string,
  wellProject: string,
  checkCode: CheckCode,
  status: CheckStatus,
  notes?: string | null,
): Promise<void> {
  const resp = await fetch(`/api/projects/${projectId}/readiness/${checkCode}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ well_project: wellProject, status, notes: notes ?? null }),
  });
  if (!resp.ok) await throwApiError(resp, `Failed to update ${checkCode} status`);
}

// ── Team lenses (Phase 3) ──────────────────────────────────────────────────

/** Where a well's value comes from: its own entry, its field project's
 *  (inherited), or the status set's default. */
export type CheckSource = "well" | "project" | "default";

export interface EffectiveCheckState extends CheckState {
  source: CheckSource;
  /** The field project's tags a well inherits; effective = inherited ∪ own. */
  inherited_tags?: string[];
}

export interface TeamProjectRow {
  well_project: string;
  activity_count: number;
  checks: Record<CheckCode, CheckState>;
  /** Earliest start of not-done, readiness-required work (null: nothing left). */
  focus_start?: string | null;
  /** Days from the server's today to `focus_start`. */
  focus_in_days?: number | null;
  figures?: RowFigures;
}

export interface TeamWellRow {
  /** "" = a well with no field project. */
  well_project: string;
  well_name: string;
  activity_type: string;
  /** >1: several activities share this project + well + activity type, and so
   *  share its readiness (e.g. two workovers) — the grid warns. */
  activity_count: number;
  location: string | null;
  start_date: string;
  focus_start: string | null;
  /** Days from the server's today to `focus_start`. */
  focus_in_days?: number | null;
  /** Every team check's effective value. */
  checks: Record<CheckCode, EffectiveCheckState>;
  figures?: RowFigures;
}

export interface TeamReadiness {
  team: CatalogTeam;
  checks: CatalogCheck[];
  project_rows: TeamProjectRow[];
  well_rows: TeamWellRow[];
  /** Plan lock — freezes only checks that lock with the plan. */
  locked: boolean;
}

/** A readiness target: a field project, or one well (project + well + activity
 *  type). Names go in the request BODY, never the URL path (ticket DS-001). */
export type ReadinessTarget =
  | { scope: "project"; well_project: string }
  | { scope: "well"; well_project: string; well_name: string; activity_type: string };

export async function getTeamReadiness(projectId: string, teamCode: string): Promise<TeamReadiness> {
  const resp = await fetch(
    `/api/projects/${projectId}/readiness/teams/${encodeURIComponent(teamCode)}`,
    { headers: await authHeaders() },
  );
  if (!resp.ok) await throwApiError(resp, "Failed to fetch readiness data");
  return resp.json();
}

/** Set one check for a field project or a well. `tags` (checks with a tag list)
 *  replaces the entry's own tags; omit it to leave them unchanged. */
export async function setReadiness(
  projectId: string,
  checkCode: CheckCode,
  target: ReadinessTarget,
  status: CheckStatus,
  notes?: string | null,
  tags?: string[],
): Promise<void> {
  const resp = await fetch(`/api/projects/${projectId}/readiness/${encodeURIComponent(checkCode)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({
      ...target,
      status,
      notes: notes ?? null,
      ...(tags !== undefined ? { tags } : {}),
    }),
  });
  if (!resp.ok) await throwApiError(resp, `Failed to update ${checkCode} status`);
}

/** "Reset to project": drop a well's own value so it follows its field project. */
export async function resetWellReadiness(
  projectId: string,
  checkCode: CheckCode,
  target: Extract<ReadinessTarget, { scope: "well" }>,
): Promise<void> {
  const resp = await fetch(
    `/api/projects/${projectId}/readiness/${encodeURIComponent(checkCode)}/reset`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify(target),
    },
  );
  if (!resp.ok) await throwApiError(resp, `Failed to reset ${checkCode}`);
}
