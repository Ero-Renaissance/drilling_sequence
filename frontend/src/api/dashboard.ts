import { getAccessToken } from "@/lib/auth";
import { throwApiError } from "./http";

export interface RigDetail {
  rig: string;
  busy_days: number;
  idle_days: number;
}

export interface GateBreakdown {
  code: string;
  completed: number;
  on_track: number;
  behind: number;
  na: number;
}

export interface DashboardResponse {
  generated_at: string;
  plan: { start: string | null; end: string | null };
  activities: {
    total: number;
    completed_this_quarter: number;
    completed_ytd: number;
    overdue: number;
    starting_soon: number;
    by_plan_type: Record<string, number>;
    by_activity_type: Record<string, number>;
  };
  readiness: {
    focus_count: number;
    overall_pct: number | null;
    behind_cells: number;
    ready: number;
    by_gate: GateBreakdown[];
  };
  rigs: {
    /** Fleet demand over the plan window, kind × procurement — disjoint counts.
     *  "In use" = procured units with live work; "planned" = registry
     *  placeholder slots (no awarded unit yet) with live work. */
    in_use: number;
    hwus_in_use: number;
    planned_rigs: number;
    planned_hwus: number;
    conflicts: number;
    total_idle_days: number;
    per_rig: RigDetail[];
  };
  contracts: {
    expired: number;
    critical: number;
    soon: number;
    healthy: number;
    activities_past_contract: number;
  };
  approval: {
    current_status: string;
    signed: number;
    approvers: number;
    pending_days: number | null;
    drift_since_approved: number | null;
  };
  risk: { flood: number; flood_near_term: number };
  watchlist: {
    near_term_not_ready: number;
    overdue: number;
    past_contract: number;
    contracts_expiring: number;
    flood_risk_near_term: number;
    stale_approval: number;
    conflicts: number;
    drift_since_approved: number;
    /** Placeholder units (unprocured slots) with work inside the procurement
     *  lead-time window — "this rig doesn't exist yet, start tendering". */
    unprocured_slots: number;
  };
}

async function authHeaders(): Promise<HeadersInit> {
  const token = await getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function fetchDashboard(projectId: string): Promise<DashboardResponse> {
  const resp = await fetch(`/api/projects/${projectId}/dashboard`, {
    headers: await authHeaders(),
  });
  if (!resp.ok) await throwApiError(resp, "Failed to load dashboard");
  return resp.json();
}
