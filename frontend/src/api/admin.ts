import type { AdminUser } from "@/types";
import type { CatalogCheck, CatalogTeam, ReadinessCatalog, TagItem } from "./readiness";
import { api } from "./client";

export interface AdminCatalogTeam extends CatalogTeam {
  is_active: boolean;
}

export interface AdminCatalogCheck extends CatalogCheck {
  retired_at: string | null;
}

export interface AdminTagItem extends TagItem {
  retired_at: string | null;
}

/** The full catalog (incl. inactive teams and retired checks) plus the
 *  code-defined allow-lists the admin forms pick from. */
export interface AdminReadinessCatalog {
  teams: AdminCatalogTeam[];
  checks: AdminCatalogCheck[];
  status_sets: ReadinessCatalog["status_sets"];
  icon_keys: string[];
  /** Code-defined tag lists a check may carry (e.g. "equipment"). */
  tag_lists?: string[];
  /** Every item of every tag list, retired included. */
  tag_items?: AdminTagItem[];
}

export interface TagItemCreate {
  tag_list: string;
  code: string;
  label: string;
  category?: string;
  sort_order?: number;
}

/** Only label, category and order are editable — the code is fixed. */
export type TagItemUpdate = Partial<Pick<AdminTagItem, "label" | "category" | "sort_order">>;

export interface TeamCreate {
  code: string;
  name: string;
  icon_key: string;
  sort_order?: number;
}

export type TeamUpdate = Partial<Pick<AdminCatalogTeam, "name" | "icon_key" | "sort_order" | "is_active">>;

export interface CheckCreate {
  code: string;
  label: string;
  team_code: string;
  applies_project: boolean;
  applies_well: boolean;
  status_set: string;
  icon_key: string;
  locks_with_plan: boolean;
  sort_order?: number;
  /** "" or a code-defined tag list. */
  tag_list?: string;
}

/** Only label, icon and order are editable — the rest is fixed at creation. */
export type CheckUpdate = Partial<Pick<AdminCatalogCheck, "label" | "icon_key" | "sort_order">>;

export const adminApi = {
  listUsers: () => api.get<AdminUser[]>("/api/admin/users"),
  setAdmin: (userId: string, isAdmin: boolean) =>
    api.patch<AdminUser>(`/api/admin/users/${userId}`, { is_admin: isAdmin }),
  setCanPlan: (userId: string, canPlan: boolean) =>
    api.patch<AdminUser>(`/api/admin/users/${userId}`, { can_plan: canPlan }),
  /** Replace the user's global readiness team grants with `teams`. */
  setTeams: (userId: string, teams: string[]) =>
    api.put<{ teams: string[] }>(`/api/admin/users/${userId}/teams`, { teams }),

  readinessCatalog: () => api.get<AdminReadinessCatalog>("/api/admin/readiness/catalog"),
  createTeam: (body: TeamCreate) => api.post<AdminCatalogTeam>("/api/admin/readiness/teams", body),
  updateTeam: (code: string, body: TeamUpdate) =>
    api.patch<AdminCatalogTeam>(`/api/admin/readiness/teams/${encodeURIComponent(code)}`, body),
  createCheck: (body: CheckCreate) =>
    api.post<AdminCatalogCheck>("/api/admin/readiness/checks", body),
  updateCheck: (code: string, body: CheckUpdate) =>
    api.patch<AdminCatalogCheck>(`/api/admin/readiness/checks/${encodeURIComponent(code)}`, body),
  retireCheck: (code: string) =>
    api.post<AdminCatalogCheck>(`/api/admin/readiness/checks/${encodeURIComponent(code)}/retire`, {}),
  restoreCheck: (code: string) =>
    api.post<AdminCatalogCheck>(`/api/admin/readiness/checks/${encodeURIComponent(code)}/restore`, {}),

  createTag: (body: TagItemCreate) => api.post<AdminTagItem>("/api/admin/readiness/tags", body),
  updateTag: (tagList: string, code: string, body: TagItemUpdate) =>
    api.patch<AdminTagItem>(
      `/api/admin/readiness/tags/${encodeURIComponent(tagList)}/${encodeURIComponent(code)}`,
      body,
    ),
  retireTag: (tagList: string, code: string) =>
    api.post<AdminTagItem>(
      `/api/admin/readiness/tags/${encodeURIComponent(tagList)}/${encodeURIComponent(code)}/retire`,
      {},
    ),
  restoreTag: (tagList: string, code: string) =>
    api.post<AdminTagItem>(
      `/api/admin/readiness/tags/${encodeURIComponent(tagList)}/${encodeURIComponent(code)}/restore`,
      {},
    ),
};
