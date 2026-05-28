import { getAccessToken } from "@/lib/auth";

export const CHECK_CODES = ["BUD", "LLI", "LOC", "FID", "EIA", "FLOOD", "SUBS", "CON"] as const;
export type CheckCode = (typeof CHECK_CODES)[number];
export type CheckStatus = "Not Started" | "In Progress" | "Completed" | "Behind" | "N/A";

export interface CheckState {
  status: CheckStatus;
  notes: string | null;
  updated_at: string | null;
}

export interface ActivityReadiness {
  activity_id: string;
  activity_type: string;
  well_name: string | null;
  rig_name: string | null;
  start_date: string;
  end_date: string;
  checks: Record<CheckCode, CheckState>;
}

async function authHeaders(): Promise<HeadersInit> {
  const token = await getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function listReadiness(projectId: string): Promise<ActivityReadiness[]> {
  const resp = await fetch(`/api/projects/${projectId}/readiness`, {
    headers: await authHeaders(),
  });
  if (!resp.ok) throw new Error("Failed to fetch readiness data");
  return resp.json();
}

export async function upsertCheck(
  projectId: string,
  activityId: string,
  checkCode: CheckCode,
  status: CheckStatus,
  notes?: string | null,
): Promise<void> {
  const resp = await fetch(
    `/api/projects/${projectId}/activities/${activityId}/readiness/${checkCode}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify({ status, notes: notes ?? null }),
    },
  );
  if (!resp.ok) throw new Error(`Failed to update ${checkCode} status`);
}
