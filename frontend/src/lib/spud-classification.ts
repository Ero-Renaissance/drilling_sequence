/**
 * Oil/gas well-spud classification of activity types.
 *
 * A "spud" is the start of drilling a *new* well — so Development / Appraisal /
 * Exploration count, while workovers (re-entries), testing, injection, repair and
 * mobilisation do not. Oil vs gas comes from the type name. The default is a
 * heuristic; the planner can override any type, and their choices are saved in the
 * browser (there is no shared app-level config store today).
 */

import { ownValue } from "./own-key";

export type SpudClass = "oil" | "gas" | "exploration" | "exclude";

/** Per-activity-type overrides of the name-based default. */
export type SpudMap = Record<string, SpudClass>;

const STORAGE_KEY = "ds.spud-map";

// Keywords that mean "not a new-well spud" regardless of oil/gas.
const NON_SPUD = ["workover", "testing", "injection", "repair", "safety", "mobilis", "mobiliz", "abandon"];
// Keywords that mean a new well is drilled (a spud).
const SPUD = ["development", "appraisal", "exploration"];

/** The name-based default class for an activity type. Unknown or unattributable
 *  types (no oil/gas hint, or not a drilling activity) default to excluded. */
export function defaultSpudClass(activityType: string): SpudClass {
  const t = activityType.toLowerCase();
  if (NON_SPUD.some((k) => t.includes(k))) return "exclude";
  if (!SPUD.some((k) => t.includes(k))) return "exclude";
  // Exploration outranks the oil/gas keyword: an exploration well is
  // prospecting — it has no committed market, so oil AND gas exploration
  // combine into one category instead of distorting the production lines.
  if (t.includes("exploration")) return "exploration";
  if (t.includes("gas")) return "gas";
  if (t.includes("oil")) return "oil";
  return "exclude"; // a spud we can't attribute to oil or gas — the planner can set it
}

/** A type's effective class: the explicit override if set, else the name default.
 *  Activity types are free text, so read the map's OWN entry only — a type named
 *  "constructor" or "toString" must not pick up an inherited Object member. */
export function resolveSpudClass(activityType: string, map: SpudMap): SpudClass {
  return ownValue(map, activityType) ?? defaultSpudClass(activityType);
}

function isSpudClass(v: unknown): v is SpudClass {
  return v === "oil" || v === "gas" || v === "exploration" || v === "exclude";
}

/** Read the saved overrides, sanitised to valid classes (ignores corrupt storage). */
export function loadSpudMap(): SpudMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    // Object.fromEntries defines own properties: a type named "__proto__" stays
    // an override instead of hitting the prototype setter (and being lost).
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter((e): e is [string, SpudClass] =>
        isSpudClass(e[1]),
      ),
    );
  } catch {
    return {}; // unreadable / malformed storage — fall back to defaults
  }
}

/** Persist the overrides. Non-fatal on failure (the view still works this session). */
export function saveSpudMap(map: SpudMap): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // storage unavailable / full — ignore
  }
}
