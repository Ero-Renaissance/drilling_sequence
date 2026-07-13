import { getAccessToken } from "@/lib/auth";
import { throwApiError } from "./http";
import { logger } from "@/lib/logger";

export interface Activity {
  id: string;
  project_id: string;
  activity_type: string;
  start_date: string;
  end_date: string;
  well_name: string | null;
  rig_name: string | null;
  hwu_name?: string | null;
  well_project: string | null;
  project_group: string | null;
  location: string | null;
  risk: string | null;
  comment: string | null;
  plan_type: string | null;
  readiness_required?: boolean;
  completed_at: string | null;
  updated_at: string;
  updated_by_name: string | null;
  locked_by_revision_id: string | null;
}

export interface SkippedRow {
  well: string;
  reason: string;
}

/** A distinct sheet activity-type value the resolver couldn't place — the
 *  mapping dialog offers these to map (or keep as-is). */
export interface UnknownActivityType {
  value: string;
  rows: number;
}

/** A word-level rewrite applied at import (curated alias or manual mapping) —
 *  reported so an import never silently rewrites the sheet. */
export interface AppliedTypeMapping {
  source: string;
  target: string;
  rows: number;
}

export interface ImportResult {
  imported: number;
  replaced: boolean;
  skipped: number;
  skipped_rows: SkippedRow[];
  warnings: string[];
  /** True = preview (dry run): nothing was written. */
  dry_run: boolean;
  unknown_types: UnknownActivityType[];
  applied_mappings: AppliedTypeMapping[];
}

/** Manual activity-type mappings from the dialog: {sheet value → canonical
 *  type}, plus which of those sources to remember as a persistent alias. */
export interface TypeMappingChoice {
  mappings: Record<string, string>;
  remember: string[];
}

async function authHeaders(): Promise<HeadersInit> {
  const token = await getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export interface ActivityCreate {
  activity_type: string;
  start_date: string;
  end_date: string;
  well_name?: string | null;
  rig_name?: string | null;
  hwu_name?: string | null;
  well_project?: string | null;
  project_group?: string | null;
  location?: string | null;
  risk?: string | null;
  comment?: string | null;
  plan_type?: string | null;
  readiness_required?: boolean;
}

export async function listActivities(projectId: string): Promise<Activity[]> {
  const resp = await fetch(`/api/projects/${projectId}/activities`, {
    headers: await authHeaders(),
  });
  if (!resp.ok) await throwApiError(resp, "Failed to fetch activities");
  return resp.json();
}

/** Download the full campaign plan as an Excel workbook (the rig sequence as a
 *  table). Read-only — any authenticated viewer may export. */
export async function exportActivities(projectId: string): Promise<Blob> {
  const resp = await fetch(`/api/projects/${projectId}/activities/export`, {
    headers: await authHeaders(),
  });
  if (!resp.ok) await throwApiError(resp, "Excel export failed");
  return resp.blob();
}

/** The blank, self-documenting import template (.xlsx): sample rows (including
 *  the terrain-twin rig convention), a Guidance sheet with the canonical
 *  vocabularies, and dropdowns on every enum column. */
export async function downloadImportTemplate(projectId: string): Promise<Blob> {
  const resp = await fetch(`/api/projects/${projectId}/activities/import-template`, {
    headers: await authHeaders(),
  });
  if (!resp.ok) await throwApiError(resp, "Template download failed");
  return resp.blob();
}

export async function createActivity(projectId: string, payload: ActivityCreate): Promise<Activity> {
  const resp = await fetch(`/api/projects/${projectId}/activities`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) await throwApiError(resp, "Failed to create activity");
  return resp.json();
}

export class ConflictError extends Error {
  constructor(
    public readonly updatedBy: string,
    public readonly updatedAt: string,
  ) {
    super("conflict");
  }
}

export async function updateActivity(
  projectId: string,
  activityId: string,
  payload: Partial<ActivityCreate>,
  expectedUpdatedAt?: string,
): Promise<Activity> {
  const body = expectedUpdatedAt
    ? { ...payload, expected_updated_at: expectedUpdatedAt }
    : payload;
  const resp = await fetch(`/api/projects/${projectId}/activities/${activityId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(body),
  });
  if (resp.status === 409) {
    const data = await resp.json().catch(() => ({}));
    throw new ConflictError(
      data.detail?.updated_by ?? "Another user",
      data.detail?.updated_at ?? "",
    );
  }
  if (!resp.ok) await throwApiError(resp, "Failed to update activity");
  return resp.json();
}

export async function setActivityCompletion(
  projectId: string,
  activityId: string,
  completed: boolean,
): Promise<Activity> {
  const action = completed ? "complete" : "reopen";
  const resp = await fetch(
    `/api/projects/${projectId}/activities/${activityId}/${action}`,
    { method: "POST", headers: await authHeaders() },
  );
  if (!resp.ok) await throwApiError(resp, "Failed to update completion");
  return resp.json();
}

export async function deleteActivity(projectId: string, activityId: string): Promise<void> {
  const resp = await fetch(`/api/projects/${projectId}/activities/${activityId}`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
  if (!resp.ok) await throwApiError(resp, "Failed to delete activity");
}

export async function importActivities(
  projectId: string,
  file: File,
  replace = true,
  opts: { dryRun?: boolean; mapping?: TypeMappingChoice } = {},
): Promise<ImportResult> {
  const form = new FormData();
  form.append("file", file);
  if (opts.mapping) {
    form.append("mappings", JSON.stringify(opts.mapping.mappings));
    form.append("remember", JSON.stringify(opts.mapping.remember));
  }
  const resp = await fetch(
    `/api/projects/${projectId}/activities/import?replace=${replace}&dry_run=${!!opts.dryRun}`,
    { method: "POST", headers: await authHeaders(), body: form },
  );
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({ detail: resp.statusText }));
    const detail = body.detail;
    // Import is the one wrapper that keeps a bespoke (multi-line) error, so log it
    // here to preserve the "every HTTP failure logs centrally" invariant.
    logger.warn("Activity import rejected", {
      status: resp.status,
      path: typeof window !== "undefined" ? window.location.pathname : undefined,
    });
    // The importer returns a structured detail ({ message, errors: [...] }) on a
    // validation rejection — surface the per-row errors instead of "[object Object]".
    if (detail && typeof detail === "object") {
      const rows: string[] = Array.isArray(detail.errors) ? detail.errors : [];
      const msg = detail.message ?? "Import failed";
      throw new Error(rows.length ? `${msg}\n${rows.map((e) => `• ${e}`).join("\n")}` : msg);
    }
    throw new Error(typeof detail === "string" ? detail : "Import failed");
  }
  return resp.json();
}

