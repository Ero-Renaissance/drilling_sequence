import { getAccessToken } from "@/lib/auth";

export interface FieldChange {
  field: string;
  old: string | null;
  new: string | null;
}

export type ChangeKind = "added" | "removed" | "modified";

export interface ActivityDiff {
  change: ChangeKind;
  activity_id: string;
  activity_type: string;
  well_name: string | null;
  rig_name: string | null;
  start_date: string | null;
  end_date: string | null;
  fields: FieldChange[];
}

export interface DiffSide {
  kind: "revision" | "live";
  revision_id: string | null;
  rev_number: number | null;
  label: string | null;
}

export interface DiffSummary {
  added: number;
  removed: number;
  modified: number;
  unchanged: number;
  base_start: string | null;
  base_end: string | null;
  target_start: string | null;
  target_end: string | null;
  start_shift_days: number | null;
  end_shift_days: number | null;
  base_duration_days: number | null;
  target_duration_days: number | null;
  duration_shift_days: number | null;
}

export interface RevisionDiff {
  base: DiffSide;
  target: DiffSide;
  summary: DiffSummary;
  activities: ActivityDiff[];
}

/** A diff ref is either a revision id or the literal "live" (working plan). */
export async function compareRevisions(
  projectId: string,
  base: string,
  target: string,
): Promise<RevisionDiff> {
  const token = await getAccessToken();
  const params = new URLSearchParams({ base, target });
  const resp = await fetch(
    `/api/projects/${projectId}/revisions/compare?${params}`,
    { headers: token ? { Authorization: `Bearer ${token}` } : {} },
  );
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({ detail: resp.statusText }));
    const msg = typeof body.detail === "string" ? body.detail : "Failed to compare revisions";
    throw new Error(msg);
  }
  return resp.json();
}
