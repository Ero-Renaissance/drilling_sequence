import { describe, it, expect } from "vitest";
import { TERRAIN_ORDER, terrainRank } from "@/lib/gantt-rows";

describe("terrainRank", () => {
  it("orders land before swamp before offshore", () => {
    expect(terrainRank("LAND")).toBeLessThan(terrainRank("SWAMP"));
    expect(terrainRank("SWAMP")).toBeLessThan(terrainRank("OFFSHORE"));
  });

  it("sorts unknown/blank/nullish terrains last", () => {
    expect(terrainRank("OFFSHORE")).toBeLessThan(terrainRank("MOON"));
    expect(terrainRank("MOON")).toBe(99);
    expect(terrainRank("")).toBe(99);
    expect(terrainRank(null)).toBe(99);
    expect(terrainRank(undefined)).toBe(99);
  });

  it("is case- and whitespace-insensitive", () => {
    expect(terrainRank("land")).toBe(terrainRank("LAND"));
    expect(terrainRank("  Offshore  ")).toBe(terrainRank("OFFSHORE"));
  });

  it("matches the canonical TERRAIN_ORDER", () => {
    expect(TERRAIN_ORDER).toEqual({ LAND: 0, SWAMP: 1, OFFSHORE: 2 });
  });
});
