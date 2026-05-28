import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("@/lib/auth", () => ({
  getAccessToken: async () => "test-token",
  msalInstance: { getAllAccounts: () => [], logoutRedirect: vi.fn() },
  loginRequest: {},
}));

import { RevisionList } from "@/components/revisions/RevisionList";

const routerFuture = { v7_startTransition: true, v7_relativeSplatPath: true };
const PROJECT_ID = "cccccccc-0000-0000-0000-000000000001";

function renderList() {
  return render(
    <MemoryRouter
      future={routerFuture}
      initialEntries={[`/projects/${PROJECT_ID}/signatures`]}
    >
      <Routes>
        <Route
          path="/projects/:projectId/signatures"
          element={<RevisionList projectId={PROJECT_ID} />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("RevisionList", () => {
  it("shows Create Revision button", async () => {
    renderList();
    expect(screen.getByRole("button", { name: /create revision/i })).toBeInTheDocument();
  });

  it("loads and displays revisions from API", async () => {
    renderList();
    await waitFor(() => {
      expect(screen.getByText("Rev. 01")).toBeInTheDocument();
    });
  });

  it("shows Pending approval status badge", async () => {
    renderList();
    await waitFor(() => {
      // The StatusBadge renders exactly "Pending approval"
      expect(screen.getByText("Pending approval")).toBeInTheDocument();
    });
  });

  it("shows Sign & Approve button for pending revision", async () => {
    renderList();
    await waitFor(() => {
      expect(screen.getByTestId("sign-revision")).toBeInTheDocument();
    });
  });

  it("shows Discard button for pending revision", async () => {
    renderList();
    await waitFor(() => {
      expect(screen.getByTestId("discard-revision")).toBeInTheDocument();
    });
  });

  it("shows Create Revision dialog when button clicked", async () => {
    renderList();
    await userEvent.click(screen.getByRole("button", { name: /create revision/i }));
    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(screen.getByText(/revision snapshot/i)).toBeInTheDocument();
    });
  });

  it("signs a revision and shows approved status", async () => {
    renderList();
    await waitFor(() => screen.getByTestId("sign-revision"));

    await userEvent.click(screen.getByTestId("sign-revision"));

    await waitFor(() => {
      expect(screen.getByText(/approved/i)).toBeInTheDocument();
    });
  });

  it("shows created_by_name in revision card", async () => {
    renderList();
    await waitFor(() => {
      expect(screen.getByText(/test user/i)).toBeInTheDocument();
    });
  });

  it("shows locked activities warning when pending revision exists", async () => {
    renderList();
    await waitFor(() => {
      expect(screen.getByText(/activities are locked/i)).toBeInTheDocument();
    });
  });
});
