import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/auth", () => ({
  getAccessToken: async () => "test-token",
  msalInstance: { getAllAccounts: () => [], logoutRedirect: vi.fn() },
  loginRequest: {},
}));

import { SequencePrintControl } from "@/components/chart/SequencePrintControl";
import { PRINT_CLAIM_EVENT } from "@/lib/print-css";
import type { Activity } from "@/api/activities";
import { mockProject } from "./mocks/handlers";

let seq = 0;
function act(over: Partial<Activity>): Activity {
  return {
    id: `a${seq++}`,
    project_id: "p1",
    activity_type: "Oil Development",
    start_date: "2026-01-01",
    end_date: "2026-06-01",
    well_name: "W-1",
    rig_name: "Rig 1",
    hwu_name: null,
    well_project: "Proj A",
    project_group: null,
    location: "LAND",
    risk: null,
    comment: null,
    plan_type: "Firm",
    completed_at: null,
    updated_at: "",
    updated_by_name: null,
    locked_by_revision_id: null,
    ...over,
  } as Activity;
}

const ACTIVITIES = [
  act({}),
  act({ location: "SWAMP", rig_name: "Rig 2", well_name: "W-2" }),
  act({ well_name: "W-Done", completed_at: "2026-02-01T00:00:00Z" }),
];

describe("SequencePrintControl", () => {
  beforeEach(() => {
    window.print = vi.fn();
  });
  afterEach(() => {
    document.body.classList.remove("ds-printing-revision");
  });

  it("prints the live plan as a stamped working copy — no revision, no signatures", async () => {
    render(
      <div>
        <p>Screen-only host content</p>
        <SequencePrintControl projectId={mockProject.id} activities={ACTIVITIES} />
      </div>,
    );

    await userEvent.click(screen.getByTestId("sequence-print"));
    await userEvent.click(await screen.findByText("Print working copy"));

    // Portal to <body> with the exclusivity rule — same structural guarantee
    // as the revision print (no host page can leak into the PDF).
    await waitFor(() => {
      expect(document.body.querySelector(":scope > .ds-print-doc")).not.toBeNull();
    });
    const bundle = document.body.querySelector(":scope > .ds-print-doc")!;
    expect(document.body.classList.contains("ds-printing-revision")).toBe(true);
    const css = bundle.querySelector("style")?.textContent ?? "";
    expect(css).toContain(
      "body.ds-printing-revision > *:not(.ds-print-doc) { display: none !important; }",
    );

    // Unmistakably a working copy: title + as-of stamp + watermark…
    expect(bundle.textContent).toContain("Rig Sequence — Working Copy");
    expect(bundle.textContent).toContain("Working copy — unapproved plan");
    expect(bundle.textContent).toMatch(/As of \d{2}-\d{2}-\d{4}, \d{2}:\d{2}/);
    expect(bundle.textContent).toContain("Working copy · unapproved · uncontrolled when printed");
    // …and never the formal record: no Rev number, no signature blocks, no doc ID.
    expect(bundle.textContent).not.toContain("Rev.");
    expect(bundle.textContent).not.toContain("Approval signatures");
    expect(bundle.textContent).not.toContain("Document ID");

    // Terrain-major sections from the live activities.
    expect(bundle.textContent).toContain("Land terrain");
    expect(bundle.textContent).toContain("Swamp terrain");

    // Completed work stays IN the working copy, greyed like the screen —
    // never dropped, and the legend decodes it.
    const doneBar = [...bundle.querySelectorAll("span[title]")].find((b) =>
      (b as HTMLElement).title.includes("W-Done"),
    ) as HTMLElement | undefined;
    expect(doneBar?.style.backgroundColor).toBe("rgb(148, 163, 184)");
    expect(doneBar?.title).toContain("· completed");
    expect(bundle.textContent).toContain("Completed");

    await waitFor(() => expect(window.print).toHaveBeenCalledTimes(1));
    window.dispatchEvent(new Event("afterprint"));
    await waitFor(() => {
      expect(document.body.querySelector(":scope > .ds-print-doc")).toBeNull();
    });
    expect(document.body.classList.contains("ds-printing-revision")).toBe(false);
  });

  it("stands down when another control claims the printer", async () => {
    render(<SequencePrintControl projectId={mockProject.id} activities={ACTIVITIES} />);
    await userEvent.click(screen.getByTestId("sequence-print"));
    await userEvent.click(await screen.findByText("Print working copy"));
    await waitFor(() => {
      expect(document.body.querySelector(":scope > .ds-print-doc")).not.toBeNull();
    });

    // A revision control claiming the print (its own id) unmounts our document.
    window.dispatchEvent(new CustomEvent(PRINT_CLAIM_EVENT, { detail: "rev-99" }));
    await waitFor(() => {
      expect(document.body.querySelector(":scope > .ds-print-doc")).toBeNull();
    });
  });
});
