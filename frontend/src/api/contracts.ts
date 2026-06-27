import { getAccessToken } from "@/lib/auth";
import { throwApiError } from "./http";

export type ContractStatus = "N/A" | "Not Started" | "In Progress" | "Completed";

export const CONTRACT_STATUSES: ContractStatus[] = [
  "N/A",
  "Not Started",
  "In Progress",
  "Completed",
];

export interface RigContract {
  id: string;
  project_id: string;
  rig_name: string;
  status: ContractStatus;
  contract_start: string | null;
  contract_end: string | null;
  notes: string | null;
  updated_at: string;
}

export interface RigContractUpsert {
  status: ContractStatus;
  contract_start: string | null;
  contract_end: string | null;
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

export async function deleteContract(projectId: string, rigName: string): Promise<void> {
  const resp = await fetch(
    `/api/projects/${projectId}/contracts/${encodeURIComponent(rigName)}`,
    {
      method: "DELETE",
      headers: await authHeaders(),
    },
  );
  if (!resp.ok && resp.status !== 404) {
    await throwApiError(resp, "Failed to delete contract");
  }
}
