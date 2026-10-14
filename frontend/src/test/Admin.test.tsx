import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({
  getAccessToken: async () => "test-token",
  msalInstance: { getAllAccounts: () => [], logoutRedirect: vi.fn() },
  loginRequest: {},
}));

vi.mock("@/store/auth", () => ({
  useAuthStore: (selector: (s: { user: { id: string } }) => unknown) =>
    selector({ user: { id: "me-id" } }),
}));

const listUsers = vi.fn();
const setAdmin = vi.fn();
const setCanPlan = vi.fn();
const setTeams = vi.fn();
const readinessCatalog = vi.fn();
vi.mock("@/api/admin", () => ({
  adminApi: {
    listUsers: () => listUsers(),
    setAdmin: (id: string, isAdmin: boolean) => setAdmin(id, isAdmin),
    setCanPlan: (id: string, canPlan: boolean) => setCanPlan(id, canPlan),
    setTeams: (id: string, teams: string[]) => setTeams(id, teams),
    readinessCatalog: () => readinessCatalog(),
  },
}));

import { Admin } from "@/pages/Admin";
import type { AdminReadinessCatalog } from "@/api/admin";
import { BUILTIN_PROJECT_GATES } from "@/components/readiness/catalog";
import type { AdminUser } from "@/types";

function catalog(withLogistics: boolean): AdminReadinessCatalog {
  return {
    teams: [
      { code: "projects", name: "Projects", editor_source: "planner", icon_key: "land-plot", sort_order: 0, is_active: true },
      ...(withLogistics
        ? [{ code: "logistics", name: "Logistics", editor_source: "team_grant" as const, icon_key: "banknote", sort_order: 20, is_active: true }]
        : []),
    ],
    checks: BUILTIN_PROJECT_GATES.map((c) => ({ ...c, retired_at: null })),
    status_sets: {
      standard: {
        statuses: [
          { status: "On Track", severity: "in_progress" },
          { status: "Completed", severity: "done" },
          { status: "Behind", severity: "blocked" },
          { status: "N/A", severity: "not_counted" },
        ],
        default: "On Track",
      },
    },
    icon_keys: ["land-plot", "banknote"],
  };
}

function user(over: Partial<AdminUser>): AdminUser {
  return {
    id: "u1",
    name: "Ada Lovelace",
    email: "ada@company.com",
    is_admin: false,
    can_plan: false,
    project_count: 0,
    admin_via_allowlist: false,
    ...over,
  };
}

describe("Admin", () => {
  beforeEach(() => {
    listUsers.mockReset();
    setAdmin.mockReset();
    setTeams.mockReset();
    readinessCatalog.mockReset();
    readinessCatalog.mockResolvedValue(catalog(true));
    window.localStorage.clear(); // section fold state is remembered per browser
  });

  it("opens on the users; the readiness configuration starts folded", async () => {
    listUsers.mockResolvedValue([user({})]);
    render(<Admin />);
    await waitFor(() => screen.getByText("Ada Lovelace"));
    expect(screen.getByRole("button", { name: /^users/i })).toHaveAttribute("aria-expanded", "true");
    const checks = await screen.findByRole("button", { name: /readiness checks/i });
    expect(checks).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("region", { name: "Projects checks" })).not.toBeInTheDocument();

    fireEvent.click(checks);
    expect(await screen.findByRole("region", { name: "Projects checks" })).toBeInTheDocument();
  });

  it("marks allowlist admins and disables their revoke button", async () => {
    listUsers.mockResolvedValue([
      user({ id: "a1", name: "Allowed Admin", is_admin: true, admin_via_allowlist: true }),
    ]);
    render(<Admin />);
    await waitFor(() => screen.getByText("Allowed Admin"));

    expect(screen.getByText("via allowlist")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /revoke admin/i })).toBeDisabled();
  });

  it("requires confirmation before granting admin", async () => {
    listUsers.mockResolvedValue([user({})]);
    setAdmin.mockResolvedValue(user({ is_admin: true }));
    render(<Admin />);
    await waitFor(() => screen.getByText("Ada Lovelace"));

    // The row button opens a confirm dialog — it does NOT grant yet.
    fireEvent.click(screen.getByRole("button", { name: /make admin/i }));
    const dialog = await screen.findByRole("dialog");
    expect(setAdmin).not.toHaveBeenCalled();

    // Confirming in the dialog performs the grant.
    fireEvent.click(within(dialog).getByRole("button", { name: /make admin/i }));
    await waitFor(() => expect(setAdmin).toHaveBeenCalledWith("u1", true));
  });

  it("filters users by search and by the privileged-only toggle", async () => {
    listUsers.mockResolvedValue([
      user({ id: "u1", name: "Ada Lovelace", email: "ada@company.com", can_plan: true }),
      user({ id: "u2", name: "Bob Viewer", email: "bob@company.com" }),
    ]);
    render(<Admin />);
    await waitFor(() => screen.getByText("Ada Lovelace"));
    expect(screen.getByText("Bob Viewer")).toBeInTheDocument();

    // Search narrows by name/email.
    fireEvent.change(screen.getByTestId("admin-user-search"), { target: { value: "bob" } });
    expect(screen.queryByText("Ada Lovelace")).not.toBeInTheDocument();
    expect(screen.getByText("Bob Viewer")).toBeInTheDocument();

    // Privileged-only hides plain read-only users.
    fireEvent.change(screen.getByTestId("admin-user-search"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /privileged only/i }));
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.queryByText("Bob Viewer")).not.toBeInTheDocument();
  });

  it("counts readiness team-grant holders as privileged", async () => {
    listUsers.mockResolvedValue([
      user({ id: "u1", name: "Lola Logistics", teams: ["logistics"] }),
      user({ id: "u2", name: "Bob Viewer", email: "bob@company.com" }),
    ]);
    render(<Admin />);
    await waitFor(() => screen.getByText("Lola Logistics"));
    fireEvent.click(screen.getByRole("checkbox", { name: /privileged only/i }));
    expect(screen.getByText("Lola Logistics")).toBeInTheDocument();
    expect(screen.queryByText("Bob Viewer")).not.toBeInTheDocument();
  });

  it("grants a readiness team from the user's Teams menu", async () => {
    listUsers.mockResolvedValue([user({})]);
    setTeams.mockResolvedValue({ teams: ["logistics"] });
    render(<Admin />);
    await waitFor(() => screen.getByText("Ada Lovelace"));

    const teamsButton = await screen.findByRole("button", { name: /^teams/i });
    await waitFor(() => expect(teamsButton).not.toBeDisabled());
    await userEvent.click(teamsButton);
    await userEvent.click(await screen.findByRole("menuitemcheckbox", { name: "Logistics" }));

    await waitFor(() => expect(setTeams).toHaveBeenCalledWith("u1", ["logistics"]));
    // The grant shows as a badge on the user row.
    const row = screen.getByText("Ada Lovelace").closest("li")!;
    expect(await within(row).findByText("Logistics")).toBeInTheDocument();
  });

  it("disables the Teams menu until a grantable team exists", async () => {
    readinessCatalog.mockResolvedValue(catalog(false));
    listUsers.mockResolvedValue([user({})]);
    render(<Admin />);
    await waitFor(() => screen.getByText("Ada Lovelace"));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^teams/i })).toBeDisabled(),
    );
  });
});
