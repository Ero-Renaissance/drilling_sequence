import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/auth", () => ({
  getAccessToken: async () => "test-token",
  msalInstance: { getAllAccounts: () => [], logoutRedirect: vi.fn() },
  loginRequest: {},
}));

import { RevisionPrintControl } from "@/components/revisions/RevisionPrintControl";
import type { Revision } from "@/api/revisions";

const REVISION: Revision = {
  id: "rev-1",
  project_id: "p1",
  rev_number: 3,
  label: null,
  status: "pending_approval",
  stage: "approval",
  review_required: false,
  review_skipped: false,
  created_by_name: "Dev User",
  created_at: "2026-07-01T00:00:00Z",
  signatures: [],
  approver_status: [],
  reviewer_status: [],
  decision_reason: null,
  decision_by_name: null,
  decision_at: null,
  integrity_digest: "d",
} as unknown as Revision;

describe("RevisionPrintControl", () => {
  beforeEach(() => {
    window.print = vi.fn();
  });
  afterEach(() => {
    document.body.classList.remove("ds-printing-revision");
  });

  it("prints ONLY the document: portal to <body> + exclusivity rule, whatever page hosts it", async () => {
    // A host page with screen content that carries NO print:hidden classes —
    // exactly the drift that leaked the Approvals tab into the PDF.
    const { container } = render(
      <div>
        <p>Screen-only host content</p>
        <RevisionPrintControl projectId="proj-001" revision={REVISION} project={null} />
      </div>,
    );

    await userEvent.click(screen.getByTestId("revision-print"));
    await userEvent.click(await screen.findByText("Export PDF (with signatures)"));

    // The print bundle mounts as a DIRECT child of <body>, outside the host tree…
    await waitFor(() => {
      expect(document.body.querySelector(":scope > .ds-print-doc")).not.toBeNull();
    });
    const bundle = document.body.querySelector(":scope > .ds-print-doc")!;
    expect(container.contains(bundle)).toBe(false);

    // …the body is marked while printing…
    expect(document.body.classList.contains("ds-printing-revision")).toBe(true);

    // …and the stylesheet hides every OTHER body child, so no host page can
    // ever leak into the PDF again.
    const css = bundle.querySelector("style")?.textContent ?? "";
    expect(css).toContain("body.ds-printing-revision > *:not(.ds-print-doc) { display: none !important; }");
    await waitFor(() => expect(window.print).toHaveBeenCalledTimes(1));

    // afterprint tears everything down.
    window.dispatchEvent(new Event("afterprint"));
    await waitFor(() => {
      expect(document.body.querySelector(":scope > .ds-print-doc")).toBeNull();
    });
    expect(document.body.classList.contains("ds-printing-revision")).toBe(false);
  });
});
