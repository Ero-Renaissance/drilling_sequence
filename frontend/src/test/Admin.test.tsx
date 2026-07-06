import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
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
vi.mock("@/api/admin", () => ({
  adminApi: {
    listUsers: () => listUsers(),
    setAdmin: (id: string, isAdmin: boolean) => setAdmin(id, isAdmin),
    setCanPlan: (id: string, canPlan: boolean) => setCanPlan(id, canPlan),
  },
}));

import { Admin } from "@/pages/Admin";
import type { AdminUser } from "@/types";

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

  it("filters users by search and by the admins-and-planners toggle", async () => {
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
    fireEvent.click(screen.getByRole("checkbox", { name: /admins & planners only/i }));
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.queryByText("Bob Viewer")).not.toBeInTheDocument();
  });
});
