/**
 * The Well Execution Readiness page (docs/well-execution-readiness-spec.md,
 * Part B): the Projects team's checks laid out as the sheet — one row per well,
 * grouped by value stream and field project, the spud month under its year, one
 * coloured cell per check with its note — and edited from each cell's menu.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";

vi.mock("@/lib/auth", () => ({
  getAccessToken: async () => "test-token",
  msalInstance: { getAllAccounts: () => [], logoutRedirect: vi.fn() },
  loginRequest: {},
}));

type TestUser = { id: string; is_admin: boolean; teams: string[] };
let currentUser: TestUser | null = null;
vi.mock("@/store/auth", () => ({
  useAuthStore: (selector: (s: { user: TestUser | null }) => unknown) =>
    selector({ user: currentUser }),
}));

import { WellExecutionGrid } from "@/components/readiness/WellExecutionGrid";
import { Toaster } from "@/components/ui/toaster";
import { server } from "./mocks/server";
import { mockGateTeam } from "./mocks/handlers";

const PID = "cccccccc-0000-0000-0000-000000000001";
let puts: Record<string, unknown>[] = [];
let resets: Record<string, unknown>[] = [];

/** Swamp: FID done for the project; ADTU-1 has its own FDP (Behind, noted). */
function team() {
  const data = mockGateTeam({
    wells: [
      { well_project: "SSAGS3 Swamp", well_name: "OGBO ADTU-1", start_date: "2027-01-10" },
      { well_project: "SSAGS3 Swamp", well_name: "OGBO BATP-1", start_date: "2027-04-02" },
      { well_project: "SSAGS3 Land", well_name: "ANGA KDHU-1", start_date: "2028-01-15" },
      { well_project: "", well_name: "Forc151", start_date: "2027-01-20" },
    ],
    projectStatuses: { "SSAGS3 Swamp": { FID: "Completed" } },
    wellStatuses: { "SSAGS3 Swamp\u0001OGBO ADTU-1": { FDP: "Behind" } },
  });
  const market: Record<string, string | null> = {
    "OGBO ADTU-1": "Oil",
    "OGBO BATP-1": "Oil",
    "ANGA KDHU-1": "Domestic Gas",
    Forc151: null,
  };
  return {
    ...data,
    well_rows: data.well_rows.map((r) => ({
      ...r,
      market: market[r.well_name],
      checks:
        r.well_name === "OGBO ADTU-1"
          ? { ...r.checks, FDP: { ...r.checks.FDP, notes: "10k" } }
          : r.checks,
    })),
  };
}

beforeEach(() => {
  currentUser = { id: "p1", is_admin: false, teams: [] };
  puts = [];
  resets = [];
  server.use(
    http.get("/api/projects/:projectId/readiness/teams/projects", () => HttpResponse.json(team())),
    http.put("/api/projects/:projectId/readiness/:checkCode", async ({ request, params }) => {
      puts.push({ code: params.checkCode, ...((await request.json()) as object) });
      return HttpResponse.json({});
    }),
    http.post("/api/projects/:projectId/readiness/:checkCode/reset", async ({ request, params }) => {
      resets.push({ code: params.checkCode, ...((await request.json()) as object) });
      return HttpResponse.json({});
    }),
  );
});

function renderGrid(canEditPlan = true, path = "/") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <WellExecutionGrid projectId={PID} canEditPlan={canEditPlan} />
      <Toaster />
    </MemoryRouter>,
  );
}

const table = () => screen.findByRole("table", { name: "Well execution readiness" });
const rowOf = (t: HTMLElement, well: string) => within(t).getByText(well).closest("tr")!;
const cell = (row: HTMLElement, label: RegExp) => within(row).getByLabelText(label);

