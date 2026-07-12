import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RevisionDiscussion } from "@/components/revisions/RevisionDiscussion";
import * as api from "@/api/revision-comments";

vi.mock("@/api/revision-comments", () => ({
  listRevisionComments: vi.fn(),
  addRevisionComment: vi.fn(),
}));

const COMMENT = {
  id: "c1",
  revision_id: "r1",
  user_id: "u1",
  user_name: "Other User",
  author_role: "Approver",
  stage: "approval",
  body: "Checked the swamp lanes; waiting on LLI confirmation.",
  created_at: "2026-07-01T10:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.listRevisionComments).mockResolvedValue([COMMENT]);
});

describe("RevisionDiscussion", () => {
  it("shows the thread with author capacity and offers the composer while pending", async () => {
    render(<RevisionDiscussion projectId="p1" revisionId="r1" open />);
    await waitFor(() =>
      expect(screen.getByText(/waiting on LLI confirmation/)).toBeInTheDocument(),
    );
    expect(screen.getByText("Approver")).toBeInTheDocument(); // capacity chip
    expect(screen.getByTestId("discussion-input")).toBeInTheDocument();
  });

  it("posts a comment and appends it to the thread", async () => {
    vi.mocked(api.addRevisionComment).mockResolvedValue({
      ...COMMENT,
      id: "c2",
      user_name: "Dev User",
      author_role: "Planner",
      body: "LLI confirmed.",
    });
    render(<RevisionDiscussion projectId="p1" revisionId="r1" open />);
    await waitFor(() => expect(screen.getByTestId("discussion-input")).toBeInTheDocument());
    await userEvent.type(screen.getByTestId("discussion-input"), "LLI confirmed.");
    await userEvent.click(screen.getByRole("button", { name: /post comment/i }));
    await waitFor(() => expect(screen.getByText("LLI confirmed.")).toBeInTheDocument());
    expect(api.addRevisionComment).toHaveBeenCalledWith("p1", "r1", "LLI confirmed.");
  });

  it("is read-only after resolution — the record stays, the composer goes", async () => {
    render(<RevisionDiscussion projectId="p1" revisionId="r1" open={false} />);
    await waitFor(() =>
      expect(screen.getByText(/waiting on LLI confirmation/)).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("discussion-input")).not.toBeInTheDocument();
    expect(screen.getByText(/thread closed when the revision was resolved/i)).toBeInTheDocument();
  });

  it("renders nothing for a resolved revision with no comments", async () => {
    vi.mocked(api.listRevisionComments).mockResolvedValue([]);
    const { container } = render(
      <RevisionDiscussion projectId="p1" revisionId="r1" open={false} />,
    );
    await waitFor(() => expect(api.listRevisionComments).toHaveBeenCalled());
    await waitFor(() => expect(container.firstChild).toBeNull());
  });
});
