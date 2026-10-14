/**
 * SVG path data for each readiness-check icon, extracted from lucide-react v0.400.0
 * so we can render the same iconography inside the ECharts canvas (where React
 * components can't be used).
 *
 * Each entry is a list of `<path d="...">` strings. We assemble a self-contained
 * SVG document on demand, sub in the stroke color for the current readiness
 * status, and pass it to ECharts as an image data-URI.
 */

import type { CheckStatus } from "@/api/readiness";
import type { IconKey } from "@/components/readiness/icon-registry";

/** Keyed by the catalog's `icon_key` (the owned icon registry), not by check code,
 *  so a new catalog check reuses these paths without a code change. */
export const LUCIDE_PATHS: Record<IconKey, string> = {
  "land-plot": `
    <path d="m12 8 6-3-6-3v10"/>
    <path d="m8 11.99-5.5 3.14a1 1 0 0 0 0 1.74l8.5 4.86a2 2 0 0 0 2 0l8.5-4.86a1 1 0 0 0 0-1.74L16 12"/>
    <path d="m6.49 12.85 11.02 6.3"/>
    <path d="M17.51 12.85 6.5 19.15"/>
  `,
  // Rotary table (rim + kelly-drive square + drive ticks) — hand-drawn, not a
  // lucide extraction; the React twin is readiness/rotary-table-icon.tsx (keep
  // the two path sets identical).
  // Rotary table (rim + six OUTWARD drive spikes + kelly-drive square) —
  // hand-drawn, not a lucide extraction; the React twin is
  // readiness/rotary-table-icon.tsx (keep the two path sets identical).
  "rotary-table": `
    <circle cx="12" cy="12" r="7"/>
    <rect width="6" height="6" x="9" y="9" rx="0.5"/>
    <path d="M12 1.5V5"/>
    <path d="M12 19v3.5"/>
    <path d="m21.09 6.75-3.03 1.75"/>
    <path d="m2.91 6.75 3.03 1.75"/>
    <path d="m21.09 17.25-3.03-1.75"/>
    <path d="m2.91 17.25 3.03-1.75"/>
  `,
  "map-pin": `
    <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/>
    <circle cx="12" cy="10" r="3"/>
  `,
  "drafting-compass": `
    <circle cx="12" cy="5" r="2"/>
    <path d="m3 21 8.02-14.26"/>
    <path d="m12.99 6.74 1.93 3.44"/>
    <path d="M19 12c-3.87 4-10.13 4-14 0"/>
    <path d="m21 21-2.16-3.84"/>
  `,
  gavel: `
    <path d="m14.5 12.5-8 8a2.119 2.119 0 1 1-3-3l8-8"/>
    <path d="m16 16 6-6"/>
    <path d="m8 8 6-6"/>
    <path d="m9 7 8 8"/>
    <path d="m21 11-8-8"/>
  `,
  leaf: `
    <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/>
    <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>
  `,
  banknote: `
    <rect width="20" height="12" x="2" y="6" rx="2"/>
    <circle cx="12" cy="12" r="2"/>
    <path d="M6 12h.01M18 12h.01"/>
  `,
  // Phase 4 — Logistics (generated from lucide-react's icon nodes).
  "truck": `
    <path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/>
    <path d="M15 18H9"/>
    <path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/>
    <circle cx="17" cy="18" r="2"/>
    <circle cx="7" cy="18" r="2"/>
  `,
  "hand-coins": `
    <path d="M11 15h2a2 2 0 1 0 0-4h-3c-.6 0-1.1.2-1.4.6L3 17"/>
    <path d="m7 21 1.6-1.4c.3-.4.8-.6 1.4-.6h4c1.1 0 2.1-.4 2.8-1.2l4.6-4.4a2 2 0 0 0-2.75-2.91l-4.2 3.9"/>
    <path d="m2 16 6 6"/>
    <circle cx="16" cy="9" r="2.9"/>
    <circle cx="6" cy="5" r="3"/>
  `,
  "file-signature": `
    <path d="M14.364 13.634a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506l4.013-4.009a1 1 0 0 0-3.004-3.004z"/>
    <path d="M14.487 7.858A1 1 0 0 1 14 7V2"/>
    <path d="M20 19.645V20a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l2.516 2.516"/>
    <path d="M8 18h1"/>
  `,
  "forklift": `
    <path d="M12 12H5a2 2 0 0 0-2 2v5"/>
    <path d="M15 19h7"/>
    <path d="M16 19V2"/>
    <path d="M6 12V7a2 2 0 0 1 2-2h2.172a2 2 0 0 1 1.414.586l3.828 3.828A2 2 0 0 1 16 10.828"/>
    <path d="M7 19h4"/>
    <circle cx="13" cy="19" r="2"/>
    <circle cx="5" cy="19" r="2"/>
  `,
  "shield-check": `
    <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>
    <path d="m9 12 2 2 4-4"/>
  `,
  "handshake": `
    <path d="m11 17 2 2a1 1 0 1 0 3-3"/>
    <path d="m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4"/>
    <path d="m21 3 1 11h-2"/>
    <path d="M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3"/>
    <path d="M3 4h8"/>
  `,
  "receipt": `
    <path d="M12 17V7"/>
    <path d="M16 8h-6a2 2 0 0 0 0 4h4a2 2 0 0 1 0 4H8"/>
    <path d="M4 3a1 1 0 0 1 1-1 1.3 1.3 0 0 1 .7.2l.933.6a1.3 1.3 0 0 0 1.4 0l.934-.6a1.3 1.3 0 0 1 1.4 0l.933.6a1.3 1.3 0 0 0 1.4 0l.933-.6a1.3 1.3 0 0 1 1.4 0l.934.6a1.3 1.3 0 0 0 1.4 0l.933-.6A1.3 1.3 0 0 1 19 2a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1 1.3 1.3 0 0 1-.7-.2l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.934.6a1.3 1.3 0 0 1-1.4 0l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.933.6a1.3 1.3 0 0 1-1.4 0l-.934-.6a1.3 1.3 0 0 0-1.4 0l-.933.6a1.3 1.3 0 0 1-.7.2 1 1 0 0 1-1-1z"/>
  `,
  "ship": `
    <path d="M12 10.189V14"/>
    <path d="M12 2v3"/>
    <path d="M19 13V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6"/>
    <path d="M19.38 20A11.6 11.6 0 0 0 21 14l-8.188-3.639a2 2 0 0 0-1.624 0L3 14a11.6 11.6 0 0 0 2.81 7.76"/>
    <path d="M2 21c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1s1.2 1 2.5 1c2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/>
  `,
};

