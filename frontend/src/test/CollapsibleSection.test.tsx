import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { CollapsibleSection } from "@/components/ui/collapsible-section";

const KEY = "ds.test-section";

beforeEach(() => window.localStorage.clear());

function renderSection(defaultOpen?: boolean) {
  return render(
    <CollapsibleSection
      title="Things"
      count={3}
      storageKey={KEY}
      defaultOpen={defaultOpen}
      actions={<button type="button">Add thing</button>}
    >
      <p>Body text</p>
    </CollapsibleSection>,
  );
}

describe("CollapsibleSection", () => {
  it("opens by default and folds from its header, hiding the body and actions", () => {
    renderSection();
    const toggle = screen.getByRole("button", { name: /things/i });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Body text")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add thing" })).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Body text")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add thing" })).not.toBeInTheDocument();
  });

  it("can start folded", () => {
    renderSection(false);
    expect(screen.getByRole("button", { name: /things/i })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Body text")).not.toBeInTheDocument();
  });

  it("remembers the choice across visits", () => {
    const first = renderSection(false);
    fireEvent.click(screen.getByRole("button", { name: /things/i }));
    first.unmount();
    renderSection(false);
    expect(screen.getByText("Body text")).toBeInTheDocument();
  });
});
