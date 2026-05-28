import type { Project, ProjectClone, ProjectCreate, ProjectUpdate } from "@/types";
import { api } from "./client";

export const projectsApi = {
  list: () => api.get<Project[]>("/api/projects"),
  get: (id: string) => api.get<Project>(`/api/projects/${id}`),
  create: (payload: ProjectCreate) => api.post<Project>("/api/projects", payload),
  clone: (id: string, payload: ProjectClone) =>
    api.post<Project>(`/api/projects/${id}/clone`, payload),
  update: (id: string, payload: ProjectUpdate) =>
    api.patch<Project>(`/api/projects/${id}`, payload),
  archive: (id: string) => api.delete(`/api/projects/${id}`),
};
