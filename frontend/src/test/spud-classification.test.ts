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
    expect(defaultSpudClass("Gas Exploration (including HPHT)")).toBe("exploration");
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

  it("reads only the map's own overrides — a type named after an Object member gets its default", () => {
    // Activity types are free text: "constructor" / "toString" used to read the
    // inherited function, skip the default and count as a gas spud.
    for (const t of ["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__"]) {
      expect(resolveSpudClass(t, {})).toBe("exclude");
    }
    expect(resolveSpudClass("constructor", { constructor: "oil" as const })).toBe("oil");
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

  it("keeps an override for a type named __proto__ across a reload", () => {
    window.localStorage.setItem("ds.spud-map", '{"__proto__":"oil","A":"gas"}');
    const map = loadSpudMap();
    expect(Object.prototype.hasOwnProperty.call(map, "__proto__")).toBe(true);
    expect(resolveSpudClass("__proto__", map)).toBe("oil");
    expect(resolveSpudClass("A", map)).toBe("gas");
    expect(Object.getPrototypeOf(map)).toBe(Object.prototype);
  });

  it("returns empty on malformed storage", () => {
    window.localStorage.setItem("ds.spud-map", "{not json");
    expect(loadSpudMap()).toEqual({});
  });
});

describe("exploration class", () => {
  it("routes oil AND gas exploration to the combined exploration class", async () => {
    const { defaultSpudClass } = await import("@/lib/spud-classification");
    expect(defaultSpudClass("Oil Exploration")).toBe("exploration");
    expect(defaultSpudClass("Gas Exploration (Including HPHT)")).toBe("exploration");
    // Appraisal deliberately stays oil/gas — only exploration combines.
    expect(defaultSpudClass("Gas Appraisal")).toBe("gas");
    expect(defaultSpudClass("Oil Development")).toBe("oil");
  });

  it("round-trips an exploration override through storage", async () => {
    const { loadSpudMap, saveSpudMap } = await import("@/lib/spud-classification");
    saveSpudMap({ "Some Type": "exploration" });
    expect(loadSpudMap()["Some Type"]).toBe("exploration");
    window.localStorage.removeItem("ds.spud-map");
  });
});
