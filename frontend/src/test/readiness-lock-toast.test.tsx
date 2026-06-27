import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";

vi.mock("@/lib/auth", () => ({
  getAccessToken: async () => "test-token",
  msalInstance: { getAllAccounts: () => [], logoutRedirect: vi.fn() },
  loginRequest: {},
}));

import { ReadinessGrid } from "@/components/readiness/ReadinessGrid";
import { Toaster } from "@/components/ui/toaster";
import { server } from "./mocks/server";

const routerFuture = { v7_startTransition: true, v7_relativeSplatPath: true };
const PROJECT_ID = "cccccccc-0000-0000-0000-000000000001";

describe("Readiness change while the campaign is locked", () => {
  it("toasts the server's lock message when the change is rejected (423)", async () => {
    // The plan is locked for approval — the API rejects readiness edits with 423.
    server.use(
      http.put(
        "/api/projects/:projectId/activities/:activityId/readiness/:checkCode",
        () =>
          HttpResponse.json(
            {
              detail:
                "This activity is part of a revision awaiting approval and cannot be modified.",
            },
            { status: 423 },
          ),
      ),
    );

    render(
      <MemoryRouter future={routerFuture}>
        <ReadinessGrid projectId={PROJECT_ID} />
        <Toaster />
      </MemoryRouter>,
    );
    await waitFor(() => screen.getByText("Gas Development"));

    // Open a gate's picker and choose a new status → triggers the (rejected) PUT.
    await userEvent.click(screen.getAllByTitle(/: On Track$/)[0]);
    await userEvent.click(await screen.findByRole("menuitem", { name: /Behind/i }));

    // The user gets a visible toast carrying the server's reason (previously silent).
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/awaiting approval/);
  });
});
