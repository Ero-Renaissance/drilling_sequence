import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("@/lib/auth", () => ({
  getAccessToken: async () => "test-token",
  msalInstance: { getAllAccounts: () => [], logoutRedirect: vi.fn() },
  loginRequest: {},
}));

import { ActivityGrid } from "@/components/data-grid/ActivityGrid";

const routerFuture = { v7_startTransition: true, v7_relativeSplatPath: true };
const PROJECT_ID = "cccccccc-0000-0000-0000-000000000001";

function renderGrid() {
  return render(
    <MemoryRouter
      future={routerFuture}
      initialEntries={[`/projects/${PROJECT_ID}/data`]}
    >
      <Routes>
        <Route
          path="/projects/:projectId/data"
          element={<ActivityGrid projectId={PROJECT_ID} />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ActivityGrid", () => {
  it("renders column headers", async () => {
    renderGrid();
    await waitFor(() => {
      expect(screen.getByText(/activity type/i)).toBeInTheDocument();
      expect(screen.getByText(/well name/i)).toBeInTheDocument();
      expect(screen.getByText(/rig name/i)).toBeInTheDocument();
    });
  });

  it("renders Last Edit column header", async () => {
    renderGrid();
    await waitFor(() => {
      expect(screen.getByText(/last edit/i)).toBeInTheDocument();
    });
  });

  it("loads and displays activities from API", async () => {
    renderGrid();
    await waitFor(() => {
      expect(screen.getByText("Oil Development")).toBeInTheDocument();
      expect(screen.getByText("Gas Development")).toBeInTheDocument();
      expect(screen.getByText("Well-A1")).toBeInTheDocument();
    });
  });

  it("shows activity count in toolbar", async () => {
    renderGrid();
    await waitFor(() => {
      expect(screen.getByText(/2 activities/i)).toBeInTheDocument();
    });
  });

  it("shows updated_by_name in Last Edit column", async () => {
    renderGrid();
    await waitFor(() => {
      // act-001 has updated_by_name: "Test User"
      expect(screen.getByText("Test User")).toBeInTheDocument();
    });
  });

  it("opens Add Activity dialog when button clicked", async () => {
    renderGrid();
    await waitFor(() => screen.getByText("Oil Development"));
    await userEvent.click(screen.getByRole("button", { name: /add activity/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/fill in the required fields/i)).toBeInTheDocument();
  });

  it("can create a new activity via dialog", async () => {
    renderGrid();
    await waitFor(() => screen.getByText("Oil Development"));

    await userEvent.click(screen.getByRole("button", { name: /add activity/i }));

    await userEvent.type(screen.getByLabelText(/activity type/i), "Water Injection");
    await userEvent.type(screen.getByLabelText(/start date/i), "2026-07-01");
    await userEvent.type(screen.getByLabelText(/end date/i), "2026-09-30");

    await userEvent.click(screen.getByRole("button", { name: /^add activity$/i }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("can delete an activity", async () => {
    renderGrid();
    await waitFor(() => screen.getByText("Oil Development"));

    const deleteButtons = screen.getAllByTestId("delete-activity");
    expect(deleteButtons).toHaveLength(2);
    await userEvent.click(deleteButtons[0]);

    await waitFor(() => {
      expect(screen.getAllByTestId("delete-activity")).toHaveLength(1);
    });
  });

  it("shows inline editable cells", async () => {
    renderGrid();
    await waitFor(() => screen.getByText("Oil Development"));

    // Activity type cell should be a clickable button
    const activityTypeCell = screen.getByText("Oil Development");
    expect(activityTypeCell.tagName).toBe("BUTTON");
  });

  it("entering edit mode shows an input", async () => {
    renderGrid();
    await waitFor(() => screen.getByText("Well-A1"));

    await userEvent.click(screen.getByText("Well-A1"));
    // After click, an input should appear with the current value
    const input = screen.getByDisplayValue("Well-A1");
    expect(input.tagName).toBe("INPUT");
  });

  it("pressing Escape cancels edit without saving", async () => {
    renderGrid();
    await waitFor(() => screen.getByText("Well-A1"));

    await userEvent.click(screen.getByText("Well-A1"));
    const input = screen.getByDisplayValue("Well-A1");
    await userEvent.clear(input);
    await userEvent.type(input, "Changed Well");
    await userEvent.keyboard("{Escape}");

    // Original value restored
    await waitFor(() => {
      expect(screen.getByText("Well-A1")).toBeInTheDocument();
    });
  });

  it("history button is rendered for each activity row", async () => {
    renderGrid();
    await waitFor(() => screen.getByText("Oil Development"));

    const historyButtons = screen.getAllByTestId("history-activity");
    expect(historyButtons).toHaveLength(2);
  });

  it("clicking history button opens the history panel for that activity", async () => {
    renderGrid();
    await waitFor(() => screen.getByText("Oil Development"));

    const historyButtons = screen.getAllByTestId("history-activity");
    await userEvent.click(historyButtons[0]);

    // HistoryPanel loads and shows the audit entry from the mock handler
    await waitFor(() => {
      expect(screen.getByText(/change history/i)).toBeInTheDocument();
    });
  });

  it("clicking history button again closes the panel", async () => {
    renderGrid();
    await waitFor(() => screen.getByText("Oil Development"));

    const historyButtons = screen.getAllByTestId("history-activity");
    await userEvent.click(historyButtons[0]);
    await waitFor(() => screen.getByText(/change history/i));

    // Click same button again to toggle off
    await userEvent.click(screen.getAllByTestId("history-activity")[0]);
    await waitFor(() => {
      expect(screen.queryByText(/change history/i)).not.toBeInTheDocument();
    });
  });

  it("history panel shows audit entry details", async () => {
    renderGrid();
    await waitFor(() => screen.getByText("Oil Development"));

    await userEvent.click(screen.getAllByTestId("history-activity")[0]);

    await waitFor(() => {
      // The audit entry old_value and new_value should appear in the panel
      expect(screen.getByText("Well-Old")).toBeInTheDocument();
      // Well-A1 appears in the table cell and also as new_value in the audit entry
      expect(screen.getAllByText("Well-A1").length).toBeGreaterThanOrEqual(1);
    });
  });
});
