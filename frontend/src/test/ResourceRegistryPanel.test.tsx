import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({
  getAccessToken: async () => "test-token",
  msalInstance: { getAllAccounts: () => [], logoutRedirect: vi.fn() },
  loginRequest: {},
}));

const listResources = vi.fn();
const updateResource = vi.fn();
const renameResource = vi.fn();
vi.mock("@/api/resources", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/resources")>();
  return {
    ...actual,
    listResources: (...a: unknown[]) => listResources(...a),
    updateResource: (...a: unknown[]) => updateResource(...a),
    renameResource: (...a: unknown[]) => renameResource(...a),
  };
});
vi.mock("@/api/contracts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/contracts")>();
  return { ...actual, listContracts: vi.fn(async () => CONTRACTS), upsertContract: vi.fn() };
});
vi.mock("@/api/hwu-contracts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/hwu-contracts")>();
  return { ...actual, listHwuContracts: vi.fn(async () => []), upsertHwuContract: vi.fn() };
});

import { ResourceRegistryPanel } from "@/components/resources/ResourceRegistryPanel";
import type { ResourceRecord } from "@/api/resources";
import type { RigContract } from "@/api/contracts";

function unit(over: Partial<ResourceRecord>): ResourceRecord {
  return {
    id: "r?",
    project_id: "p",
    kind: "rig",
    terrain: "LAND",
    name: "Rig",
    capability_class: null,
    is_placeholder: false,
    updated_at: "2026-07-01T00:00:00Z",
    ...over,
  };
}

const UNITS: ResourceRecord[] = [
  unit({ id: "r1", terrain: "LAND", name: "10K Rig 1", capability_class: "10K", is_placeholder: true }),
  unit({ id: "r2", terrain: "SWAMP", name: "10K Rig 1" }),
  unit({ id: "r3", terrain: "OFFSHORE", name: "15K Jack-up" }),
  unit({ id: "h1", kind: "hwu", terrain: "", name: "HWU-1" }),
];

// Always ~30 days out relative to the suite's run date → always "critical".
const CRITICAL_END = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);

// The SWAMP unit has a healthy contract; the OFFSHORE unit's is at risk; the
// LAND slot has none (it's unprocured).
const CONTRACTS: RigContract[] = [
  {
    id: "c1",
    project_id: "p",
    rig_name: "10K Rig 1",
    terrain: "SWAMP",
    contract_start: null,
    contract_end: "2031-01-01",
    notes: null,
    updated_at: "2026-07-01T00:00:00Z",
  },
  {
    id: "c2",
    project_id: "p",
    rig_name: "15K Jack-up",
    terrain: "OFFSHORE",
    contract_start: null,
    contract_end: CRITICAL_END,
    notes: null,
    updated_at: "2026-07-01T00:00:00Z",
  },
];

function tab(name: RegExp) {
  return screen.getByRole("button", { name });
}