describe("WellExecutionGrid — the layout", () => {
  it("groups wells by value stream, then field project, with the spud month under its year", async () => {
    renderGrid();
    const t = await table();
    // Value streams by name, wells with none last; within one, by project.
    const wells = within(t)
      .getAllByTestId("well-name")
      .map((el) => el.textContent);
    expect(wells).toEqual(["ANGA KDHU-1", "OGBO ADTU-1", "OGBO BATP-1", "Forc151"]);
    expect(within(t).getByText("Domestic Gas")).toBeInTheDocument();
    expect(within(t).getByText("No value stream")).toBeInTheDocument();
    // Oil spans its two wells, and so does their field project.
    expect(within(t).getByText("Oil").closest("td")).toHaveAttribute("rowspan", "2");
    expect(within(t).getByText("SSAGS3 Swamp").closest("td")).toHaveAttribute("rowspan", "2");

    // One column per spud year; the month sits under the well's year.
    const headers = within(t).getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual(expect.arrayContaining(["Spud date", "2027", "2028", "Well Permits"]));
    expect(within(rowOf(t, "OGBO BATP-1")).getByText("Apr")).toBeInTheDocument();
    expect(within(rowOf(t, "ANGA KDHU-1")).getByText("Jan")).toBeInTheDocument();
    expect(screen.getByTestId("readiness-count")).toHaveTextContent("4 wells");
  });

  it("draws each status with its own mark, and a cell's note", async () => {
    renderGrid();
    const t = await table();
    const adtu = rowOf(t, "OGBO ADTU-1");
    // Its own FDP: Behind, with the note shown in the cell.
    const fdp = cell(adtu, /^Approved FDP\/IP for OGBO ADTU-1: Behind schedule — set on this well — Note: 10k/);
    expect(fdp).toHaveAttribute("data-status", "Behind");
    expect(fdp).toHaveTextContent("10k");
    // FID follows the field project; Well Permits is not set anywhere.
    const fid = cell(adtu, /^Final Investment Decision for OGBO ADTU-1: Completed \/ In place — from its field project/);
    expect(fid).toHaveTextContent("✓");
    expect(cell(adtu, /^Well Permits for OGBO ADTU-1: Not started — not set yet/)).toHaveTextContent("✕");
    // The key spells the statuses out as the sheet does.
    const key = screen.getByLabelText("Key");
    for (const label of ["Completed / In place", "On track / Progressing", "Behind schedule", "Not started"]) {
      expect(within(key).getByText(label)).toBeInTheDocument();
    }
  });

  it("filters by value stream and by search", async () => {
    renderGrid();
    const t = await table();
    await userEvent.selectOptions(screen.getByLabelText("Value stream"), "Oil");
    expect(within(t).queryByText("ANGA KDHU-1")).not.toBeInTheDocument();
    expect(screen.getByTestId("readiness-count")).toHaveTextContent("2 of 4");
    await userEvent.type(screen.getByTestId("readiness-search"), "batp");
    await waitFor(() => expect(screen.getByTestId("readiness-count")).toHaveTextContent("1 of 4"));
  });
});

describe("WellExecutionGrid — the years shown", () => {
  it("shows a spud column per year — three at most — and hides wells that spud outside them", async () => {
    renderGrid();
    const t = await table();
    // Opens on this year and the next two (the suite's date is in 2026).
    const yearHeaders = () =>
      within(screen.getByRole("table", { name: "Well execution readiness" }))
        .getAllByRole("columnheader")
        .map((h) => h.textContent)
        .filter((text) => /^\d{4}$/.test(text ?? ""));
    expect(yearHeaders()).toEqual(["2026", "2027", "2028"]);
    expect(within(t).getAllByTestId("well-name")).toHaveLength(4);

    // One year only: 2026 has no spud, so nothing is listed — and the page says
    // how many wells the years leave out.
    await userEvent.selectOptions(screen.getByLabelText("How many years to show"), "1");
    await waitFor(() =>
      expect(screen.getByTestId("outside-years")).toHaveTextContent("4 more wells"),
    );
    expect(screen.queryByRole("table", { name: "Well execution readiness" })).not.toBeInTheDocument();

    // Step to 2027: its three wells, one column.
    await userEvent.click(screen.getByRole("button", { name: "Later years" }));
    await table();
    expect(yearHeaders()).toEqual(["2027"]);
    expect(
      screen.getAllByTestId("well-name").map((el) => el.textContent).sort(),
    ).toEqual(["Forc151", "OGBO ADTU-1", "OGBO BATP-1"]);
    expect(screen.getByTestId("outside-years")).toHaveTextContent("1 more well");
  });

  it("asks the server for the years shown", async () => {
    const asked: string[] = [];
    server.use(
      http.get("/api/projects/:projectId/readiness/teams/projects", ({ request }) => {
        asked.push(new URL(request.url).search);
        return HttpResponse.json(team());
      }),
    );
    renderGrid(true, "/?from=2027&years=2");
    await table();
    expect(asked).toEqual(["?from_year=2027&years=2"]);
  });
});

