import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { PlanStateChip, planStateLabel } from "@/components/PlanStateChip";
import type { ProjectApprovalSummary } from "@/types";

const summary = (over: Partial<ProjectApprovalSummary>): ProjectApprovalSummary => ({
  status: "draft", rev_number: null, rev_label: null, signed: 0, approvers: 0, ...over,
});

describe("planStateLabel", () => {
  it("maps each plan state to its chip", () => {
    expect(planStateLabel(summary({ status: "approved", rev_number: 3 }))).toEqual({
      label: "Approved · Rev 3", tone: "green",
    });
    expect(
      planStateLabel(summary({ status: "pending_approval", signed: 1, approvers: 2 })),
    ).toEqual({ label: "Pending approval · 1/2 signed", tone: "amber" });
    // Zero approvers can never complete — the footgun stays visible.
    expect(planStateLabel(summary({ status: "pending_approval" }))).toEqual({
      label: "Pending approval · no approvers", tone: "red",
    });
    expect(planStateLabel(summary({ status: "pending_review" })).label).toBe("Pending support");
    expect(planStateLabel(summary({ status: "changes_requested" })).label).toBe(
      "Changes requested",
    );
    expect(planStateLabel(summary({ status: "rejected" })).tone).toBe("red");
    // draft, discarded, and anything unknown all read as Draft.
    expect(planStateLabel(summary({ status: "discarded" })).label).toBe("Draft");
    expect(planStateLabel(summary({})).label).toBe("Draft");
  });
});

describe("PlanStateChip", () => {
  it("links to the Approvals tab", () => {
    render(
      <MemoryRouter>
        <PlanStateChip projectId="p1" approval={summary({ status: "approved", rev_number: 2 })} />
      </MemoryRouter>,
    );
    const link = screen.getByRole("link", { name: "Approved · Rev 2" });
    expect(link).toHaveAttribute("href", "/projects/p1/signatures");
  });

  it("renders nothing while the summary hasn't loaded", () => {
    const { container } = render(
      <MemoryRouter>
        <PlanStateChip projectId="p1" approval={null} />
      </MemoryRouter>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
