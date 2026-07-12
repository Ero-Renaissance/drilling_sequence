import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ApproverSettings } from "@/components/revisions/ApproverSettings";

vi.mock("@/api/approvers", () => ({
  listApprovers: vi.fn().mockResolvedValue([
    {
      id: "a1",
      project_id: "p1",
      email: "pm@company.com",
      name: "PM",
      role_label: "Project Manager",
    },
  ]),
  addApprover: vi.fn(),
  removeApprover: vi.fn(),
}));

beforeEach(() => vi.clearAllMocks());

describe("ApproverSettings frozen state", () => {
  it("locks add/remove and explains why while a revision is open", async () => {
    render(<ApproverSettings projectId="p1" frozen />);
    await waitFor(() => expect(screen.getByText("pm@company.com")).toBeInTheDocument());
    // The backend would 423 these — the affordances are locked up front.
    expect(screen.queryByTestId("add-approver-btn")).not.toBeInTheDocument();
    expect(screen.queryByTestId("remove-approver")).not.toBeInTheDocument();
    expect(screen.getByTestId("signers-frozen-hint")).toHaveTextContent(/frozen while a revision/i);
  });

  it("keeps the affordances when no revision is open", async () => {
    render(<ApproverSettings projectId="p1" />);
    await waitFor(() => expect(screen.getByText("pm@company.com")).toBeInTheDocument());
    expect(screen.getByTestId("add-approver-btn")).toBeInTheDocument();
    expect(screen.getByTestId("remove-approver")).toBeInTheDocument();
    expect(screen.queryByTestId("signers-frozen-hint")).not.toBeInTheDocument();
  });
});
