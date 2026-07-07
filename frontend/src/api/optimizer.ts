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

export const optimizerApi = {
  run: (payload: {
    demand: DemandRow[];
    assumptions: OptimizerAssumptions;
    options: OptimizerOptions;
  }) => api.post<OptimizationResponse>("/api/optimizer/rig-fleet", payload),

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