describe("WellExecutionGrid — editing", () => {
  it("a cell's menu sets the status on that well, without sending a note", async () => {
    renderGrid();
    const t = await table();
    await userEvent.click(cell(rowOf(t, "OGBO BATP-1"), /^Well Permits for OGBO BATP-1/));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getAllByRole("menuitem").map((i) => i.textContent)).toEqual([
      "Not started",
      "On track / Progressing",
      "Behind schedule",
      "Completed / In place",
      "Not applicable",
      "Add note…",
    ]);
    await userEvent.click(within(menu).getByRole("menuitem", { name: /On track/ }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toMatchObject({
      code: "WP",
      scope: "well",
      well_project: "SSAGS3 Swamp",
      well_name: "OGBO BATP-1",
      status: "On Track",
    });
    // Left out, so the server keeps whatever note the cell holds.
    expect(puts[0]).not.toHaveProperty("notes");
  });

  it("a well with its own value can reset to its project; one that follows can't", async () => {
    renderGrid();
    const t = await table();
    const adtu = rowOf(t, "OGBO ADTU-1");
    await userEvent.click(cell(adtu, /^Final Investment Decision for OGBO ADTU-1/));
    expect(
      within(await screen.findByRole("menu")).queryByRole("menuitem", { name: /Reset to project/ }),
    ).not.toBeInTheDocument();
    await userEvent.keyboard("{Escape}");

    await userEvent.click(cell(adtu, /^Approved FDP\/IP for OGBO ADTU-1/));
    await userEvent.click(await screen.findByRole("menuitem", { name: /Reset to project/ }));
    await waitFor(() =>
      expect(resets[0]).toMatchObject({ code: "FDP", scope: "well", well_name: "OGBO ADTU-1" }),
    );
  });

  it("saves a note with the cell's current status", async () => {
    renderGrid();
    const t = await table();
    await userEvent.click(cell(rowOf(t, "OGBO ADTU-1"), /^Approved FDP\/IP for OGBO ADTU-1/));
    await userEvent.click(await screen.findByRole("menuitem", { name: /Edit note/ }));
    const dialog = await screen.findByRole("dialog", { name: /Note — Approved FDP\/IP · OGBO ADTU-1/ });
    const box = within(dialog).getByLabelText("Note");
    expect(box).toHaveValue("10k");
    await userEvent.clear(box);
    await userEvent.type(box, "12k, awaiting partners");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save note" }));
    await waitFor(() =>
      expect(puts[0]).toMatchObject({
        code: "FDP",
        scope: "well",
        well_name: "OGBO ADTU-1",
        status: "Behind",
        notes: "12k, awaiting partners",
      }),
    );
  });

  it("'Set for all wells' sets the field project's value", async () => {
    renderGrid();
    await table();
    await userEvent.click(
      screen.getByRole("button", { name: "Set checks for all wells of SSAGS3 Swamp" }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Set for all wells of SSAGS3 Swamp" });
    const row = within(dialog).getByText("Well Permits").closest("li")!;
    await userEvent.click(within(row).getByRole("button", { name: /click to change/i }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /Completed/ }));
    await waitFor(() =>
      expect(puts[0]).toMatchObject({
        code: "WP",
        scope: "project",
        well_project: "SSAGS3 Swamp",
        status: "Completed",
      }),
    );
    // A well with no field project has nothing to set for.
    expect(
      screen.queryByRole("button", { name: /Set checks for all wells of $/ }),
    ).not.toBeInTheDocument();
  });

  it("is view-only without planner rights: no menus, no project action", async () => {
    renderGrid(false);
    const t = await table();
    expect(
      screen.getByText("View only — updating these checks needs planner rights on this campaign."),
    ).toBeInTheDocument();
    expect(within(t).queryAllByRole("button")).toHaveLength(0);
    // The cells still read out their status.
    expect(
      within(rowOf(t, "OGBO ADTU-1")).getByRole("img", { name: /^Approved FDP\/IP for OGBO ADTU-1: Behind/ }),
    ).toBeInTheDocument();
    expect(puts).toHaveLength(0);
  });
});
