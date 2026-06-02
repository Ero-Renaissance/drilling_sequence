import { getAccessToken } from "@/lib/auth";

export interface Signature {
  id: string;
  user_id: string | null;
  user_name: string | null;
  role_label: string;
  signed_at: string;
}

export interface ApproverSignStatus {
  email: string;
  name: string | null;
  role_label: string;
  signed: boolean;
  signed_at: string | null;
  signer_name: string | null;
}

export type RevisionStatus =
  | "pending_review"
  | "pending_approval"
  | "approved"
  | "discarded"
  | "rejected"
  | "changes_requested";

export interface Revision {
  id: string;
  project_id: string;
  rev_number: number;
  label: string | null;
  status: RevisionStatus;
  /** "review" while pending_review, else "approval". */
  stage: "review" | "approval";
  /** True when this revision was routed through the technical-review stage. */
  review_required: boolean;
  /** True when review was available (optional policy) but the planner skipped it. */
  review_skipped: boolean;
  created_by_name: string | null;
  created_at: string;
  signatures: Signature[];
  approver_status: ApproverSignStatus[];
  reviewer_status: ApproverSignStatus[];
  decision_reason: string | null;
  decision_by_name: string | null;
  decision_at: string | null;
  /** SHA-256 fingerprint of the immutable content — printed as the "Document ID". */
  integrity_digest: string;
}

export interface RevisionDetail extends Revision {
  snapshot_json: string;
}

async function authHeaders(): Promise<HeadersInit> {
  const token = await getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function listRevisions(projectId: string): Promise<Revision[]> {
  const resp = await fetch(`/api/projects/${projectId}/revisions`, {
    headers: await authHeaders(),
  });
  if (!resp.ok) throw new Error("Failed to fetch revisions");
  return resp.json();
}

export async function createRevision(
  projectId: string,
  label?: string,
  requestReview?: boolean,
): Promise<Revision> {
  const resp = await fetch(`/api/projects/${projectId}/revisions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({
      label: label ?? null,
      ...(requestReview === undefined ? {} : { request_review: requestReview }),
    }),
  });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({ detail: resp.statusText }));
    const msg = typeof body.detail === "string" ? body.detail : (body.detail?.message ?? "Failed to create revision");
    throw new Error(msg);
  }
  return resp.json();
}

export async function getRevision(
  projectId: string,
  revisionId: string,
): Promise<RevisionDetail> {
  const resp = await fetch(`/api/projects/${projectId}/revisions/${revisionId}`, {
    headers: await authHeaders(),
  });
  if (!resp.ok) throw new Error("Revision not found");
  return resp.json();
}

export async function signRevision(
  projectId: string,
  revisionId: string,
  roleLabel = "Approver",
): Promise<Revision> {
  const resp = await fetch(
    `/api/projects/${projectId}/revisions/${revisionId}/sign`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify({ role_label: roleLabel }),
    },
  );
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({ detail: resp.statusText }));
    const msg = typeof body.detail === "string" ? body.detail : "Failed to sign revision";
    throw new Error(msg);
  }
  return resp.json();
}

export async function signReview(
  projectId: string,
  revisionId: string,
  roleLabel = "Reviewer",
): Promise<Revision> {
  const resp = await fetch(
    `/api/projects/${projectId}/revisions/${revisionId}/sign-review`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify({ role_label: roleLabel }),
    },
  );
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({ detail: resp.statusText }));
    const msg = typeof body.detail === "string" ? body.detail : "Failed to sign off review";
    throw new Error(msg);
  }
  return resp.json();
}

export async function reviewRequestChanges(
  projectId: string,
  revisionId: string,
  reason: string,
): Promise<Revision> {
  const resp = await fetch(
    `/api/projects/${projectId}/revisions/${revisionId}/review-changes`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify({ reason }),
    },
  );
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({ detail: resp.statusText }));
    const msg = typeof body.detail === "string" ? body.detail : "Failed to request changes";
    throw new Error(msg);
  }
  return resp.json();
}

export async function discardRevision(
  projectId: string,
  revisionId: string,
): Promise<void> {
  const resp = await fetch(
    `/api/projects/${projectId}/revisions/${revisionId}`,
    {
      method: "DELETE",
      headers: await authHeaders(),
    },
  );
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({ detail: resp.statusText }));
    const msg = typeof body.detail === "string" ? body.detail : "Failed to discard revision";
    throw new Error(msg);
  }
}

async function decideRevision(
  projectId: string,
  revisionId: string,
  action: "reject" | "request-changes",
  reason: string,
): Promise<Revision> {
  const resp = await fetch(
    `/api/projects/${projectId}/revisions/${revisionId}/${action}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify({ reason }),
    },
  );
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({ detail: resp.statusText }));
    const msg = typeof body.detail === "string" ? body.detail : "Failed to update revision";
    throw new Error(msg);
  }
  return resp.json();
}

export function rejectRevision(
  projectId: string,
  revisionId: string,
  reason: string,
): Promise<Revision> {
  return decideRevision(projectId, revisionId, "reject", reason);
}

export function requestChanges(
  projectId: string,
  revisionId: string,
  reason: string,
): Promise<Revision> {
  return decideRevision(projectId, revisionId, "request-changes", reason);
}
