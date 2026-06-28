import { getAccessToken } from "@/lib/auth";
import { throwApiError } from "./http";

export type ChangeNoteKind = "rig" | "hwu" | "general";

export interface ChangeNote {
  kind: ChangeNoteKind;
  resource_name: string | null;
  body: string;
  /** Absent on notes snapshotted into a revision (only the live notes carry it). */
  updated_at?: string;
}

export interface ChangeNoteUpsert {
  kind: ChangeNoteKind;
  resource_name: string | null;
  body: string;
}

async function authHeaders(): Promise<HeadersInit> {
  const token = await getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function listChangeNotes(projectId: string): Promise<ChangeNote[]> {
  const resp = await fetch(`/api/projects/${projectId}/change-notes`, {
    headers: await authHeaders(),
  });
  if (!resp.ok) await throwApiError(resp, "Failed to load change notes");
  return resp.json();
}

/** Author/replace one resource's note. An empty body deletes it (resolves to null). */
export async function upsertChangeNote(
  projectId: string,
  payload: ChangeNoteUpsert,
): Promise<ChangeNote | null> {
  const resp = await fetch(`/api/projects/${projectId}/change-notes`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) await throwApiError(resp, "Failed to save change note");
  return resp.json();
}
