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

  it("shows Review button for pending revision", async () => {
    renderList();
    await waitFor(() => {
      expect(screen.getByTestId("review-revision")).toBeInTheDocument();
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

  it("review button links to the revision detail page", async () => {
    // Signing moved off the list into the review-then-decide detail page; the
    // list's affordance is a link to that page.
    renderList();
    const reviewLink = await screen.findByTestId("review-revision");
    expect(reviewLink.getAttribute("href")).toContain(
      `/projects/${PROJECT_ID}/revisions/`,
    );
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
      expect(screen.getByText(/activities locked/i)).toBeInTheDocument();
    });
  });
});
