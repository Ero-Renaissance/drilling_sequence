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
vi.mock("@/api/contracts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/contracts")>();
  return {
    ...actual,
    listContracts: (...a: unknown[]) => listContracts(...a),
    upsertContract: (...a: unknown[]) => upsertContract(...a),
  };
});
vi.mock("@/api/hwu-contracts", () => ({
  listHwuContracts: vi.fn(async () => []),
  upsertHwuContract: vi.fn(),
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
  status: "Completed",
  contract_start: "2026-01-01",
  contract_end: "2026-12-31",
  notes: "Daily $100k",
  updated_at: "2026-06-01T08:00:00Z",
};

describe("ResourceContractSection", () => {
  beforeEach(() => {
    listContracts.mockReset();
    upsertContract.mockReset();
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
      expect.objectContaining({ status: "Completed", contract_end: "2027-06-30" }),
    );
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
    expect(screen.getByRole("button", { name: "Completed" })).toBeDisabled();
  });
});
