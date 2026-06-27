import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";

import { ChartLegend } from "@/components/chart/ChartLegend";

describe("ChartLegend — contract expiry (#5)", () => {
  it("shows only the Expired key, not the full urgency gradient", () => {
    render(<ChartLegend activityTypes={["Drilling"]} showContractExpiry />);

    // The Gantt now flags expired contracts only.
    expect(screen.getByText("Expired")).toBeInTheDocument();
    // The gradient states are gone from the legend (they live on the dashboard).
    expect(screen.queryByText("Healthy")).not.toBeInTheDocument();
    expect(screen.queryByText("Expiring soon")).not.toBeInTheDocument();
    expect(screen.queryByText("Critical")).not.toBeInTheDocument();
  });

  it("omits the contract-expiry section entirely when not requested", () => {
    render(<ChartLegend activityTypes={["Drilling"]} />);
    expect(screen.queryByText("Expired")).not.toBeInTheDocument();
  });
});
