import { getAccessToken } from "@/lib/auth";
import { throwApiError } from "./http";

export const CHECK_CODES = ["FDP", "LLI", "LOC", "FE", "FID", "EIA", "BUD"] as const;
export type CheckCode = (typeof CHECK_CODES)[number];
export type CheckStatus = "On Track" | "Completed" | "Behind" | "N/A";

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
  checks: Record<CheckCode, CheckState>;
  /** Number of activities under this field project (shown as the row subtitle). */
  activity_count: number;
  /** Frozen while a revision is awaiting approval — the dots are disabled. */
  locked?: boolean;
}

async function authHeaders(): Promise<HeadersInit> {
  const token = await getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function listReadiness(projectId: string): Promise<ProjectReadiness[]> {
  const resp = await fetch(`/api/projects/${projectId}/readiness`, {
    headers: await authHeaders(),
  });
  if (!resp.ok) await throwApiError(resp, "Failed to fetch readiness data");
  return resp.json();
}

/**
 * Set ONE readiness gate for a whole field project. `wellProject` is a plain
 * path segment on the backend and can contain spaces/slashes, so it must be
 * URL-encoded here.
 */
export async function upsertCheck(
  projectId: string,
  wellProject: string,
  checkCode: CheckCode,
  status: CheckStatus,
  notes?: string | null,
): Promise<void> {
  const resp = await fetch(
    `/api/projects/${projectId}/readiness/${encodeURIComponent(wellProject)}/${checkCode}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify({ status, notes: notes ?? null }),
    },
  );
  if (!resp.ok) await throwApiError(resp, `Failed to update ${checkCode} status`);
}
