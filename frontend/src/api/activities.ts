import { getAccessToken } from "@/lib/auth";

export interface Activity {
  id: string;
  project_id: string;
  activity_type: string;
  start_date: string;
  end_date: string;
  well_name: string | null;
  rig_name: string | null;
  project_group: string | null;
  location: string | null;
  readiness_check: string | null;
  readiness_check_status: string | null;
  risk: string | null;
  comment: string | null;
  plan_type: string | null;
  completed_at: string | null;
  updated_at: string;
  updated_by_name: string | null;
  locked_by_revision_id: string | null;
}

export interface ImportResult {
  imported: number;
  replaced: boolean;
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
  project_group?: string | null;
  location?: string | null;
  readiness_check?: string | null;
  readiness_check_status?: string | null;
  risk?: string | null;
  comment?: string | null;
  plan_type?: string | null;
}

export async function listActivities(projectId: string): Promise<Activity[]> {
  const resp = await fetch(`/api/projects/${projectId}/activities`, {
    headers: await authHeaders(),
  });
  if (!resp.ok) throw new Error("Failed to fetch activities");
  return resp.json();
}

export async function createActivity(projectId: string, payload: ActivityCreate): Promise<Activity> {
  const resp = await fetch(`/api/projects/${projectId}/activities`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({ detail: resp.statusText }));
    throw new Error(body.detail ?? "Failed to create activity");
  }
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
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({ detail: resp.statusText }));
    throw new Error(data.detail ?? "Failed to update activity");
  }
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
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({ detail: resp.statusText }));
    throw new Error(body.detail ?? "Failed to update completion");
  }
  return resp.json();
}

export async function deleteActivity(projectId: string, activityId: string): Promise<void> {
  const resp = await fetch(`/api/projects/${projectId}/activities/${activityId}`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
  if (!resp.ok) throw new Error("Failed to delete activity");
}

export async function importActivities(
  projectId: string,
  file: File,
  replace = true,
): Promise<ImportResult> {
  const form = new FormData();
  form.append("file", file);
  const resp = await fetch(
    `/api/projects/${projectId}/activities/import?replace=${replace}`,
    { method: "POST", headers: await authHeaders(), body: form },
  );
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({ detail: resp.statusText }));
    throw new Error(body.detail ?? "Import failed");
  }
  return resp.json();
}

