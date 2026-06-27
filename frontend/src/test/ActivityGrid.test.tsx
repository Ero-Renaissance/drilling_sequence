import { render, screen, waitFor, within } from "@testing-library/react";
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
      expect(screen.getByText("Well")).toBeInTheDocument();
      expect(screen.getByText("Resource Type")).toBeInTheDocument();
      expect(screen.getByText("Resource Name")).toBeInTheDocument();
    });
  });

  it("shows resource type and name for a rig activity", async () => {
    renderGrid();
    await waitFor(() => screen.getByText("Oil Development"));
    // Both fixture rows use a rig: the type cells read "Rig", names show the rig.
    expect(screen.getAllByText("Rig").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Rig Alpha")).toBeInTheDocument();
    expect(screen.getByText("Rig Beta")).toBeInTheDocument();
  });

  it("switches a resource from Rig to HWU via the type column", async () => {
    renderGrid();
    await waitFor(() => screen.getByText("Oil Development"));

    // Open a row's Resource Type cell (reads "Rig") and switch it to HWU.
    await userEvent.click(screen.getAllByText("Rig")[0]);
    await userEvent.selectOptions(screen.getByDisplayValue("Rig"), "HWU");
    await userEvent.tab(); // blur commits the change

    await waitFor(() => {
      // Type now reads HWU; the name carried over to the HWU field.
      expect(screen.getAllByText("HWU").length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText("Rig Alpha")).toBeInTheDocument();
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
    const dialog = within(screen.getByRole("dialog"));

    await userEvent.type(dialog.getByLabelText(/activity type/i), "Water Injection");
    await userEvent.type(dialog.getByLabelText(/start date/i), "2026-07-01");
    await userEvent.type(dialog.getByLabelText(/end date/i), "2026-09-30");
    await userEvent.type(dialog.getByLabelText(/well name/i), "Well-Z9");
    await userEvent.selectOptions(dialog.getByLabelText(/location/i), "OFFSHORE");
    await userEvent.selectOptions(dialog.getByLabelText(/plan type/i), "Firm");
    await userEvent.selectOptions(dialog.getByLabelText(/^risk/i), "No Flood Risk");
    // This activity needs no rig/HWU.
    await userEvent.click(dialog.getByLabelText(/no resource needed/i));

    await userEvent.click(dialog.getByRole("button", { name: /^add activity$/i }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("blocks creation until the required fields are filled", async () => {
    renderGrid();
    await waitFor(() => screen.getByText("Oil Development"));

    await userEvent.click(screen.getByRole("button", { name: /add activity/i }));
    // Submit with everything blank.
    await userEvent.click(screen.getByRole("button", { name: /^add activity$/i }));

    // Dialog stays open and shows required-field errors.
    await waitFor(() =>
      expect(screen.getAllByText("Required").length).toBeGreaterThanOrEqual(1),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
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
