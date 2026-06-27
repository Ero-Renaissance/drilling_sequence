import { describe, expect, it } from "vitest";
import { getActivityColor, suggestedActivityTypes } from "@/lib/chart-colors";

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
  "Well Testing",
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
    // The renamed key resolves to the curated purple, not an auto color.
    expect(getActivityColor("HPHT (Development)")).toBe("#9333ea");
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

  it("merges project-specific types with the catalogue, deduped and sorted", () => {
    const out = suggestedActivityTypes(["Custom Type", "Oil Development"]);
    expect(out).toContain("Custom Type");
    expect(out.filter((t) => t === "Oil Development")).toHaveLength(1);
    expect(out).toEqual([...out].sort((a, b) => a.localeCompare(b)));
  });
});
