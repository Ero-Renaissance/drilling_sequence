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
