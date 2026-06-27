import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";

import { ReadinessDot } from "@/components/readiness/ReadinessDot";

// Regression: a disabled status dot must not be an openable Radix dropdown
// trigger. `disabled` on a DropdownMenuTrigger child doesn't reliably stop the
// menu from opening, so a locked dot renders as a bare button with no trigger
// semantics — the picker can't be opened at all (chart edit dialog, grid, tab).
describe("ReadinessDot lock", () => {
  it("is an openable picker trigger when enabled", () => {
    render(<ReadinessDot code="FDP" status="On Track" onChange={() => {}} />);
    expect(screen.getByRole("button")).toHaveAttribute("aria-haspopup");
  });

  it("does not mount the picker when disabled (locked plan)", () => {
    render(<ReadinessDot code="FDP" status="On Track" disabled onChange={() => {}} />);
    const button = screen.getByRole("button");
    expect(button).toBeDisabled();
    expect(button).not.toHaveAttribute("aria-haspopup");
  });
});
