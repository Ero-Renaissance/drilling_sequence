import { describe, it, expect, beforeEach } from "vitest";

import {
  defaultSpudClass,
  resolveSpudClass,
  loadSpudMap,
  saveSpudMap,
} from "@/lib/spud-classification";

describe("defaultSpudClass", () => {
  it("classifies oil/gas drilling activities as spuds", () => {
    expect(defaultSpudClass("Oil Development")).toBe("oil");
    expect(defaultSpudClass("Oil Appraisal")).toBe("oil");
    expect(defaultSpudClass("Gas Development")).toBe("gas");
    expect(defaultSpudClass("Gas Exploration (including HPHT)")).toBe("gas");
  });

  it("excludes workovers, testing and other non-drilling work", () => {
    expect(defaultSpudClass("Oil Workover")).toBe("exclude");
    expect(defaultSpudClass("Gas Workover")).toBe("exclude");
    expect(defaultSpudClass("Well Testing")).toBe("exclude");
    expect(defaultSpudClass("Water Injection")).toBe("exclude");
    expect(defaultSpudClass("Well Repair/Safety")).toBe("exclude");
  });

  it("excludes a spud it cannot attribute to oil or gas", () => {
    expect(defaultSpudClass("HPHT (Development)")).toBe("exclude");
  });
});

describe("resolveSpudClass", () => {
  it("prefers an explicit override over the name default", () => {
    expect(resolveSpudClass("Oil Development", {})).toBe("oil");
    expect(resolveSpudClass("Oil Development", { "Oil Development": "exclude" })).toBe("exclude");
    expect(resolveSpudClass("Well Testing", { "Well Testing": "gas" })).toBe("gas");
  });
});

describe("loadSpudMap / saveSpudMap", () => {
  beforeEach(() => window.localStorage.clear());

  it("round-trips and drops invalid entries", () => {
    saveSpudMap({ "Oil Development": "gas" });
    expect(loadSpudMap()).toEqual({ "Oil Development": "gas" });

    window.localStorage.setItem("ds.spud-map", JSON.stringify({ A: "oil", B: "nonsense" }));
    expect(loadSpudMap()).toEqual({ A: "oil" });
  });

  it("returns empty on malformed storage", () => {
    window.localStorage.setItem("ds.spud-map", "{not json");
    expect(loadSpudMap()).toEqual({});
  });
});
