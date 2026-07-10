import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { createRef } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({
  getAccessToken: async () => "test-token",
  msalInstance: { getAllAccounts: () => [], logoutRedirect: vi.fn() },
  loginRequest: {},
}));

const listContracts = vi.fn();
const upsertContract = vi.fn();
const deleteContract = vi.fn();
vi.mock("@/api/contracts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/contracts")>();
  return {
    ...actual,
    listContracts: (...a: unknown[]) => listContracts(...a),
    upsertContract: (...a: unknown[]) => upsertContract(...a),
    deleteContract: (...a: unknown[]) => deleteContract(...a),
  };
});
vi.mock("@/api/hwu-contracts", () => ({
  listHwuContracts: vi.fn(async () => []),
  upsertHwuContract: vi.fn(),
  deleteHwuContract: vi.fn(),
}));

import {
  ResourceContractSection,
  type ResourceContractHandle,
} from "@/components/readiness/ResourceContractSection";
import type { RigContract } from "@/api/contracts";

const RIG: RigContract = {
  id: "c1",
  project_id: "p",
  rig_name: "Rig-1",
  terrain: "",
  contract_start: "2026-01-01",
  contract_end: "2026-12-31",
  notes: "Daily $100k",
  updated_at: "2026-06-01T08:00:00Z",
};

describe("ResourceContractSection", () => {
  beforeEach(() => {
    listContracts.mockReset();
    upsertContract.mockReset();
    deleteContract.mockReset();
  });

  it("save() is a no-op when untouched, and upserts the edited values otherwise", async () => {
    listContracts.mockResolvedValue([RIG]);
    upsertContract.mockResolvedValue(RIG);
    const ref = createRef<ResourceContractHandle>();
    render(<ResourceContractSection ref={ref} projectId="p" resourceName="Rig-1" kind="rig" />);
    await waitFor(() => expect(screen.getByDisplayValue("2026-12-31")).toBeInTheDocument());

    // Untouched → a plain activity save must NOT rewrite the contract.
    await act(async () => {
      await ref.current!.save();
    });
    expect(upsertContract).not.toHaveBeenCalled();

    // Edit the end date → save() now persists it.
    fireEvent.change(screen.getByDisplayValue("2026-12-31"), { target: { value: "2027-06-30" } });
    await act(async () => {
      await ref.current!.save();
    });
    expect(upsertContract).toHaveBeenCalledWith(
      "p",
      "Rig-1",
      expect.objectContaining({ contract_end: "2027-06-30" }),
    );
  });

  it("save() rejects an end-less edit — a contract IS its end date", async () => {
    listContracts.mockResolvedValue([RIG]);
    const ref = createRef<ResourceContractHandle>();
    render(<ResourceContractSection ref={ref} projectId="p" resourceName="Rig-1" kind="rig" />);
    await waitFor(() => expect(screen.getByDisplayValue("2026-12-31")).toBeInTheDocument());

    fireEvent.change(screen.getByDisplayValue("2026-12-31"), { target: { value: "" } });
    await expect(
      act(async () => {
        await ref.current!.save();
      }),
    ).rejects.toThrow(/end date|Remove contract/i);
    expect(upsertContract).not.toHaveBeenCalled();
  });

  it("standalone: Remove contract deletes after an inline confirm", async () => {
    listContracts.mockResolvedValue([RIG]);
    deleteContract.mockResolvedValue(undefined);
    render(
      <ResourceContractSection projectId="p" resourceName="Rig-1" kind="rig" standalone />,
    );
    await waitFor(() => expect(screen.getByDisplayValue("2026-12-31")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /remove contract/i }));
    // Nothing deleted until the confirm click.
    expect(deleteContract).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /confirm remove/i }));
    // Terrain rides along (null here — no terrain prop) so the server can tell
    // WHICH physical rig when twins both carry contracts.
    await waitFor(() => expect(deleteContract).toHaveBeenCalledWith("p", "Rig-1", null));
    // The row reverts to an honest empty form.
    expect(screen.queryByDisplayValue("2026-12-31")).not.toBeInTheDocument();
  });

  it("save() called before the load lands does not wipe the contract", async () => {
    listContracts.mockResolvedValue([RIG]);
    const ref = createRef<ResourceContractHandle>();
    render(<ResourceContractSection ref={ref} projectId="p" resourceName="Rig-1" kind="rig" />);
    // Save immediately — the debounced load hasn't run and nothing was edited.
    await act(async () => {
      await ref.current!.save();
    });
    expect(upsertContract).not.toHaveBeenCalled();
  });

  it("is read-only when locked", async () => {
    listContracts.mockResolvedValue([RIG]);
    render(<ResourceContractSection projectId="p" resourceName="Rig-1" kind="rig" locked />);
    await waitFor(() => expect(screen.getByDisplayValue("2026-12-31")).toBeInTheDocument());
    expect(screen.getByDisplayValue("2026-12-31")).toBeDisabled();
  });
});
