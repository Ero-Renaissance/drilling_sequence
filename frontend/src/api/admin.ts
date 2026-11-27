import type { AdminUser } from "@/types";
import type { CatalogCheck, CatalogTeam, ReadinessCatalog } from "./readiness";
import { api } from "./client";

export interface AdminCatalogTeam extends CatalogTeam {
  is_active: boolean;
}

export interface AdminCatalogCheck extends CatalogCheck {
  retired_at: string | null;
  /** Retired for good (a history-only status set or a tag list — `NEQ`, spec
   *  §4.4): it can't be restored (409), so the Admin page hides Restore. */
  withdrawn: boolean;
}

/** The full catalog (incl. inactive teams and retired checks) plus the
 *  code-defined allow-lists the admin forms pick from. A status set marked
 *  `history_only` is listed but never offered for a new check. */
export interface AdminReadinessCatalog {
  teams: AdminCatalogTeam[];
  checks: AdminCatalogCheck[];
  status_sets: ReadinessCatalog["status_sets"];
  icon_keys: string[];
}

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
  /** Phase 7 (spec §3.9, §5.1): optional grouping within the team, ≤ 64
   *  characters, trimmed by the server; omitted or "" = none. A check that locks
   *  with the plan takes none (422). */
  category?: string;
  /** False = "starts unticked" — fixed at creation (never on a PATCH). A check
   *  that locks with the plan can't start unticked (422). Omitted = true. */
  applies_by_default?: boolean;
  /** A target may state how many of this type it needs (equipment quantity).
   *  Never on a check that locks with the plan (422). Omitted = false. */
  takes_quantity?: boolean;
}

/** Only label, icon, order, category and "takes a quantity" are editable — the
 *  rest (team, status set, scope, lock behaviour, "starts unticked") is fixed at
 *  creation; the server refuses any other field (422). `category: ""` clears
 *  it; a category — or a quantity — on a check that locks with the plan is
 *  refused (422). */
export type CheckUpdate = Partial<
  Pick<AdminCatalogCheck, "label" | "icon_key" | "sort_order" | "category" | "takes_quantity">
>;

export const adminApi = {
  listUsers: () => api.get<AdminUser[]>("/api/admin/users"),
  setAdmin: (userId: string, isAdmin: boolean) =>
    api.patch<AdminUser>(`/api/admin/users/${userId}`, { is_admin: isAdmin }),
  setCanPlan: (userId: string, canPlan: boolean) =>
    api.patch<AdminUser>(`/api/admin/users/${userId}`, { can_plan: canPlan }),
  /** Block (false) or allow (true) the person's sign-in. */
  setActive: (userId: string, isActive: boolean) =>
    api.patch<AdminUser>(`/api/admin/users/${userId}`, { is_active: isActive }),
  /** Pilot sign-in only: add a person to the list. `username` is the part of
   *  their email before the "@". 409 if already there, or outside pilot mode. */
  addUser: (body: { username: string; name: string }) =>
    api.post<AdminUser>("/api/admin/users", body),
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
};
