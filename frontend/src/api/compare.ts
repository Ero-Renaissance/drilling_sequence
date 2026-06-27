import { getAccessToken } from "@/lib/auth";
import { throwApiError } from "./http";

export interface FieldChange {
  field: string;
  old: string | null;
  new: string | null;
}

export type ChangeKind = "added" | "removed" | "modified";

export type RemovalReason = "completed" | "dropped";

export interface ActivityDiff {
  change: ChangeKind;
  activity_id: string;
  activity_type: string;
  well_name: string | null;
  rig_name: string | null;
  start_date: string | null;
  end_date: string | null;
  fields: FieldChange[];
  /** Only on "removed" rows: why the activity left the schedule. */
  removal_reason: RemovalReason | null;
  /** True when the activity is marked done on the surviving (target) side. */
  completed: boolean;
}

export interface DiffSide {
  kind: "revision" | "live" | "none";
  revision_id: string | null;
  rev_number: number | null;
  label: string | null;
  /** Set when the baseline lives in another project (the clone parent). */
  project_id?: string | null;
}

export interface DiffSummary {
  added: number;
  removed: number;
  modified: number;
  unchanged: number;
  base_count: number;
  target_count: number;
  base_readiness_pct: number | null;
  target_readiness_pct: number | null;
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

export interface ContractDiff {
  resource: string;
  fields: FieldChange[];
}

export interface RevisionDiff {
  base: DiffSide;
  target: DiffSide;
  summary: DiffSummary;
  activities: ActivityDiff[];
  contracts: ContractDiff[];
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
  if (!resp.ok) await throwApiError(resp, "Failed to compare revisions");
  return resp.json();
}

/**
 * Compare this project (the `target` side, e.g. the new quarter) against
 * another project (`baseProjectId`, e.g. last quarter). Each side's ref is a
 * revision id or "live". Activities are matched by lineage carried across
 * clones, so a rig reassigned to another well reads as a modified field.
 */
export async function crossCompareProjects(
  targetProjectId: string,
  baseProjectId: string,
  base: string,
  target: string,
): Promise<RevisionDiff> {
  const token = await getAccessToken();
  const params = new URLSearchParams({ base_project_id: baseProjectId, base, target });
  const resp = await fetch(
    `/api/projects/${targetProjectId}/revisions/cross-compare?${params}`,
    { headers: token ? { Authorization: `Bearer ${token}` } : {} },
  );
  if (!resp.ok) await throwApiError(resp, "Failed to compare schedules");
  return resp.json();
}

/**
 * Diff `target` (a revision id, or "live") against the most recent APPROVED
 * baseline — resolved server-side: this project's last approved revision, else
 * the clone parent's, else none. Powers the approver's "what changed since the
 * last approval" view and the planner's "live vs last approved" pre-submit check.
 */
export async function changesSinceApproved(
  projectId: string,
  target: string = "live",
  baseline: "auto" | "parent" = "auto",
): Promise<RevisionDiff> {
  const token = await getAccessToken();
  const params = new URLSearchParams({ target, baseline });
  const resp = await fetch(
    `/api/projects/${projectId}/revisions/changes-since-approved?${params}`,
    { headers: token ? { Authorization: `Bearer ${token}` } : {} },
  );
  if (!resp.ok) await throwApiError(resp, "Failed to load changes");
  return resp.json();
}
