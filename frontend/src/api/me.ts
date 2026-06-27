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

export interface GateBreakdown {
  code: string;
  completed: number;
  on_track: number;
  behind: number;
  na: number;
}

export interface LastApprovedKPIs {
  activities_total: number;
  schedule_start: string | null;
  schedule_end: string | null;
  readiness_pct: number | null;
  readiness_focus_count: number;
  rigs_in_use: number;
  contracts_at_risk: number;
  by_gate: GateBreakdown[];
}

/** Home KPIs of the caller's most-recently-approved revision (snapshot-derived). */
export interface LastApprovedDashboard {
  available: boolean;
  project_id: string | null;
  project_name: string | null;
  rev_number: number | null;
  rev_label: string | null;
  approved_at: string | null;
  approved_by: string | null;
  kpis: LastApprovedKPIs | null;
}

export async function getLastApprovedDashboard(): Promise<LastApprovedDashboard> {
  const resp = await fetch("/api/me/last-approved-dashboard", {
    headers: await authHeaders(),
  });
  if (!resp.ok) throw new Error("Failed to fetch the home dashboard");
  return resp.json();
}
