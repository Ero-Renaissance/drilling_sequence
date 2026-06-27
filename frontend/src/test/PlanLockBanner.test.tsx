import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  getAccessToken: async () => "test-token",
  msalInstance: { getAllAccounts: () => [], logoutRedirect: vi.fn() },
  loginRequest: {},
}));

import { PlanLockBanner } from "@/pages/ProjectDetail";
import type { ProjectLock } from "@/types";

function lock(reason: "pending" | "approved"): ProjectLock {
  return { locked: true, reason, revision_id: "r1", rev_number: 3, rev_label: "Q3 plan" };
}

describe("PlanLockBanner", () => {
  it("offers Revise Plan for an approved campaign when the user can revise", () => {
    render(<PlanLockBanner projectId="p1" lock={lock("approved")} canRevise />);
    expect(screen.getByRole("button", { name: /revise plan/i })).toBeInTheDocument();
    expect(screen.getAllByText(/Q3 plan/i).length).toBeGreaterThan(0);
  });

  it("hides Revise Plan when the user cannot revise (still shows the locked state)", () => {
    render(<PlanLockBanner projectId="p1" lock={lock("approved")} canRevise={false} />);
    expect(screen.queryByRole("button", { name: /revise plan/i })).not.toBeInTheDocument();
    expect(screen.getAllByText(/approved/i).length).toBeGreaterThan(0);
  });

  it("is informational (no action) while pending approval", () => {
    render(<PlanLockBanner projectId="p1" lock={lock("pending")} canRevise />);
    expect(screen.queryByRole("button", { name: /revise plan/i })).not.toBeInTheDocument();
    expect(screen.getAllByText(/awaiting approval/i).length).toBeGreaterThan(0);
  });

  it("renders nothing when the plan is not locked", () => {
    const { container } = render(
      <PlanLockBanner projectId="p1" lock={{ ...lock("approved"), locked: false }} canRevise />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
