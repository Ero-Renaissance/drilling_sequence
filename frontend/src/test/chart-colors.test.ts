import { describe, expect, it } from "vitest";
import {
  getActivityColor,
  isCataloguedActivityType,
  suggestedActivityTypes,
  SPARE_ACTIVITY_COLORS,
  UNKNOWN_ACTIVITY_COLOR,
} from "@/lib/chart-colors";

// The curated "default activities": the exact set offered in the Activity Type
// dropdown and given stable chart colors. Keep in sync with ACTIVITY_COLORS.
const DEFAULT_ACTIVITIES = [
  "Oil Development",
  "Oil Appraisal",
  "Oil Workover",
  "Oil Exploration",
  "Gas Development",
  "Gas Appraisal",
  "Gas Workover",
  "Gas Exploration (including HPHT)",
  "Gas Appraisal (including HPHT)",
  "HPHT (Development)",
  "Water Injection",
  "Well Repair/Safety",
  "Rig Mobilisation and Intake",
  "Well Cleanup/Test",
  "Abandonment",
];

describe("chart-colors — default activity catalogue", () => {
  it("offers exactly the 15 default activities as suggestions", () => {
    const out = suggestedActivityTypes([]);
    expect(out).toHaveLength(DEFAULT_ACTIVITIES.length);
    expect(new Set(out)).toEqual(new Set(DEFAULT_ACTIVITIES));
  });

  it("gives every default activity a curated 6-digit hex color", () => {
    for (const a of DEFAULT_ACTIVITIES) {
      expect(getActivityColor(a)).toMatch(/^#[0-9a-f]{6}$/i);
    }
    // The renamed key resolves to the curated (validated) violet, not an auto color.
    expect(getActivityColor("HPHT (Development)")).toBe("#6d28d9");
  });

  it("no longer offers the removed legacy types", () => {
    const out = suggestedActivityTypes([]);
    for (const gone of [
      "Oil Sidetrack",
      "Gas Sidetrack",
      "Rig Idle",
      "Contracting",
      "GAP",
      "Drilling",
      "Phase 1",
    ]) {
      expect(out).not.toContain(gone);
    }
  });

  it("keeps the retired 'Well Testing' label rendering (immutable snapshots) but hides it from suggestions", () => {
    // Approved snapshots still store the old name — it must keep its hue…
    expect(getActivityColor("Well Testing")).toBe(getActivityColor("Well Cleanup/Test"));
    expect(isCataloguedActivityType("Well Testing")).toBe(true);
    // …but new data normalises to the canonical name, so it's not suggested.
    expect(suggestedActivityTypes([])).not.toContain("Well Testing");
  });

  it("merges project-specific types with the catalogue, deduped and sorted", () => {
    const out = suggestedActivityTypes(["Custom Type", "Oil Development"]);
    expect(out).toContain("Custom Type");
    expect(out.filter((t) => t === "Oil Development")).toHaveLength(1);
    expect(out).toEqual([...out].sort((a, b) => a.localeCompare(b)));
  });
});

describe("chart-colors — validated palette rules", () => {
  it("keeps pure red reserved for status — no activity type uses it", () => {
    for (const t of DEFAULT_ACTIVITIES) {
      expect(getActivityColor(t)).not.toBe("#dc2626");
      expect(getActivityColor(t)).not.toBe("#ef4444");
    }
  });

  it("assigns every default activity a distinct color", () => {
    const colors = DEFAULT_ACTIVITIES.map(getActivityColor);
    expect(new Set(colors).size).toBe(colors.length);
  });

  it("gives an UNKNOWN type the reserved neutral, never a generated hue", () => {
    expect(getActivityColor("Coiled Tubing Cleanout")).toBe(UNKNOWN_ACTIVITY_COLOR);
    // Deterministic for every unknown name — no hashing, no jitter.
    expect(getActivityColor("Some Future Type")).toBe(UNKNOWN_ACTIVITY_COLOR);
  });

  it("keeps the spare slots distinct from every assigned color and the neutral", () => {
    const assigned = new Set(DEFAULT_ACTIVITIES.map(getActivityColor));
    for (const spare of SPARE_ACTIVITY_COLORS) {
      expect(assigned.has(spare)).toBe(false);
      expect(spare).not.toBe(UNKNOWN_ACTIVITY_COLOR);
    }
  });
});

describe("isCataloguedActivityType", () => {
  it("recognises canonical and synthetic types", () => {
    expect(isCataloguedActivityType("Gas Development")).toBe(true);
    expect(isCataloguedActivityType("Well")).toBe(true); // optimizer synthetic
  });

  it("flags an uncatalogued type (drives the legend's 'colour pending' hint)", () => {
    expect(isCataloguedActivityType("Coiled Tubing Cleanout")).toBe(false);
  });
});
