import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";

import { ChartLegend } from "@/components/chart/ChartLegend";

describe("ChartLegend — contract expiry", () => {
  it("shows the approaching-expiry keys (worst first), but never Healthy", () => {
    render(<ChartLegend activityTypes={["Drilling"]} showContractExpiry />);

    // The interactive Gantt flags the whole approaching gradient…
    expect(screen.getByText("Expired")).toBeInTheDocument();
    expect(screen.getByText("Critical")).toBeInTheDocument();
    expect(screen.getByText("Expiring soon")).toBeInTheDocument();
    // …but a Healthy marker would appear on every rig and mean nothing.
    expect(screen.queryByText("Healthy")).not.toBeInTheDocument();
  });

  it("omits the contract-expiry section entirely when not requested", () => {
    render(<ChartLegend activityTypes={["Drilling"]} />);
    expect(screen.queryByText("Expired")).not.toBeInTheDocument();
  });
});
