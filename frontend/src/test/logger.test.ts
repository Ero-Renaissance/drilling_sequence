import { describe, it, expect, vi, afterEach } from "vitest";

import { logger, setLogSink } from "@/lib/logger";

afterEach(() => setLogSink(null));

describe("logger sink", () => {
  it("ships error-level events to the installed sink", () => {
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
    const sink = vi.fn();
    setLogSink(sink);

    logger.error("boom", { a: 1 });

    expect(sink).toHaveBeenCalledWith("error", "boom", { a: 1 });
    consoleErr.mockRestore();
  });

  it("does not ship warn or info to the sink", () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});
    const sink = vi.fn();
    setLogSink(sink);

    logger.warn("meh");
    logger.info("fyi");

    expect(sink).not.toHaveBeenCalled();
    consoleWarn.mockRestore();
    consoleInfo.mockRestore();
  });

  it("never lets a throwing sink break the caller", () => {
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
    setLogSink(() => {
      throw new Error("sink down");
    });

    expect(() => logger.error("boom")).not.toThrow();
    consoleErr.mockRestore();
  });
});
