import { getAccessToken } from "@/lib/auth";
import { throwApiError } from "./http";

/** One PHYSICAL unit (rig or HWU) in a campaign's fleet registry.
 *  Rig identity is (terrain, name); HWU identity is (name) — terrain "" (mobile).
 *  `is_placeholder` marks a planned-but-unprocured slot (e.g. "10K Rig 3" known
 *  only by capability class) — cleared by rename-on-award. */
export interface ResourceRecord {
  id: string;
  project_id: string;
  kind: "rig" | "hwu";
  terrain: string; // "" = not terrain-bound (HWUs / unassigned)
  name: string;
  capability_class: string | null;
  is_placeholder: boolean;
  updated_at: string;
}

export interface ResourceUpdate {
  capability_class?: string | null;
  is_placeholder?: boolean;
}

async function authHeaders(): Promise<HeadersInit> {
  const token = await getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function listResources(projectId: string): Promise<ResourceRecord[]> {
  const resp = await fetch(`/api/projects/${projectId}/resources`, {
    headers: await authHeaders(),
  });
  if (!resp.ok) await throwApiError(resp, "Failed to fetch the fleet registry");
  return resp.json();
}

export async function updateResource(
  projectId: string,
  resourceId: string,
  payload: ResourceUpdate,
): Promise<ResourceRecord> {
  const resp = await fetch(`/api/projects/${projectId}/resources/${resourceId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) await throwApiError(resp, "Failed to update the unit");
  return resp.json();
}

/** Rename-on-award: a slot's name matures into the contracted unit's real name.
 *  Audited server-side; moves the lane's activities and contract along. */
export async function renameResource(
  projectId: string,
  resourceId: string,
  newName: string,
): Promise<ResourceRecord> {
  const resp = await fetch(`/api/projects/${projectId}/resources/${resourceId}/rename`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ new_name: newName }),
  });
  if (!resp.ok) await throwApiError(resp, "Failed to rename the unit");
  return resp.json();
}
