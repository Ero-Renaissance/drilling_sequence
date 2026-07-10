import { getAccessToken } from "@/lib/auth";
import { throwApiError } from "./http";

export interface RigContract {
  id: string;
  project_id: string;
  rig_name: string;
  /** Which physical rig the contract covers — rig identity is (terrain, name);
   *  "" = unassigned/legacy. */
  terrain: string;
  contract_start: string | null;
  contract_end: string | null;
  notes: string | null;
  updated_at: string;
}

export interface RigContractUpsert {
  /** Required only when the rig name exists in more than one terrain — the
   *  server resolves single-terrain names itself and 409s on ambiguity. */
  terrain?: string | null;
  contract_start: string | null;
  /** A contract IS its end date — the server rejects a date-less upsert;
   *  removing a contract is deleteContract, not a blanked-out save. */
  contract_end: string;
  notes: string | null;
}

async function authHeaders(): Promise<HeadersInit> {
  const token = await getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function listContracts(projectId: string): Promise<RigContract[]> {
  const resp = await fetch(`/api/projects/${projectId}/contracts`, {
    headers: await authHeaders(),
  });
  if (!resp.ok) await throwApiError(resp, "Failed to fetch contracts");
  return resp.json();
}

export async function upsertContract(
  projectId: string,
  rigName: string,
  payload: RigContractUpsert,
): Promise<RigContract> {
  const resp = await fetch(
    `/api/projects/${projectId}/contracts/${encodeURIComponent(rigName)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify(payload),
    },
  );
  if (!resp.ok) await throwApiError(resp, "Failed to save contract");
  return resp.json();
}

export async function deleteContract(
  projectId: string,
  rigName: string,
  /** Which physical rig (rig identity is (terrain, name)) — without it the
   *  server 409s when the name exists in more than one terrain. */
  terrain?: string | null,
): Promise<void> {
  const qs = terrain ? `?terrain=${encodeURIComponent(terrain)}` : "";
  const resp = await fetch(
    `/api/projects/${projectId}/contracts/${encodeURIComponent(rigName)}${qs}`,
    {
      method: "DELETE",
      headers: await authHeaders(),
    },
  );
  if (!resp.ok && resp.status !== 404) {
    await throwApiError(resp, "Failed to delete contract");
  }
}
