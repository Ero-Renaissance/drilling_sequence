import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { SignerActionBanner } from "@/pages/ProjectDetail";
import type { ProjectApprovalSummary, ProjectLock } from "@/types";

const lock: ProjectLock = {
  locked: true,
  reason: "pending",
  revision_id: "rev-9",
  rev_number: 4,
  rev_label: "Rev. 04",
};

const approval = (over: Partial<ProjectApprovalSummary>): ProjectApprovalSummary => ({
  status: "pending_approval",
  rev_number: 4,
  rev_label: "Rev. 04",
  signed: 1,
  approvers: 2,
  your_action: "approve",
  ...over,
});

describe("SignerActionBanner", () => {
  it("tells an approver the revision awaits them and links to it", () => {
    render(
      <MemoryRouter>
        <SignerActionBanner projectId="p1" lock={lock} approval={approval({})} />
      </MemoryRouter>,
    );
    expect(
      screen.getByText(/Rev 4 · Rev\. 04 is awaiting your approval · 1\/2 signed\./),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Approve & Sign" })).toHaveAttribute(
      "href",
      "/projects/p1/revisions/rev-9",
    );
  });

  it("reads as a support ask during the review stage", () => {
    render(
      <MemoryRouter>
        <SignerActionBanner
          projectId="p1"
          lock={lock}
          approval={approval({ status: "pending_review", your_action: "review" })}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText(/awaiting your support\./)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Support & Sign" })).toBeInTheDocument();
  });
});
