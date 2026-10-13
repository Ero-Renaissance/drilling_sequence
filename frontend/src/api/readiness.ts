import { getAccessToken } from "@/lib/auth";
import { throwApiError } from "./http";

/**
 * Readiness checks come from the admin-curated catalog
 * (`GET /api/readiness/catalog`), not a hard-coded list — a code is any catalog
 * code, validated server-side. Statuses stay a code-defined set (the "standard"
 * set below; more sets arrive with later phases).
 */
export type CheckCode = string;
export type CheckStatus = "On Track" | "Completed" | "Behind" | "N/A";
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
}

export interface ReadinessCatalog {
  teams: CatalogTeam[];
  checks: CatalogCheck[];
  status_sets: Record<string, { statuses: { status: string; severity: Severity }[]; default: string }>;
}

export interface CheckState {
  status: CheckStatus;
  notes: string | null;
  updated_at: string | null;
}

/**
 * Readiness gates are tracked per FIELD-DEVELOPMENT PROJECT — the "Project"
 * column (`well_project` on an activity, e.g. "Bonga Phase 3"), NOT per activity.
 * Every activity/well under a field project shares that project's 7 gates. The
 * backend returns one entry per distinct field project in the campaign;
 * activities with no `well_project` are omitted.
 */
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
