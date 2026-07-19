export type ProjectStatus = "active" | "archived";
export type ProjectRole = "planner" | "reviewer" | "approver" | "viewer";

export interface User {
  id: string;
  name: string;
  email: string;
  is_admin: boolean;
  /** Global planner grant — may create campaigns / hold the planner role. */
  can_plan: boolean;
}

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  is_admin: boolean;
  /** Global planner grant — may create campaigns / hold the planner role. */
  can_plan: boolean;
  project_count: number;
  /** Admin granted by the email allowlist — can't be revoked from the admin page. */
  admin_via_allowlist: boolean;
}

export interface ProjectMember {
  user_id: string;
  role: ProjectRole;
  user_name: string;
  user_email: string;
}

export type ReviewPolicy = "required" | "optional" | "off";

export interface ProjectApprovalSummary {
  /** Latest revision's status; "draft" = no revisions yet. */
  status: string;
  rev_number: number | null;
  rev_label: string | null;
  /** Approval-stage signatures landed / designated approvers. */
  signed: number;
  approvers: number;
  /** What the current viewer can do about the pending revision (server-gated,
   *  never the creator) — drives the "awaiting your support" banner. */
  your_action?: "review" | "approve" | null;
}

export interface ProjectKeyNotes {
  body: string;
  updated_at: string | null;
  updated_by_name: string | null;
}

export interface ProjectLock {
  locked: boolean;
  /** Why it's frozen: "pending" (in review/approval) or "approved" (revise to edit). */
  reason: "pending" | "approved" | null;
  revision_id: string | null;
  rev_number: number | null;
  rev_label: string | null;
}

export interface Project {
  id: string;
  name: string;
  field: string | null;
  region: string | null;
  status: ProjectStatus;
  review_policy: ReviewPolicy;
  created_by: string;
  created_at: string;
  members: ProjectMember[];
  /** Set when this project was cloned from another (the previous quarter). */
  cloned_from_project_id: string | null;
  /** Source campaign's name — list endpoint only ("Cloned from Q1 …"). */
  cloned_from_name?: string | null;
  /** Plan-lock summary — populated only by the detail endpoint (GET /projects/:id). */
  lock?: ProjectLock | null;
  /** Plan state for the header chip (detail endpoint only). */
  approval?: ProjectApprovalSummary | null;
  /** The planner's campaign bulletin (detail endpoint only). */
  key_notes?: ProjectKeyNotes | null;
}

export interface ProjectCreate {
  name: string;
  field?: string;
  region?: string;
}

export interface ProjectClone {
  name: string;
  field?: string;
  region?: string;
}

export interface ProjectUpdate {
  name?: string;
  field?: string;
  region?: string;
  status?: ProjectStatus;
  review_policy?: ReviewPolicy;
}

export interface ApiError {
  detail: string;
}