describe("ResourceRegistryPanel", () => {
  beforeEach(() => {
    listResources.mockReset().mockResolvedValue(UNITS);
    updateResource.mockReset().mockResolvedValue(UNITS[0]);
    renameResource.mockReset().mockResolvedValue({ ...UNITS[0], name: "T209" });
  });

  it("puts terrain twins on their own tabs, with counts in the strip", async () => {
    render(<ResourceRegistryPanel projectId="p" canEdit />);
    // Lands on the first tab with units (Land) showing the land twin + TBD badge.
    expect(await screen.findByText("10K Rig 1")).toBeInTheDocument();
    expect(screen.getByTitle(/placeholder slot — planned capacity/i)).toHaveTextContent("TBD");
    // A TBD slot's missing contract is EXPECTED (muted), not an alarm.
    expect(screen.getByTitle(/expected — the slot isn't procured yet/i)).toHaveTextContent(
      "No contract",
    );

    // The swamp twin lives on its own tab, carrying its own contract.
    fireEvent.click(tab(/Swamp/));
    expect(screen.getByText("10K Rig 1")).toBeInTheDocument();
    expect(screen.getByText(/ends 2031-01-01/)).toBeInTheDocument();
    expect(screen.queryByText("No contract")).not.toBeInTheDocument();

    // A PROCURED unit without a contract is the real data gap — flagged.
    fireEvent.click(tab(/HWUs/));
    expect(screen.getByText("HWU-1")).toBeInTheDocument();
    expect(
      screen.getByTitle(/procured unit with no contract on file/i),
    ).toHaveTextContent("No contract");
  });

  it("always shows the HWUs tab, with an explanatory empty state", async () => {
    listResources.mockResolvedValue(UNITS.filter((u) => u.kind === "rig"));
    render(<ResourceRegistryPanel projectId="p" canEdit />);
    await screen.findByText("10K Rig 1");
    fireEvent.click(tab(/HWUs/));
    expect(screen.getByText(/No HWUs in this campaign yet/i)).toBeInTheDocument();
  });

  it("search scopes across ALL tabs — matches can't hide behind the active tab", async () => {
    render(<ResourceRegistryPanel projectId="p" canEdit />);
    await screen.findByText("10K Rig 1"); // on Land
    fireEvent.change(screen.getByLabelText("Search fleet"), { target: { value: "HWU" } });
    // Active (Land) tab has no match, but the empty state points at the others…
    expect(screen.getByText(/1 on other tabs/i)).toBeInTheDocument();
    expect(screen.getByText(/1 of 4 units match/)).toBeInTheDocument();
    // …and the HWUs tab shows the match.
    fireEvent.click(tab(/HWUs/));
    expect(screen.getByText("HWU-1")).toBeInTheDocument();
  });

  it("initialTbdOnly (dashboard drill-through) lands filtered on a TBD tab", async () => {
    render(<ResourceRegistryPanel projectId="p" canEdit initialTbdOnly />);
    // Only the LAND slot is TBD → lands on Land showing just it.
    expect(await screen.findByText("10K Rig 1")).toBeInTheDocument();
    expect(screen.getByText(/1 of 4 units match/)).toBeInTheDocument();
    fireEvent.click(tab(/Swamp/));
    expect(screen.queryByText("10K Rig 1")).not.toBeInTheDocument(); // procured twin filtered out
  });

  it("initialAtRiskOnly (contracts drill-through) lands on the at-risk unit", async () => {
    render(<ResourceRegistryPanel projectId="p" canEdit initialAtRiskOnly />);
    // Only the OFFSHORE unit's contract is at risk → lands on Offshore showing it.
    expect(await screen.findByText("15K Jack-up")).toBeInTheDocument();
    expect(screen.getByText(/1 of 4 units match/)).toBeInTheDocument();
    expect(screen.getByText(/Critical/)).toBeInTheDocument();
    // The healthy swamp contract is filtered out of its tab.
    fireEvent.click(tab(/Swamp/));
    expect(screen.queryByText("10K Rig 1")).not.toBeInTheDocument();
  });

  it("collapses a long tab behind a Show all expander", async () => {
    listResources.mockResolvedValue(
      Array.from({ length: 30 }, (_, i) =>
        unit({ id: `x${i}`, name: `Rig ${String(i).padStart(2, "0")}` }),
      ),
    );
    render(<ResourceRegistryPanel projectId="p" canEdit />);
    await screen.findByText("Rig 00");
    expect(screen.queryByText("Rig 29")).not.toBeInTheDocument(); // beyond the fold
    fireEvent.click(screen.getByRole("button", { name: /show all \(30\)/i }));
    expect(screen.getByText("Rig 29")).toBeInTheDocument();
  });

  it("rename-on-award posts the new name for the right unit", async () => {
    render(<ResourceRegistryPanel projectId="p" canEdit />);
    await screen.findByText("10K Rig 1"); // Land tab → the LAND twin (r1)

    fireEvent.click(screen.getByRole("button", { name: /rename/i }));
    const input = screen.getByLabelText("New name for LAND – 10K Rig 1");
    fireEvent.change(input, { target: { value: "T209" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(renameResource).toHaveBeenCalledWith("p", "r1", "T209"));
    // The list reloads so the matured name (and cleared TBD) comes from the server.
    await waitFor(() => expect(listResources).toHaveBeenCalledTimes(2));
  });

  it("opens the standalone contract editor from the row", async () => {
    render(<ResourceRegistryPanel projectId="p" canEdit />);
    await screen.findByText("10K Rig 1");
    fireEvent.click(screen.getByRole("button", { name: "Contract" }));
    // The editor loads (debounced) and carries its own standalone Save.
    expect(await screen.findByText(/10K Rig 1.s contract/)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /save contract/i })).toBeInTheDocument(),
    );
  });

  it("hides edit affordances for read-only users but keeps the contract viewer", async () => {
    render(<ResourceRegistryPanel projectId="p" canEdit={false} />);
    await screen.findByText("10K Rig 1");
    expect(screen.queryByRole("button", { name: /rename/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /mark/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Contract" })).toBeInTheDocument();
  });
});
