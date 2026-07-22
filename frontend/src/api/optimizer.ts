import { getAccessToken } from "@/lib/auth";
import { throwApiError } from "./http";
import { api } from "./client";

export type Terrain = "Land" | "Swamp" | "SWO";

export interface OptimizerAssumptions {
  well_duration_days: number;
  inter_well_gap_days: number;
  batch_size: number;
  batch_gap_days: number;
  project_move_days_land: number;
  project_move_days_swamp: number;
  project_move_days_swo: number;
  rig_months_per_year: number;
  /** Per-year COMPLETION cutoff: year → month (1–12) by whose end that year's
   *  last well must be finished drilling. Unlisted years run the full year. */
  last_completion_month_by_year?: Record<number, number>;
}

export interface OptimizerOptions {
  delivery: "finished" | "spudded";
  allow_slip_days: number;
  allow_drill_ahead: boolean;
  batch_reset_on_new_year: boolean;
}

export interface DemandRow {
  terrain: Terrain;
  project: string;
  wells_by_year: Record<string, number>;
  /** Display-only value volumes (oil ~ MMbbl, gas ~ Bscf); the future priority
   *  objective ranks per stream and never converts across them. */
  oil_volume?: number;
  domestic_gas_volume?: number;
  export_gas_volume?: number;
}

export interface ScheduledWell {
  project: string;
  year: number;
  label: string;
  start: string; // ISO date
  end: string;
  gap_before_days: number;
  gap_kind: "none" | "inter_well" | "batch" | "project_move";
}

export interface RigPlan {
  name: string;
  wells: ScheduledWell[];
}

export interface TerrainResult {
  terrain: Terrain;
  feasible: boolean;
  rig_count: number;
  rigs: RigPlan[];
  rigs_active_per_year: Record<string, number>;
  utilization_per_rig: Record<string, number>;
  binding: { project: string; year: number } | null;
  infeasible_wells: { project: string; year: number }[];
}

export interface OptimizationResponse {
  run_id: string;
  engine: "heuristic" | "milp";
  warning: string | null;
  results: TerrainResult[];
}

export interface ParsedSchedule {
  demand: DemandRow[];
  years: number[];
  issues: string[];
}


export interface CreateCampaignPayload {
  name: string;
  field?: string | null;
  region?: string | null;
  default_activity_type: string;
  engine?: string | null;
  results: TerrainResult[];
}

export const optimizerApi = {
  run: (payload: {
    demand: DemandRow[];
    assumptions: OptimizerAssumptions;
    options: OptimizerOptions;
  }) => api.post<OptimizationResponse>("/api/optimizer/rig-fleet", payload),

  createCampaign: (payload: CreateCampaignPayload) =>
    api.post<{ id: string; name: string }>("/api/optimizer/create-campaign", payload),

  /** Excel export of a run — same payload as `run`; returns the workbook blob.
   *  Bypasses the JSON client (binary response) but mirrors its auth + errors. */
  exportExcel: async (payload: {
    demand: DemandRow[];
    assumptions: OptimizerAssumptions;
    options: OptimizerOptions;
  }): Promise<Blob> => {
    const token = await getAccessToken();
    const resp = await fetch("/api/optimizer/rig-fleet/export", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) await throwApiError(resp, "Excel export failed");
    return resp.blob();
  },

  /** Multipart upload — bypasses the JSON client but mirrors its auth + error
   *  handling (token header, server detail surfaced via throwApiError). */
  parseSchedule: async (file: File): Promise<ParsedSchedule> => {
    const token = await getAccessToken();
    const form = new FormData();
    form.append("file", file);
    const resp = await fetch("/api/optimizer/parse-schedule", {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
    if (!resp.ok) await throwApiError(resp, "Could not parse the schedule file");
    return resp.json() as Promise<ParsedSchedule>;
  },
};
