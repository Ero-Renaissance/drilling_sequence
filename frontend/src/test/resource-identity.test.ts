import { describe, it, expect } from "vitest";
import { normalizeResourceName, rigLaneKey } from "@/lib/resource-identity";

describe("resource identity", () => {
  it("normalizes names like the backend registry (trim + case-fold)", () => {
    expect(normalizeResourceName("  10K Rig 3 ")).toBe("10k rig 3");
  });

  it("builds rig lane keys on normalized identity", () => {
    expect(rigLaneKey("LAND", "10K Rig 1")).toBe("LAND|10k rig 1");
    expect(rigLaneKey(null, " T209 ")).toBe("|t209");
    expect(rigLaneKey(undefined, "HL19")).toBe("|hl19");
    // A contract row and an activity that disagree on casing meet on one key.
    expect(rigLaneKey("SWAMP", "hl19")).toBe(rigLaneKey("SWAMP", "HL19"));
  });
});
