import type { Project, ProjectClone, ProjectCreate, ProjectKeyNotes, ProjectUpdate } from "@/types";
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
  addPlanner: (id: string, email: string) =>
    api.post<Project>(`/api/projects/${id}/planners`, { email }),
  removePlanner: (id: string, userId: string) =>
    api.delete(`/api/projects/${id}/planners/${userId}`),
  updateKeyNotes: (id: string, body: string) =>
    api.put<ProjectKeyNotes>(`/api/projects/${id}/key-notes`, { body }),
};
