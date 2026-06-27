import { getAccessToken } from "@/lib/auth";
import type { ContractStatus } from "@/api/contracts";
import { throwApiError } from "./http";

// HWU contracts share the rig contract's workflow-status vocabulary.
export type { ContractStatus };

export interface HwuContract {
  id: string;
  project_id: string;
  hwu_name: string;
  status: ContractStatus;
  contract_start: string | null;
  contract_end: string | null;
  notes: string | null;
  updated_at: string;
}

export interface HwuContractUpsert {
  status: ContractStatus;
  contract_start: string | null;
  contract_end: string | null;
  notes: string | null;
}

async function authHeaders(): Promise<HeadersInit> {
  const token = await getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function listHwuContracts(projectId: string): Promise<HwuContract[]> {
  const resp = await fetch(`/api/projects/${projectId}/hwu-contracts`, {
    headers: await authHeaders(),
  });
  if (!resp.ok) await throwApiError(resp, "Failed to fetch HWU contracts");
  return resp.json();
}

export async function upsertHwuContract(
  projectId: string,
  hwuName: string,
  payload: HwuContractUpsert,
): Promise<HwuContract> {
  const resp = await fetch(
    `/api/projects/${projectId}/hwu-contracts/${encodeURIComponent(hwuName)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify(payload),
    },
  );
  if (!resp.ok) await throwApiError(resp, "Failed to save HWU contract");
  return resp.json();
}

export async function deleteHwuContract(projectId: string, hwuName: string): Promise<void> {
  const resp = await fetch(
    `/api/projects/${projectId}/hwu-contracts/${encodeURIComponent(hwuName)}`,
    {
      method: "DELETE",
      headers: await authHeaders(),
    },
  );
  if (!resp.ok && resp.status !== 404) {
    await throwApiError(resp, "Failed to delete HWU contract");
  }
}
