import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { logger } from "@/lib/logger";

function Boom(): never {
  throw new Error("kaboom");
}

describe("ErrorBoundary", () => {
  it("renders a fallback and logs when a child throws", () => {
    const log = vi.spyOn(logger, "error").mockImplementation(() => {});
    // React prints the caught error to console.error — silence it for a clean run.
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(/something went wrong/i);
    expect(log).toHaveBeenCalledWith(
      "React render error",
      expect.objectContaining({ name: "Error" }),
    );

    consoleErr.mockRestore();
    log.mockRestore();
  });

  it("renders children when there is no error", () => {
    render(
      <ErrorBoundary>
        <p>all good</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText("all good")).toBeInTheDocument();
  });
});
