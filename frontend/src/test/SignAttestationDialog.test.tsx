import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SignAttestationDialog } from "@/components/revisions/SignAttestationDialog";

function setup(stage: "approval" | "review" = "approval") {
  const onConfirm = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <SignAttestationDialog
      open
      stage={stage}
      revLabel="Rev. 02"
      loading={false}
      onOpenChange={onOpenChange}
      onConfirm={onConfirm}
    />,
  );
  return { onConfirm, onOpenChange };
}

describe("SignAttestationDialog", () => {
  it("keeps signing disabled until the attestation is ticked", async () => {
    const { onConfirm } = setup();
    const confirm = screen.getByTestId("attestation-confirm");
    expect(confirm).toBeDisabled();
    await userEvent.click(confirm).catch(() => {}); // disabled — no-op
    expect(onConfirm).not.toHaveBeenCalled();

    await userEvent.click(screen.getByTestId("attestation-checkbox"));
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("shows the stage-appropriate declaration", () => {
    setup("review");
    expect(
      screen.getByText(/I endorse the plan captured in this revision/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Endorse & Sign — Rev\. 02/)).toBeInTheDocument();
  });

  it("states the approval declaration for the revision", () => {
    setup("approval");
    expect(
      screen.getByText(/I approve the plan captured in this revision/i),
    ).toBeInTheDocument();
  });
});
