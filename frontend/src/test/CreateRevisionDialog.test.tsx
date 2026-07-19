import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";

vi.mock("@/lib/auth", () => ({
  getAccessToken: async () => "test-token",
  msalInstance: { getAllAccounts: () => [], logoutRedirect: vi.fn() },
  loginRequest: {},
}));

import { CreateRevisionDialog } from "@/components/revisions/CreateRevisionDialog";
import { server } from "./mocks/server";

const routerFuture = { v7_startTransition: true, v7_relativeSplatPath: true };

describe("CreateRevisionDialog", () => {
  it("links a scheduling-conflict 409 straight to the conflicts queue", async () => {
    server.use(
      http.post("/api/projects/:projectId/revisions", () =>
        HttpResponse.json(
          {
            detail:
              "Scheduling conflict: LAND – Rig 9 is double-booked — WELL_A overlaps WELL_B by 28 days (and 2 more). Resolve the overlaps before submitting.",
          },
          { status: 409 },
        ),
      ),
    );

    render(
      <MemoryRouter future={routerFuture}>
        <CreateRevisionDialog projectId="p1" onCreated={() => {}} />
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole("button", { name: /create revision/i }));
    await userEvent.click(await screen.findByRole("button", { name: /^create revision$/i }));

    expect(await screen.findByText(/Scheduling conflict: LAND – Rig 9/)).toBeInTheDocument();
    const link = screen.getByTestId("view-conflicts-link");
    expect(link).toHaveAttribute("href", "/projects/p1/data?focus=conflicts");
  });
});
