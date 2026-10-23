import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect } from "vitest";

import type { CatalogCheck } from "@/api/readiness";
import { ReadinessDot } from "@/components/readiness/ReadinessDot";
import { BUILTIN_PROJECT_GATES, FrozenCatalogProvider } from "@/components/readiness/catalog";
import { pickableStatuses } from "@/components/readiness/check-meta";

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

// ── The menu offers the check's PICKABLE statuses (phase 6, spec §3.3) ───────

describe("ReadinessDot menu", () => {
  const PO: CatalogCheck = {
    code: "PO", label: "Purchase Order", team_code: "logistics", applies_project: true, applies_well: true,
    status_set: "standard", icon_key: "receipt", locks_with_plan: false, sort_order: 10,
  };

  async function menuOf(ui: React.ReactElement): Promise<string[]> {
    render(ui);
    await userEvent.click(screen.getByRole("button"));
    const menu = await screen.findByRole("menu");
    return within(menu).getAllByRole("menuitem").map((i) => i.textContent ?? "");
  }

  it("a Project gate keeps N/A", async () => {
    expect(await menuOf(<ReadinessDot code="FDP" status="On Track" onChange={() => {}} />)).toEqual([
      "On Track", "Behind", "Completed", "N/A",
    ]);
  });

  it("a team check offers no N/A — read from the definition in context", async () => {
    const items = await menuOf(
      <FrozenCatalogProvider checks={[...BUILTIN_PROJECT_GATES, PO]}>
        <ReadinessDot code="PO" status="On Track" onChange={() => {}} />
      </FrozenCatalogProvider>,
    );
    expect(items).toEqual(["On Track", "Behind", "Completed"]);
  });

  it("a team view's own definition wins over an unknown code's gate-like fallback", async () => {
    // Outside any catalog, "PO" would fall back to a bare gate (with N/A); the
    // team view passes the menu from the definition it rendered from.
    const items = await menuOf(
      <ReadinessDot code="PO" status="On Track" statuses={pickableStatuses(PO)} onChange={() => {}} />,
    );
    expect(items).toEqual(["On Track", "Behind", "Completed"]);
  });
});
