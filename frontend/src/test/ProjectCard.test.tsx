import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi } from "vitest";
import { ProjectCard } from "@/components/projects/ProjectCard";
import { mockProject } from "./mocks/handlers";

const routerFuture = { v7_startTransition: true, v7_relativeSplatPath: true };

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
    renderCard();
    expect(screen.getByText("1 member")).toBeInTheDocument();
  });

  it("calls onArchive with the project id when archive button clicked", () => {
    const onArchive = vi.fn();
    renderCard(onArchive);
    const archiveBtn = screen.getByTitle("Archive project");
    fireEvent.click(archiveBtn);
    expect(onArchive).toHaveBeenCalledWith(mockProject.id);
  });

  it("does not render archive button when onArchive is not provided", () => {
    renderCard();
    expect(screen.queryByTitle("Archive project")).not.toBeInTheDocument();
  });
});
