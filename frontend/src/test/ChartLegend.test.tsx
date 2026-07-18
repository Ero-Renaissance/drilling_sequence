import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";

import { ChartLegend } from "@/components/chart/ChartLegend";

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
