import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";

import { ActivityFormDialog } from "@/components/data-grid/ActivityFormDialog";
import { ImportDialog } from "@/components/chart/ImportDialog";

// When a campaign has a revision awaiting approval its plan is locked; the backend
// 423s adds/imports, so the toolbar disables those triggers up front rather than
// letting the user fill a form that will be rejected.
describe("plan lock disables the toolbar actions", () => {
  it("disables the Add Activity trigger when locked, enables it otherwise", () => {
    const { unmount } = render(
      <ActivityFormDialog projectId="p1" onCreated={() => {}} locked />,
    );
    expect(screen.getByRole("button", { name: /add activity/i })).toBeDisabled();
    unmount();

    render(<ActivityFormDialog projectId="p1" onCreated={() => {}} />);
    expect(screen.getByRole("button", { name: /add activity/i })).toBeEnabled();
  });

  it("disables the Import trigger when locked, enables it otherwise", () => {
    const { unmount } = render(
      <ImportDialog projectId="p1" onImported={() => {}} locked />,
    );
    expect(screen.getByRole("button", { name: /import csv/i })).toBeDisabled();
    unmount();

    render(<ImportDialog projectId="p1" onImported={() => {}} />);
    expect(screen.getByRole("button", { name: /import csv/i })).toBeEnabled();
  });
});
