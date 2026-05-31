/**
 * One distinctive hue per activity type. Family grouping is preserved by
 * positioning related types in the same color zone (reds for oil, greens for
 * gas, blues for water, etc.) but each sub-type gets a clearly different hue
 * so bars and legend swatches read unambiguously — no patterns required.
 */
const ACTIVITY_COLORS: Record<string, string> = {
  // Oil family — warm band: wine → rust → red → pink → orange. Deliberately
  // kept out of the purple/magenta zone (reserved for HPHT / Abandonment) so
  // Oil Sidetrack no longer reads as "purple" next to Oil Workover's pink.
  "Oil Development": "#dc2626", // crimson
  "Oil Exploration": "#f97316", // bright orange
  "Oil Appraisal": "#7f1d1d", // dark wine
  "Oil Workover": "#ec4899", // pink
  "Oil Sidetrack": "#9a3412", // rust / terracotta
  // Gas family — cool greens / teals
  "Gas Development": "#16a34a", // emerald
  "Gas Exploration": "#84cc16", // lime
  "Gas Appraisal": "#14b8a6", // teal
  "Gas Workover": "#0d9488", // dark teal
  "Gas Sidetrack": "#65a30d", // olive green
  // Water family — blues
  "Water Injection": "#0ea5e9", // sky blue
  // HPHT — purples
  "HPHT(Development)": "#9333ea", // purple
  // Operational / admin
  "Well Repair/Safety": "#1d4ed8", // royal blue
  "Rig Idle": "#475569", // slate
  "Contracting": "#a16207", // amber-brown
  "Abandonment": "#86198f", // deep magenta
  "GAP": "#22c55e", // bright green
  // Drilling operations
  "Drilling": "#0891b2", // cyan
  "Casing": "#be185d", // rose
  "Cementing": "#0284c7", // ocean blue
  "Testing": "#4338ca", // indigo
  // Project phases
  "Design": "#a21caf", // violet
  "Construction": "#9d174d", // dark rose
  "Deployment": "#ea580c", // burnt orange
  "Development": "#0e7490", // dark cyan
  "Review": "#2563eb", // bright blue
  "Planning": "#1e40af", // navy
  "Phase 1": "#15803d", // forest green
  "Phase 2": "#991b1b", // brick red
  "Phase 3": "#7c3aed", // bright purple
};

// Family seeds for auto-generated colors
const FAMILIES: Record<string, string> = {
  Oil: "#d62728",
  Gas: "#23a94d",
  Water: "#237d96",
  HPHT: "#9467bd",
  Rig: "#2c2c2a",
};

const _generated: Record<string, string> = {};

function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0)
          : max === g ? (b - r) / d + 2
          : (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * c).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function generateColor(activityType: string): string {
  const family = Object.keys(FAMILIES).find((f) => activityType.startsWith(f));
  if (family) {
    const [h, s, l] = hexToHsl(FAMILIES[family]);
    const jitter = (Math.sin(activityType.length * 7919) * 0.5 + 0.5) * 40 - 20;
    return hslToHex((h + jitter + 360) % 360, Math.min(0.9, s + 0.05), Math.max(0.3, Math.min(0.6, l)));
  }
  // Deterministic hue from string hash
  let hash = 0;
  for (let i = 0; i < activityType.length; i++) hash = activityType.charCodeAt(i) + ((hash << 5) - hash);
  return hslToHex(Math.abs(hash) % 360, 0.65, 0.45);
}

export function getActivityColor(activityType: string): string {
  if (ACTIVITY_COLORS[activityType]) return ACTIVITY_COLORS[activityType];
  if (!_generated[activityType]) _generated[activityType] = generateColor(activityType);
  return _generated[activityType];
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
