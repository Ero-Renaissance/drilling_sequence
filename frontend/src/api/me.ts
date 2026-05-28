import { getAccessToken } from "@/lib/auth";

export interface PendingApproval {
  revision_id: string;
  project_id: string;
  project_name: string;
  rev_number: number;
  label: string | null;
  created_at: string;
}

async function authHeaders(): Promise<HeadersInit> {
  const token = await getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function getPendingApprovals(): Promise<PendingApproval[]> {
  const resp = await fetch("/api/me/pending-approvals", {
    headers: await authHeaders(),
  });
  if (!resp.ok) throw new Error("Failed to fetch pending approvals");
  return resp.json();
}
