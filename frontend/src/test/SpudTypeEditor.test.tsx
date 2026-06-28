import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

import { SpudTypeEditor } from "@/components/dashboard/SpudTypeEditor";

describe("SpudTypeEditor", () => {
  it("reflects each type's effective class and emits an override on click", () => {
    const onChange = vi.fn();
    render(
      <SpudTypeEditor types={["Oil Development", "Well Testing"]} value={{}} onChange={onChange} />,
    );

    expect(screen.getByText("Oil Development")).toBeInTheDocument();
    expect(screen.getByText("Well Testing")).toBeInTheDocument();

    // Oil Development defaults to oil; Well Testing defaults to exclude.
    const oilButtons = screen.getAllByRole("button", { name: "Oil" });
    expect(oilButtons[0]).toHaveAttribute("aria-pressed", "true");
    const excludeButtons = screen.getAllByRole("button", { name: "Exclude" });
    expect(excludeButtons[1]).toHaveAttribute("aria-pressed", "true");

    // Reclassify Well Testing as Gas → parent gets the override map.
    fireEvent.click(screen.getAllByRole("button", { name: "Gas" })[1]);
    expect(onChange).toHaveBeenCalledWith({ "Well Testing": "gas" });
  });

  it("shows a placeholder when there are no types yet", () => {
    render(<SpudTypeEditor types={[]} value={{}} onChange={vi.fn()} />);
    expect(screen.getByText(/no activity types to classify/i)).toBeInTheDocument();
  });
});
