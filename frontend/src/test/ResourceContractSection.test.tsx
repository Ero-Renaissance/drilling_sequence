import { render, screen, waitFor, fireEvent } from "@testing-library/react";
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

import { ResourceContractSection } from "@/components/readiness/ResourceContractSection";
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

  it("loads the resource's contract and saves edits via upsert", async () => {
    listContracts.mockResolvedValue([RIG]);
    upsertContract.mockResolvedValue(RIG);
    render(<ResourceContractSection projectId="p" resourceName="Rig-1" kind="rig" />);

    // Debounced load → the contract end populates.
    await waitFor(() => expect(screen.getByDisplayValue("2026-12-31")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /save contract/i }));
    await waitFor(() =>
      expect(upsertContract).toHaveBeenCalledWith(
        "p",
        "Rig-1",
        expect.objectContaining({ status: "Completed", contract_end: "2026-12-31" }),
      ),
    );
  });

  it("is read-only when locked — no save button", async () => {
    listContracts.mockResolvedValue([RIG]);
    render(<ResourceContractSection projectId="p" resourceName="Rig-1" kind="rig" locked />);
    await waitFor(() => expect(screen.getByDisplayValue("2026-12-31")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /save contract/i })).not.toBeInTheDocument();
  });
});
