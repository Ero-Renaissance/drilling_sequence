import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ImportDialog } from "@/components/chart/ImportDialog";
import * as api from "@/api/activities";
import type { ImportResult } from "@/api/activities";

vi.mock("@/api/activities", async (orig) => ({
  ...(await orig<typeof import("@/api/activities")>()),
  importActivities: vi.fn(),
  downloadImportTemplate: vi.fn(),
}));

const base: ImportResult = {
  imported: 0,
  replaced: true,
  skipped: 0,
  skipped_rows: [],
  warnings: [],
  dry_run: false,
  unknown_types: [],
  applied_mappings: [],
};

async function selectFile() {
  const input = screen.getByTestId("file-input") as HTMLInputElement;
  await userEvent.upload(input, new File(["x"], "schedule.csv", { type: "text/csv" }));
}

beforeEach(() => vi.clearAllMocks());

describe("ImportDialog activity-type mapping", () => {
  it("commits straight through when the dry run finds no unknown types", async () => {
    vi.mocked(api.importActivities)
      .mockResolvedValueOnce({ ...base, dry_run: true }) // dry run: clean
      .mockResolvedValueOnce({ ...base, imported: 3 }); // real import
    render(<ImportDialog projectId="p1" onImported={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /import csv/i }));
    await selectFile();
    await userEvent.click(screen.getByRole("button", { name: "Import" }));

    await waitFor(() => expect(screen.getByText(/3 wells imported/)).toBeInTheDocument());
    // Two calls: dry run, then the real commit — no mapping step shown.
    expect(api.importActivities).toHaveBeenCalledTimes(2);
    expect(api.importActivities).toHaveBeenNthCalledWith(1, "p1", expect.any(File), true, {
      dryRun: true,
    });
    expect(screen.queryByTestId("confirm-mapping")).not.toBeInTheDocument();
  });

  it("shows the mapping step for unknown types and commits the chosen mapping", async () => {
    vi.mocked(api.importActivities)
      .mockResolvedValueOnce({
        ...base,
        dry_run: true,
        unknown_types: [{ value: "Gas Dvelopment", rows: 4 }],
      })
      .mockResolvedValueOnce({
        ...base,
        imported: 4,
        applied_mappings: [{ source: "Gas Dvelopment", target: "Gas Development", rows: 4 }],
      });
    render(<ImportDialog projectId="p1" onImported={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /import csv/i }));
    await selectFile();
    await userEvent.click(screen.getByRole("button", { name: "Import" }));

    // Mapping step appears — nothing imported yet.
    await waitFor(() =>
      expect(screen.getByText(/Map unrecognised activity types/)).toBeInTheDocument(),
    );
    await userEvent.selectOptions(
      screen.getByTestId("map-select-Gas Dvelopment"),
      "Gas Development",
    );
    await userEvent.click(screen.getByTestId("remember-Gas Dvelopment"));
    await userEvent.click(screen.getByTestId("confirm-mapping"));

    await waitFor(() => expect(screen.getByText(/4 wells imported/)).toBeInTheDocument());
    // The real commit carried the mapping + remember choice.
    expect(api.importActivities).toHaveBeenNthCalledWith(2, "p1", expect.any(File), true, {
      mapping: { mappings: { "Gas Dvelopment": "Gas Development" }, remember: ["Gas Dvelopment"] },
    });
    // The results view reports the applied mapping.
    expect(screen.getByText(/Gas Development/)).toBeInTheDocument();
  });

  it("keep-as-is imports verbatim — no mapping sent for that value", async () => {
    vi.mocked(api.importActivities)
      .mockResolvedValueOnce({
        ...base,
        dry_run: true,
        unknown_types: [{ value: "Riser Repair", rows: 1 }],
      })
      .mockResolvedValueOnce({ ...base, imported: 1 });
    render(<ImportDialog projectId="p1" onImported={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /import csv/i }));
    await selectFile();
    await userEvent.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() => expect(screen.getByTestId("confirm-mapping")).toBeInTheDocument());
    // Leave the select on "Keep as-is" (default) and commit.
    await userEvent.click(screen.getByTestId("confirm-mapping"));
    await waitFor(() => expect(screen.getByText(/1 well imported/)).toBeInTheDocument());
    expect(api.importActivities).toHaveBeenNthCalledWith(2, "p1", expect.any(File), true, {
      mapping: { mappings: {}, remember: [] },
    });
  });
});
