export type ProjectStatus = "active" | "archived";
export type ProjectRole = "planner" | "reviewer" | "approver" | "viewer";

export interface User {
  id: string;
  name: string;
  email: string;
  is_admin: boolean;
}

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  is_admin: boolean;
  project_count: number;
}

export interface ProjectMember {
  user_id: string;
  role: ProjectRole;
  user_name: string;
  user_email: string;
}

export type ReviewPolicy = "required" | "optional" | "off";

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
  /** Plan-lock summary — populated only by the detail endpoint (GET /projects/:id). */
  lock?: ProjectLock | null;
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
