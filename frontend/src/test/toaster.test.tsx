import { render, screen, act, fireEvent } from "@testing-library/react";
import { describe, it, expect } from "vitest";

import { Toaster, toast } from "@/components/ui/toaster";

describe("Toaster", () => {
  it("shows an error toast and lets the user dismiss it", async () => {
    render(<Toaster />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    act(() => {
      toast.error("Revision awaiting approval — locked");
    });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Revision awaiting approval — locked");

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
