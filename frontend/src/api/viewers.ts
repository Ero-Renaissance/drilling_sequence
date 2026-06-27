import { getAccessToken } from "@/lib/auth";
import { throwApiError } from "./http";

export interface Viewer {
  user_id: string;
  user_name: string;
  last_seen_at: string;
}

async function authHeaders(): Promise<HeadersInit> {
  const token = await getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function getViewers(projectId: string): Promise<Viewer[]> {
  const resp = await fetch(`/api/projects/${projectId}/viewers`, {
    headers: await authHeaders(),
  });
  if (!resp.ok) await throwApiError(resp, "Failed to fetch viewers");
  return resp.json();
}
