import { getAccessToken } from "@/lib/auth";
import { throwApiError } from "./http";

/** One entry in a revision's deliberation thread. Org-wide readable; posting
 *  is limited server-side to admins, designated reviewers/approvers and the
 *  campaign's planners, and only while the revision is pending. */
export interface RevisionComment {
  id: string;
  revision_id: string;
  user_id: string | null;
  user_name: string | null;
  /** Capacity held at post time: "Admin" | "Approver" | "Reviewer" | "Planner" */
  author_role: string;
  /** Revision stage at post time: "review" | "approval" */
  stage: string;
  body: string;
  created_at: string;
}

async function authHeaders(): Promise<HeadersInit> {
  const token = await getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function listRevisionComments(
  projectId: string,
  revisionId: string,
): Promise<RevisionComment[]> {
  const resp = await fetch(`/api/projects/${projectId}/revisions/${revisionId}/comments`, {
    headers: await authHeaders(),
  });
  if (!resp.ok) await throwApiError(resp, "Failed to fetch comments");
  return resp.json();
}

export async function addRevisionComment(
  projectId: string,
  revisionId: string,
  body: string,
): Promise<RevisionComment> {
  const resp = await fetch(`/api/projects/${projectId}/revisions/${revisionId}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ body }),
  });
  if (!resp.ok) await throwApiError(resp, "Failed to post comment");
  return resp.json();
}
