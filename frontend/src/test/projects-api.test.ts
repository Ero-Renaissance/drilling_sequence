import { describe, it, expect } from "vitest";
import { projectsApi } from "@/api/projects";
import { mockProject } from "./mocks/handlers";

// Silence the getAccessToken call in test environment
vi.mock("@/lib/auth", () => ({
  getAccessToken: async () => "test-token",
  msalInstance: { getAllAccounts: () => [], logoutRedirect: vi.fn() },
  loginRequest: {},
}));

describe("projectsApi", () => {
  it("list() returns an array of projects", async () => {
    const projects = await projectsApi.list();
    expect(projects).toHaveLength(1);
    expect(projects[0].name).toBe("North Sea Campaign");
  });

  it("create() returns the new project", async () => {
    const project = await projectsApi.create({ name: "Test Campaign", field: "Agbami" });
    expect(project.name).toBe("Test Campaign");
    expect(project.field).toBe("Agbami");
  });

  it("archive() resolves without error", async () => {
    await expect(projectsApi.archive(mockProject.id)).resolves.toBeUndefined();
  });
});
