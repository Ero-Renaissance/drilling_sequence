import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, it, expect, vi } from "vitest";
import { ProjectCard } from "@/components/projects/ProjectCard";
import { useAuthStore } from "@/store/auth";
import { mockProject, mockUser } from "./mocks/handlers";

const routerFuture = { v7_startTransition: true, v7_relativeSplatPath: true };

// The card's clone/archive affordances are planner-gated: signed in as the
// campaign's planner (mockUser holds the grant and the planner role).
beforeEach(() => {
  useAuthStore.setState({ user: mockUser, loading: false });
});

function renderCard(onArchive?: (id: string) => void) {
  return render(
    <MemoryRouter future={routerFuture}>
      <ProjectCard project={mockProject} onArchive={onArchive} />
    </MemoryRouter>,
  );
}

describe("ProjectCard", () => {
  it("renders the project name", () => {
    renderCard();
    expect(screen.getByText("North Sea Campaign")).toBeInTheDocument();
  });

  it("renders field and region", () => {
    renderCard();
    expect(screen.getByText("Bonga")).toBeInTheDocument();
    expect(screen.getByText("Offshore")).toBeInTheDocument();
  });

  it("shows member count", () => {
    // The count and label render as siblings (<span>1</span> member), so assert
    // on the combined text content rather than a single element.
    const { container } = renderCard();
    expect(container.textContent).toMatch(/1\s*members?/i);
  });

  it("calls onArchive with the project id when archive button clicked", () => {
    const onArchive = vi.fn();
    renderCard(onArchive);
    const archiveBtn = screen.getByTitle("Archive campaign");
    fireEvent.click(archiveBtn);
    expect(onArchive).toHaveBeenCalledWith(mockProject.id);
  });

  it("does not render archive button when onArchive is not provided", () => {
    renderCard();
    expect(screen.queryByTitle("Archive campaign")).not.toBeInTheDocument();
  });

  it("hides clone and archive for a read-only user (org-wide viewer)", () => {
    useAuthStore.setState({
      user: { ...mockUser, id: "someone-else", can_plan: false },
      loading: false,
    });
    const onArchive = vi.fn();
    renderCard(onArchive);
    expect(screen.queryByTitle("Archive campaign")).not.toBeInTheDocument();
    // The card itself still renders read-only.
    expect(screen.getByText("North Sea Campaign")).toBeInTheDocument();
  });
});

describe("ProjectCard plan state + lineage", () => {
  it("shows the plan-state chip and the clone lineage caption", () => {
    render(
      <MemoryRouter future={routerFuture}>
        <ProjectCard
          project={{
            ...mockProject,
            approval: {
              status: "approved",
              rev_number: 2,
              rev_label: null,
              signed: 0,
              approvers: 1,
              your_action: null,
            },
            cloned_from_name: "Q1 drilling sequence",
          }}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText("Approved · Rev 2")).toBeInTheDocument();
    expect(screen.getByText("Cloned from Q1 drilling sequence")).toBeInTheDocument();
  });

  it("navigates to Approvals from the chip without triggering the card's own navigation", () => {
    render(
      <MemoryRouter future={routerFuture}>
        <ProjectCard
          project={{
            ...mockProject,
            approval: {
              status: "revising",
              rev_number: 2,
              rev_label: null,
              signed: 0,
              approvers: 1,
              your_action: null,
            },
          }}
        />
      </MemoryRouter>,
    );
    const chip = screen.getByText("Revising · after Rev 2");
    expect(chip.closest("a")).toHaveAttribute(
      "href",
      `/projects/${mockProject.id}/signatures`,
    );
  });

  it("renders no chip when the list has no approval summary", () => {
    render(
      <MemoryRouter future={routerFuture}>
        <ProjectCard project={{ ...mockProject, approval: undefined }} />
      </MemoryRouter>,
    );
    expect(screen.queryByText(/Approved|Draft|Revising|Pending/)).not.toBeInTheDocument();
  });
});
