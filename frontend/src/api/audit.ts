import { getAccessToken } from "@/lib/auth";

export interface AuditEntry {
  id: string;
  entity_type?: string;
  entity_id?: string;
  field: string;
  old_value: string | null;
  new_value: string | null;
  user_name: string | null;
  timestamp: string;
}

async function authHeaders(): Promise<HeadersInit> {
  const token = await getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function getActivityHistory(
  projectId: string,
  activityId: string,
): Promise<AuditEntry[]> {
  const resp = await fetch(
    `/api/projects/${projectId}/activities/${activityId}/history`,
    { headers: await authHeaders() },
  );
  if (!resp.ok) throw new Error("Failed to fetch history");
  return resp.json();
}

export async function getProjectAudit(projectId: string): Promise<AuditEntry[]> {
  const resp = await fetch(`/api/projects/${projectId}/audit`, {
    headers: await authHeaders(),
  });
  if (!resp.ok) throw new Error("Failed to fetch project audit log");
  return resp.json();
}
