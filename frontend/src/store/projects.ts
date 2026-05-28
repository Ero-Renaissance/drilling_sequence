import { create } from "zustand";
import type { Project, ProjectClone, ProjectCreate, ProjectUpdate } from "@/types";
import { projectsApi } from "@/api/projects";

interface ProjectsState {
  projects: Project[];
  loading: boolean;
  error: string | null;
  fetchProjects: () => Promise<void>;
  createProject: (payload: ProjectCreate) => Promise<Project>;
  cloneProject: (id: string, payload: ProjectClone) => Promise<Project>;
  updateProject: (id: string, payload: ProjectUpdate) => Promise<void>;
  archiveProject: (id: string) => Promise<void>;
}

export const useProjectsStore = create<ProjectsState>((set) => ({
  projects: [],
  loading: false,
  error: null,

  fetchProjects: async () => {
    set({ loading: true, error: null });
    try {
      const projects = await projectsApi.list();
      set({ projects, loading: false });
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
    }
  },

  createProject: async (payload) => {
    const project = await projectsApi.create(payload);
    set((state) => ({ projects: [project, ...state.projects] }));
    return project;
  },

  cloneProject: async (id, payload) => {
    const project = await projectsApi.clone(id, payload);
    set((state) => ({ projects: [project, ...state.projects] }));
    return project;
  },

  updateProject: async (id, payload) => {
    const updated = await projectsApi.update(id, payload);
    set((state) => ({
      projects: state.projects.map((p) => (p.id === id ? updated : p)),
    }));
  },

  archiveProject: async (id) => {
    await projectsApi.archive(id);
    set((state) => ({ projects: state.projects.filter((p) => p.id !== id) }));
  },
}));
