import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/auth", () => ({
  getAccessToken: async () => "test-token",
  msalInstance: { getAllAccounts: () => [], logoutRedirect: vi.fn() },
  loginRequest: {},
}));

import { http, HttpResponse } from "msw";
import { SequencePrintControl } from "@/components/chart/SequencePrintControl";
import { PRINT_CLAIM_EVENT } from "@/lib/print-css";
import type { Activity } from "@/api/activities";
import type { CatalogCheck, CatalogTeam, CheckStatus } from "@/api/readiness";
import {
  BUILTIN_PROJECT_GATES,
  BUILTIN_TEAMS,
  ReadinessCatalogProvider,
} from "@/components/readiness/catalog";
import { mockProject } from "./mocks/handlers";
import { server } from "./mocks/server";

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

  it("a team lens prints only the checks that apply — the key lists no N/A (spec §8.4)", async () => {
    const LOGISTICS: CatalogTeam = {
      code: "logistics", name: "Logistics", editor_source: "team_grant", icon_key: "truck", sort_order: 20,
    };
    const check = (code: string, sort_order: number): CatalogCheck => ({
      code, label: code, team_code: "logistics", applies_project: true, applies_well: true,
      status_set: "standard", icon_key: "receipt", locks_with_plan: false, sort_order,
    });
    const checks = [check("L-BUD", 10), check("NAV", 20), check("PO", 30)];
    const cell = (status: CheckStatus, applies: boolean) => ({
      status, notes: null, updated_at: null, applies, applies_source: "project", source: "project",
    });
    server.use(
      http.get("/api/readiness/catalog", () =>
        HttpResponse.json({ teams: [...BUILTIN_TEAMS, LOGISTICS], checks: [...BUILTIN_PROJECT_GATES, ...checks], status_sets: {} }),
      ),
      http.get("/api/projects/:projectId/readiness/teams/:team", () =>
        HttpResponse.json({
          team: LOGISTICS, checks, locked: false, project_rows: [],
          well_rows: [{
            well_project: "Proj A", well_name: "W-1", activity_type: "Oil Development", activity_count: 1,
            location: "LAND", start_date: "2026-01-01", focus_start: "2026-01-01",
            // NAV was unticked: Behind underneath, never printed.
            checks: { "L-BUD": cell("Completed", true), NAV: cell("Behind", false), PO: cell("On Track", true) },
          }],
        }),
      ),
    );
    render(
      <ReadinessCatalogProvider>
        <SequencePrintControl projectId={mockProject.id} activities={[act({})]} lens="logistics" />
      </ReadinessCatalogProvider>,
    );
    await userEvent.click(screen.getByTestId("sequence-print"));
    await userEvent.click(await screen.findByText("Sequence with Readiness Icons"));
    // The lens choices appear once the live catalog (with Logistics) has loaded.
    await screen.findByText("All teams (one badge each)");
    await userEvent.click(await screen.findByText("Print working copy"));
    await waitFor(() => {
      expect(document.body.querySelector(":scope > .ds-print-doc")).not.toBeNull();
    });
    const bundle = document.body.querySelector<HTMLElement>(":scope > .ds-print-doc")!;
    expect(bundle.textContent).toContain("Readiness: Logistics — live status");
    const strip = bundle.querySelector<HTMLElement>('[data-testid="gantt-readiness-strip"]')!;
    // Two of the lens's three checks applied — packed left in a three-column strip.
    expect(strip.querySelectorAll("svg")).toHaveLength(2);
    expect(strip.querySelector<HTMLElement>(".grid")!.style.gridTemplateColumns).toBe(
      "repeat(3, minmax(0, 1fr))",
    );
    expect(strip.querySelector(".text-red-500")).toBeNull(); // NAV's Behind never prints
    const key = [...bundle.querySelectorAll("span")].find(
      (el) => el.textContent === "Status" && el.className.includes("w-16"),
    )!.parentElement!;
    expect(key.textContent).toBe("StatusOn TrackBehindCompleted");

    window.dispatchEvent(new Event("afterprint"));
  });
});
