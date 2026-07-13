/**
 * Activity-type colors — a FIXED, validated assignment. One distinctive hue per
 * canonical activity type, zoned by family (warm = oil, green/teal/cyan = gas,
 * violet = HPHT, magenta = abandonment, blue = testing/water) so domain users
 * can read family at a glance while every sub-type stays distinguishable.
 *
 * The active palette + the spare slots below were machine-validated (2026-07)
 * for colorblind separation (worst adjacent pair ΔE 17.0), chroma, lightness,
 * and ≥3:1 contrast against the light/print surface — ALL CHECKS PASS. On the
 * dark theme the colorblind checks still pass; a few deep hues fall below 3:1
 * fill contrast there and are relieved by the bars' direct labels, tooltips and
 * the legend. Designing brighter dark-mode steps is deliberately deferred to
 * the activity-type admin work (Phase 2).
 *
 * Rules (do not break silently):
 *  - Pure red is RESERVED for status (Behind / Expired / conflicts) — no
 *    activity type may use it. Oil Development is burgundy, not red.
 *  - Never generate a hue. A type missing from this catalogue renders in
 *    UNKNOWN_ACTIVITY_COLOR (neutral grey) until it is added here — the legend
 *    marks it "colour pending". Assign new types the next SPARE_ACTIVITY_COLORS
 *    entry; once spares run out, extend the palette and re-validate.
 */
const ACTIVITY_COLORS: Record<string, string> = {
  // Oil family — warm band.
  "Oil Development": "#9f1239", // burgundy (red itself is reserved for status)
  "Oil Workover": "#db2777", // pink
  "Oil Exploration": "#ea580c", // orange
  // Gas family — green → teal → cyan → deep blue-cyan band.
  "Gas Development": "#15803d", // deep emerald
  "Gas Exploration (including HPHT)": "#65a30d", // lime-olive
  "Gas Appraisal": "#0d9488", // teal
  "Gas Appraisal (including HPHT)": "#0369a1", // deep blue-cyan
  "Gas Workover": "#0891b2", // cyan
  // HPHT — violet
  "HPHT (Development)": "#6d28d9",
  // Abandonment — deep magenta
  "Abandonment": "#86198f",
  // Well Cleanup/Test — blue. Renamed 2026-07 from "Well Testing".
  "Well Cleanup/Test": "#3b82f6",
  // Rig moves are non-well filler time — a RESERVED dark neutral outside the
  // categorical wheel (freeing brown fixed an orange/brown colorblind clash).
  "Rig Mobilisation and Intake": "#57534e",
  // ── Legacy catalogue entries, not present in any current campaign. Kept for
  // continuity; re-validate against the active palette when first used.
  "Oil Appraisal": "#7f1d1d", // dark wine
  "Water Injection": "#0ea5e9", // sky blue
  "Well Repair/Safety": "#1d4ed8", // royal blue
};

/**
 * Pre-validated spare hues for FUTURE activity types — already checked against
 * the whole active palette on both surfaces. Take the first free one when a new
 * type is added to the catalogue; do not invent other colors without re-running
 * the palette validation.
 */
export const SPARE_ACTIVITY_COLORS: readonly string[] = [
  "#c026d3", // fuchsia
  "#92400e", // dark amber-brown
];

/**
 * Reserved neutral for activity types NOT in the catalogue. Deliberately grey:
 * an unknown type should look "colour pending" and prompt cataloguing, never
 * blend in with a plausible generated hue (generated hues once produced two
 * near-identical greens). Warm stone — distinct from the cool slate used for
 * completed bars (#94a3b8/#64748b) and the synthetic "Well" (#64748b).
 */
export const UNKNOWN_ACTIVITY_COLOR = "#78716c";

// Synthetic display-only types get a reserved neutral hue that no real activity
// family uses (slate — the palette has no grey). Kept out of ACTIVITY_COLORS so
// they never surface in the activity-type suggestions for real campaigns.
// "Well" is the rig optimizer's generic well (could be oil or gas).
const SYNTHETIC_COLORS: Record<string, string> = {
  Well: "#64748b", // slate
};

/** The canonical activity-type catalogue (sorted) — the allow-list the import
 *  mapping dialog maps unknown sheet values onto. Mirrors the backend's
 *  CANONICAL_ACTIVITY_TYPES; retired aliases and synthetics are excluded. */
export const CATALOGUE_ACTIVITY_TYPES: readonly string[] = Object.keys(
  ACTIVITY_COLORS,
).sort((a, b) => a.localeCompare(b));

/** True when the type has a designed color (curated catalogue or synthetic). */
export function isCataloguedActivityType(activityType: string): boolean {
  return activityType in ACTIVITY_COLORS || activityType in SYNTHETIC_COLORS;
}

export function getActivityColor(activityType: string): string {
  if (SYNTHETIC_COLORS[activityType]) return SYNTHETIC_COLORS[activityType];
  if (ACTIVITY_COLORS[activityType]) return ACTIVITY_COLORS[activityType];
  return UNKNOWN_ACTIVITY_COLOR;
}

/**
 * Suggested activity-type autocompletions: every type already present in the
 * project plus the curated catalogue, deduped and sorted. Used to power the
 * Activity Type combobox in the add/edit dialogs.
 */
export function suggestedActivityTypes(existingInProject: string[]): string[] {
  const set = new Set<string>();
  for (const t of existingInProject) if (t) set.add(t);
  for (const t of Object.keys(ACTIVITY_COLORS)) set.add(t);
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}
