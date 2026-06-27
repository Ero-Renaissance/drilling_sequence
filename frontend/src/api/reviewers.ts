import { getAccessToken } from "@/lib/auth";
import { throwApiError } from "./http";
import type { Approver } from "./approvers";

// Reviewers share the Approver shape — they're the same entity (ProjectApprover)
// with a different kind. Re-exported for symmetry at the call sites.
export type Reviewer = Approver;

async function authHeaders(): Promise<HeadersInit> {
  const token = await getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function listReviewers(projectId: string): Promise<Reviewer[]> {
  const resp = await fetch(`/api/projects/${projectId}/reviewers`, {
    headers: await authHeaders(),
  });
  if (!resp.ok) await throwApiError(resp, "Failed to fetch reviewers");
  return resp.json();
}

export async function addReviewer(
  projectId: string,
  payload: { email: string; name?: string; role_label?: string },
): Promise<Reviewer> {
  const resp = await fetch(`/api/projects/${projectId}/reviewers`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) await throwApiError(resp, "Failed to add reviewer");
  return resp.json();
}

export async function removeReviewer(
  projectId: string,
  reviewerId: string,
): Promise<void> {
  const resp = await fetch(`/api/projects/${projectId}/reviewers/${reviewerId}`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
  if (!resp.ok) await throwApiError(resp, "Failed to remove reviewer");
}
