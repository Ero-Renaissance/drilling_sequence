import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { Sidebar } from "@/components/layout/Sidebar";

function renderSidebar() {
  return render(
    <MemoryRouter>
      <Sidebar />
    </MemoryRouter>,
  );
}

describe("Sidebar", () => {
  beforeEach(() => window.localStorage.clear());

  it("collapses to an icon rail and back, keeping every link reachable", () => {
    const { container } = renderSidebar();
    const aside = container.querySelector("aside")!;
    expect(aside).toHaveAttribute("data-collapsed", "false");
    expect(screen.getByText("Workspace")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(aside).toHaveAttribute("data-collapsed", "true");
    expect(screen.queryByText("Workspace")).not.toBeInTheDocument();
    // Icon only — the label stays for screen readers and as a tooltip.
    const campaigns = screen.getByRole("link", { name: "Campaigns" });
    expect(campaigns).toHaveAttribute("title", "Campaigns");

    fireEvent.click(screen.getByRole("button", { name: "Expand sidebar" }));
    expect(aside).toHaveAttribute("data-collapsed", "false");
  });

  it("remembers the choice", () => {
    const first = renderSidebar();
    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(window.localStorage.getItem("ds.sidebar-collapsed")).toBe("1");
    first.unmount();

    const { container } = renderSidebar();
    expect(container.querySelector("aside")).toHaveAttribute("data-collapsed", "true");
  });

  it("starts collapsed on a narrow screen the first time", () => {
    const width = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 800 });
    try {
      const { container } = renderSidebar();
      expect(container.querySelector("aside")).toHaveAttribute("data-collapsed", "true");
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
    }
  });
});
