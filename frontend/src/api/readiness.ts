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
  // "availability" status set — history only since phase 6 (Nominated
  // Equipment withdrawn, spec §3.5): past revisions still render it.
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
  /** "" = none; else the tag list it carried ("equipment"). Tag lists are history
   *  only since phase 6 (spec §3.5): kept so frozen catalogs read as recorded,
   *  never set on a new check. Optional for definitions frozen before them. */
  tag_list?: string;
  /** The group the check belongs to within its team (phase 7, spec §3.9, §4.5):
   *  "Vessels", "Barges"… — admin-edited free text, grouped by exact text. ""
   *  = none: a core check, drawn on its own. A check that locks with the plan (a
   *  Project gate) never takes one. Optional: definitions frozen before
   *  migration 039 don't carry it, and read as "" (lib/readiness-categories). */
  category?: string;
  /** False when the check "starts unticked" (phase 7, spec §3.9): it applies
   *  nowhere until a team ticks it, and a target with no tick of its own (nor
   *  one to follow) is NOT SELECTED — it carries nothing. Fixed at creation;
   *  always true for a check that locks with the plan. Optional: a definition
   *  without it starts ticked, as every check did before migration 039. */
  applies_by_default?: boolean;
}

/** One code-defined status set, as the catalog serves it. */
export interface StatusSet {
  statuses: { status: string; severity: Severity }[];
  default: string;
  /** Kept only so past revisions render (`availability`, spec §3.3) — refused
   *  for a new check, so the admin form doesn't offer it. */
  history_only: boolean;
}

export interface ReadinessCatalog {
  teams: CatalogTeam[];
  checks: CatalogCheck[];
  status_sets: Record<string, StatusSet>;
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
/** One row's readiness by the server's rollup (spec §3.7) — each row is one
 *  target. Grids add the counts of the rows they show; they never decide which
 *  cells count. */
export interface RowFigures {
  /** Cells that count (N/A, or a team check that doesn't apply, doesn't). A
   *  check that is NOT SELECTED (phase 7, spec §3.9) is in no figure at all. */
  counted: number;
  done: number;
  /** On track (On Track, Pending). */
  in_progress: number;
  /** Behind or Not available. */
  behind: number;
  /** Not counted (N/A, or a team check that doesn't apply because of a row). A
   *  not-selected check isn't counted here either: it carries nothing. */
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

/**
 * One cell of a team's rows (phase 6, spec §5.1 "Cells"). `status` is the status
 * underneath, which re-ticking brings back; `applies` says whether the check
 * applies to this target at all (§3.8). A check that locks with the plan — a
 * Project gate — always reads `applies: true` from `"default"`: it uses N/A.
 * Whether a cell is SHOWN is decided by `applies()` in check-meta, never here.
 * Phase 7 (§3.9): `applies: false` from `"default"` is a check that starts
 * unticked and is NOT SELECTED here (`notSelected()` in check-meta) — it carries
 * nothing; every other `applies: false` is "Not applicable" (a row says so).
 */
export interface TeamCheckState extends CheckState {
  applies: boolean;
  /** Where the tick comes from: the well's own choice ("set on this well"), its
   *  field project's, or the check's default (`applies_by_default`). */
  applies_source: CheckSource;
}

/** A well's cell: `source` says where the STATUS comes from (`applies_source`
 *  says where the tick does — the two inherit separately, §3.8). */
export interface EffectiveCheckState extends TeamCheckState {
  source: CheckSource;
}

export interface TeamProjectRow {
  well_project: string;
  activity_count: number;
  checks: Record<CheckCode, TeamCheckState>;
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

/** Set one check for a field project or a well. A team check never takes N/A
 *  (422 — untick it instead), and a team check that doesn't apply to the target
 *  takes no status (409 — tick it first); spec §5.1. */
export async function setReadiness(
  projectId: string,
  checkCode: CheckCode,
  target: ReadinessTarget,
  status: CheckStatus,
  notes?: string | null,
): Promise<void> {
  const resp = await fetch(`/api/projects/${projectId}/readiness/${encodeURIComponent(checkCode)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ ...target, status, notes: notes ?? null }),
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

// ── Checks that apply (phase 6, spec §3.8) ──────────────────────────────────

/**
 * Which of a team's checks apply to one target — the body of the applicability
 * PUT. Only the listed codes change (1–50), so a client with a stale catalog
 * can't untick a check it doesn't know about.
 * - Field project: `true` applies, `false` doesn't. The server stores a row only
 *   where the value differs from the check's default (`applies_by_default`), so
 *   writing the default removes it (phase 7). No `null`: a field project has
 *   nothing to follow (422).
 * - Well: `true` / `false` are the well's own choice — stored only while it
 *   differs from its field project's; `null` is **Follow project**.
 * Names travel in the BODY, never the URL path (ticket DS-001).
 */
export type ApplicabilityUpdate =
  | { scope: "project"; well_project: string; applies: Record<CheckCode, boolean> }
  | {
      scope: "well";
      /** "" = a well with no field project. */
      well_project: string;
      well_name: string;
      activity_type: string;
      applies: Record<CheckCode, boolean | null>;
    };

/** The target's new rows, built exactly as the team read builds them: a field
 *  project's row plus every well row under it (they follow it), or the one well
 *  row. The picker redraws from it; other open views refetch. */
export interface ApplicabilityResult {
  project_rows: TeamProjectRow[];
  well_rows: TeamWellRow[];
}

/**
 * Tick or untick a team's checks for one target, in one all-or-nothing request.
 * Not for the Projects team: the Project gates use N/A (422). Who may write is
 * who may write the check — the team's grantees and admins (403 otherwise); a
 * tick is never frozen with the plan, so there is no 423.
 */
export async function setApplicability(
  projectId: string,
  teamCode: string,
  body: ApplicabilityUpdate,
): Promise<ApplicabilityResult> {
  const resp = await fetch(
    `/api/projects/${projectId}/readiness/teams/${encodeURIComponent(teamCode)}/applicability`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify(body),
    },
  );
  if (!resp.ok) await throwApiError(resp, "Failed to update which checks apply");
  return resp.json();
}
