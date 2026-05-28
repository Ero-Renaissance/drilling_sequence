import { getAccessToken } from "@/lib/auth";

export interface Approver {
  id: string;
  project_id: string;
  email: string;
  name: string | null;
  role_label: string;
}

async function authHeaders(): Promise<HeadersInit> {
  const token = await getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function listApprovers(projectId: string): Promise<Approver[]> {
  const resp = await fetch(`/api/projects/${projectId}/approvers`, {
    headers: await authHeaders(),
  });
  if (!resp.ok) throw new Error("Failed to fetch approvers");
  return resp.json();
}

export async function addApprover(
  projectId: string,
  payload: { email: string; name?: string; role_label?: string },
): Promise<Approver> {
  const resp = await fetch(`/api/projects/${projectId}/approvers`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({ detail: resp.statusText }));
    const msg = typeof body.detail === "string" ? body.detail : "Failed to add approver";
    throw new Error(msg);
  }
  return resp.json();
}

export async function removeApprover(
  projectId: string,
  approverId: string,
): Promise<void> {
  const resp = await fetch(`/api/projects/${projectId}/approvers/${approverId}`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
  if (!resp.ok) throw new Error("Failed to remove approver");
}