/** Hex colors (not Tailwind classes — these go inside SVG strings, not className). */
export const STATUS_STROKE: Record<CheckStatus, string> = {
  "On Track": "#f59e0b", // amber-500
  Completed: "#10b981", // emerald-500
  Behind: "#ef4444", // red-500
  "N/A": "#d4d4d8", // zinc-300
  Available: "#10b981", // emerald-500 — severity "done"
  "Not available": "#ef4444", // red-500 — severity "blocked"
};

// A neutral dot for an icon key this build doesn't know (a newer catalog) —
// mirrors checkIcon()'s CircleDot fallback in the React registry.
const FALLBACK_PATHS = `<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="1"/>`;

/** Build a self-contained SVG string for a check's icon + status. Only owned path
 *  data is embedded — never catalog text — so no user content reaches the SVG. */
export function buildCheckSvg(iconKey: string, status: CheckStatus): string {
  const stroke = STATUS_STROKE[status];
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" ` +
    `stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
    (LUCIDE_PATHS[iconKey as IconKey] ?? FALLBACK_PATHS) +
    `</svg>`
  );
}

/** Build a `data:image/svg+xml;utf8,...` URI suitable for ECharts `image.style.image`. */
export function buildCheckSvgDataUri(iconKey: string, status: CheckStatus): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(buildCheckSvg(iconKey, status))}`;
}

// ── Contract-expiry badge — the rig-level contract marker ─────────────────────
//
// A SOLID badge, not line art: a white clock face on a filled urgency-colored
// disc, wrapped in a ring of the chart surface color. The surface ring is what
// guarantees separation from whatever sits behind it (colored bars, dark or
// light background) — the same trick that keeps the flood droplet legible on
// any bar. The previous stroke-only alarm clock disappeared against busy rows.

export function buildContractBadgeSvg(fillHex: string, ringHex: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">` +
    `<circle cx="12" cy="12" r="11.5" fill="${ringHex}"/>` +
    `<circle cx="12" cy="12" r="9.5" fill="${fillHex}"/>` +
    `<path d="M12 7.5v4.5l3 3" stroke="#ffffff" stroke-width="2" ` +
    `stroke-linecap="round" stroke-linejoin="round" fill="none"/>` +
    `</svg>`
  );
}

export function buildContractBadgeSvgDataUri(fillHex: string, ringHex: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(buildContractBadgeSvg(fillHex, ringHex))}`;
}

// ── Droplet — flood-risk marker on a bar ──────────────────────────────────────

const DROPLET_PATH = `<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C8 11.1 7 13 7 15a7 7 0 0 0 7 7z"/>`;

/** A solid-fill water-drop (default flood blue) with a thin contrasting edge so
 *  it stays legible on any activity-type bar colour — used to flag flood risk. */
export function buildDropletSvg(fillHex = "#2563eb", edgeHex = "#ffffff"): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" ` +
    `fill="${fillHex}" stroke="${edgeHex}" stroke-width="1.6" stroke-linejoin="round">` +
    DROPLET_PATH +
    `</svg>`
  );
}

export function buildDropletSvgDataUri(fillHex?: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(buildDropletSvg(fillHex))}`;
}
