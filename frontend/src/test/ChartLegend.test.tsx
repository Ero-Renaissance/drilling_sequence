import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";

import { ChartLegend } from "@/components/chart/ChartLegend";
import type { CatalogCheck } from "@/api/readiness";
import {
  BUILTIN_PROJECT_GATES,
  FrozenCatalogProvider,
  ReadinessLensProvider,
} from "@/components/readiness/catalog";

describe("ChartLegend — contract expiration", () => {
  it("shows one fact-based key — no urgency tiers", () => {
    render(<ChartLegend activityTypes={["Drilling"]} showContractExpiry />);

    // The marker states the date; it is not an alarm gradient. One key row —
    // the red badge plus four words — and nothing else.
    expect(screen.getByText("Contract expiration date")).toBeInTheDocument();
    expect(screen.queryByText("Critical")).not.toBeInTheDocument();
    expect(screen.queryByText("Expiring soon")).not.toBeInTheDocument();
    expect(screen.queryByText("Expired")).not.toBeInTheDocument();
  });

  it("omits the contract-expiration section entirely when not requested", () => {
    render(<ChartLegend activityTypes={["Drilling"]} />);
    expect(screen.queryByText("Contract expiration date")).not.toBeInTheDocument();
  });
});

// ── Which statuses the legend keys (phase 6, spec §8.4) ──────────────────────

describe("ChartLegend — readiness statuses", () => {
  const PO: CatalogCheck = {
    code: "PO", label: "Purchase Order", team_code: "logistics", applies_project: true, applies_well: true,
    status_set: "standard", icon_key: "receipt", locks_with_plan: false, sort_order: 10,
  };

  function statusKey(lens: string): string {
    render(
      <FrozenCatalogProvider checks={[...BUILTIN_PROJECT_GATES, PO]}>
        <ReadinessLensProvider lens={lens}>
          <ChartLegend activityTypes={["Drilling"]} />
        </ReadinessLensProvider>
      </FrozenCatalogProvider>,
    );
    return screen.getByText("Status").closest("div")!.textContent ?? "";
  }

  it("a team lens keys no N/A — an unticked check isn't drawn at all", () => {
    expect(statusKey("logistics")).toBe("StatusOn TrackBehindCompleted");
  });

  it("the Project gates keep N/A, drawn grey", () => {
    expect(statusKey("projects")).toBe("StatusOn TrackBehindCompletedN/A");
  });

  it("the All lens keeps N/A — its Project gates badge can be grey", () => {
    expect(statusKey("all")).toContain("N/A");
  });
});
