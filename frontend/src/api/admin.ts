import type { AdminUser } from "@/types";
import { api } from "./client";

export const adminApi = {
  listUsers: () => api.get<AdminUser[]>("/api/admin/users"),
  setAdmin: (userId: string, isAdmin: boolean) =>
    api.patch<AdminUser>(`/api/admin/users/${userId}`, { is_admin: isAdmin }),
};
