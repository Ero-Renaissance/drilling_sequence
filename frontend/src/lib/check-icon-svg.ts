/**
 * SVG path data for each readiness-check icon, so the ECharts canvas (where React
 * components can't be used) draws the same iconography as the React registry.
 *
 * `LUCIDE_PATHS` is GENERATED from the installed lucide-react's icon nodes by
 * `node scripts/gen-check-icons.mjs` (run it after adding an icon key or bumping
 * lucide-react; `--check` fails if this file is stale). Only the hand-drawn
 * rotary table below is written by hand. src/test/check-icon-paths.test.ts
 * renders every React icon and compares it with these paths.
 *
 * Each entry is a list of SVG elements. We assemble a self-contained SVG document
 * on demand, sub in the stroke color for the current readiness status, and pass
 * it to ECharts as an image data-URI.
 */

import type { CheckStatus } from "@/api/readiness";
import type { IconKey } from "@/components/readiness/icon-registry";

// Rotary table (rim + six OUTWARD drive spikes + kelly-drive square) — hand-drawn,
// not a lucide extraction, so the generator leaves it as written; the React twin
// is readiness/rotary-table-icon.tsx (keep the two path sets identical —
// src/test/check-icon-paths.test.ts compares them).
const ROTARY_TABLE_PATHS = `
    <circle cx="12" cy="12" r="7"/>
    <rect width="6" height="6" x="9" y="9" rx="0.5"/>
    <path d="M12 1.5V5"/>
    <path d="M12 19v3.5"/>
    <path d="m21.09 6.75-3.03 1.75"/>
    <path d="m2.91 6.75 3.03 1.75"/>
    <path d="m21.09 17.25-3.03-1.75"/>
    <path d="m2.91 17.25 3.03-1.75"/>
  `;

/** Keyed by the catalog's `icon_key` (the owned icon registry), not by check code,
 *  so a new catalog check reuses these paths without a code change. */
export const LUCIDE_PATHS: Record<IconKey, string> = {
  // BEGIN GENERATED LUCIDE_PATHS (scripts/gen-check-icons.mjs) - do not edit by hand
  // From lucide-react 0.577.0; hand-drawn keys reference their own constant.
  "land-plot": `
    <path d="m12 8 6-3-6-3v10"/>
    <path d="m8 11.99-5.5 3.14a1 1 0 0 0 0 1.74l8.5 4.86a2 2 0 0 0 2 0l8.5-4.86a1 1 0 0 0 0-1.74L16 12"/>
    <path d="m6.49 12.85 11.02 6.3"/>
    <path d="M17.51 12.85 6.5 19.15"/>
  `,
  "rotary-table": ROTARY_TABLE_PATHS,
  "map-pin": `
    <path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/>
    <circle cx="12" cy="10" r="3"/>
  `,
  "drafting-compass": `
    <path d="m12.99 6.74 1.93 3.44"/>
    <path d="M19.136 12a10 10 0 0 1-14.271 0"/>
    <path d="m21 21-2.16-3.84"/>
    <path d="m3 21 8.02-14.26"/>
    <circle cx="12" cy="5" r="2"/>
  `,
  gavel: `
    <path d="m14 13-8.381 8.38a1 1 0 0 1-3.001-3l8.384-8.381"/>
    <path d="m16 16 6-6"/>
    <path d="m21.5 10.5-8-8"/>
    <path d="m8 8 6-6"/>
    <path d="m8.5 7.5 8 8"/>
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
  truck: `
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
  forklift: `
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
  handshake: `
    <path d="m11 17 2 2a1 1 0 1 0 3-3"/>
    <path d="m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4"/>
    <path d="m21 3 1 11h-2"/>
    <path d="M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3"/>
    <path d="M3 4h8"/>
  `,
  receipt: `
    <path d="M12 17V7"/>
    <path d="M16 8h-6a2 2 0 0 0 0 4h4a2 2 0 0 1 0 4H8"/>
    <path d="M4 3a1 1 0 0 1 1-1 1.3 1.3 0 0 1 .7.2l.933.6a1.3 1.3 0 0 0 1.4 0l.934-.6a1.3 1.3 0 0 1 1.4 0l.933.6a1.3 1.3 0 0 0 1.4 0l.933-.6a1.3 1.3 0 0 1 1.4 0l.934.6a1.3 1.3 0 0 0 1.4 0l.933-.6A1.3 1.3 0 0 1 19 2a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1 1.3 1.3 0 0 1-.7-.2l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.934.6a1.3 1.3 0 0 1-1.4 0l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.933.6a1.3 1.3 0 0 1-1.4 0l-.934-.6a1.3 1.3 0 0 0-1.4 0l-.933.6a1.3 1.3 0 0 1-.7.2 1 1 0 0 1-1-1z"/>
  `,
  ship: `
    <path d="M12 10.189V14"/>
    <path d="M12 2v3"/>
    <path d="M19 13V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6"/>
    <path d="M19.38 20A11.6 11.6 0 0 0 21 14l-8.188-3.639a2 2 0 0 0-1.624 0L3 14a11.6 11.6 0 0 0 2.81 7.76"/>
    <path d="M2 21c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1s1.2 1 2.5 1c2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/>
  `,
  drill: `
    <path d="M10 18a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H5a3 3 0 0 1-3-3 1 1 0 0 1 1-1z"/>
    <path d="M13 10H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1l-.81 3.242a1 1 0 0 1-.97.758H8"/>
    <path d="M14 4h3a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1h-3"/>
    <path d="M18 6h4"/>
    <path d="m5 10-2 8"/>
    <path d="m7 18 2-8"/>
  `,
  pickaxe: `
    <path d="m14 13-8.381 8.38a1 1 0 0 1-3.001-3L11 9.999"/>
    <path d="M15.973 4.027A13 13 0 0 0 5.902 2.373c-1.398.342-1.092 2.158.277 2.601a19.9 19.9 0 0 1 5.822 3.024"/>
    <path d="M16.001 11.999a19.9 19.9 0 0 1 3.024 5.824c.444 1.369 2.26 1.676 2.603.278A13 13 0 0 0 20 8.069"/>
    <path d="M18.352 3.352a1.205 1.205 0 0 0-1.704 0l-5.296 5.296a1.205 1.205 0 0 0 0 1.704l2.296 2.296a1.205 1.205 0 0 0 1.704 0l5.296-5.296a1.205 1.205 0 0 0 0-1.704z"/>
  `,
  wrench: `
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z"/>
  `,
  hammer: `
    <path d="m15 12-9.373 9.373a1 1 0 0 1-3.001-3L12 9"/>
    <path d="m18 15 4-4"/>
    <path d="m21.5 11.5-1.914-1.914A2 2 0 0 1 19 8.172v-.344a2 2 0 0 0-.586-1.414l-1.657-1.657A6 6 0 0 0 12.516 3H9l1.243 1.243A6 6 0 0 1 12 8.485V10l2 2h1.172a2 2 0 0 1 1.414.586L18.5 14.5"/>
  `,
  gauge: `
    <path d="m12 14 4-4"/>
    <path d="M3.34 19a10 10 0 1 1 17.32 0"/>
  `,
  cable: `
    <path d="M17 19a1 1 0 0 1-1-1v-2a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2a1 1 0 0 1-1 1z"/>
    <path d="M17 21v-2"/>
    <path d="M19 14V6.5a1 1 0 0 0-7 0v11a1 1 0 0 1-7 0V10"/>
    <path d="M21 21v-2"/>
    <path d="M3 5V3"/>
    <path d="M4 10a2 2 0 0 1-2-2V6a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2a2 2 0 0 1-2 2z"/>
    <path d="M7 5V3"/>
  `,
  "plug-zap": `
    <path d="M6.3 20.3a2.4 2.4 0 0 0 3.4 0L12 18l-6-6-2.3 2.3a2.4 2.4 0 0 0 0 3.4Z"/>
    <path d="m2 22 3-3"/>
    <path d="M7.5 13.5 10 11"/>
    <path d="M10.5 16.5 13 14"/>
    <path d="m18 3-4 4h6l-4 4"/>
  `,
  factory: `
    <path d="M12 16h.01"/>
    <path d="M16 16h.01"/>
    <path d="M3 19a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.5a.5.5 0 0 0-.769-.422l-4.462 2.844A.5.5 0 0 1 15 10.5v-2a.5.5 0 0 0-.769-.422L9.77 10.922A.5.5 0 0 1 9 10.5V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2z"/>
    <path d="M8 16h.01"/>
  `,
  warehouse: `
    <path d="M18 21V10a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1v11"/>
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 1.132-1.803l7.95-3.974a2 2 0 0 1 1.837 0l7.948 3.974A2 2 0 0 1 22 8z"/>
    <path d="M6 13h12"/>
    <path d="M6 17h12"/>
  `,
  anchor: `
    <path d="M12 6v16"/>
    <path d="m19 13 2-1a9 9 0 0 1-18 0l2 1"/>
    <path d="M9 11h6"/>
    <circle cx="12" cy="4" r="2"/>
  `,
  container: `
    <path d="M22 7.7c0-.6-.4-1.2-.8-1.5l-6.3-3.9a1.72 1.72 0 0 0-1.7 0l-10.3 6c-.5.2-.9.8-.9 1.4v6.6c0 .5.4 1.2.8 1.5l6.3 3.9a1.72 1.72 0 0 0 1.7 0l10.3-6c.5-.3.9-1 .9-1.5Z"/>
    <path d="M10 21.9V14L2.1 9.1"/>
    <path d="m10 14 11.9-6.9"/>
    <path d="M14 19.8v-8.1"/>
    <path d="M18 17.5V9.4"/>
  `,
  "ship-wheel": `
    <circle cx="12" cy="12" r="8"/>
    <path d="M12 2v7.5"/>
    <path d="m19 5-5.23 5.23"/>
    <path d="M22 12h-7.5"/>
    <path d="m19 19-5.23-5.23"/>
    <path d="M12 14.5V22"/>
    <path d="M10.23 13.77 5 19"/>
    <path d="M9.5 12H2"/>
    <path d="M10.23 10.23 5 5"/>
    <circle cx="12" cy="12" r="2.5"/>
  `,
  sailboat: `
    <path d="M10 2v15"/>
    <path d="M7 22a4 4 0 0 1-4-4 1 1 0 0 1 1-1h16a1 1 0 0 1 1 1 4 4 0 0 1-4 4z"/>
    <path d="M9.159 2.46a1 1 0 0 1 1.521-.193l9.977 8.98A1 1 0 0 1 20 13H4a1 1 0 0 1-.824-1.567z"/>
  `,
  "life-buoy": `
    <circle cx="12" cy="12" r="10"/>
    <path d="m4.93 4.93 4.24 4.24"/>
    <path d="m14.83 9.17 4.24-4.24"/>
    <path d="m14.83 14.83 4.24 4.24"/>
    <path d="m9.17 14.83-4.24 4.24"/>
    <circle cx="12" cy="12" r="4"/>
  `,
  waves: `
    <path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/>
    <path d="M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/>
    <path d="M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/>
  `,
  helicopter: `
    <path d="M11 17v4"/>
    <path d="M14 3v8a2 2 0 0 0 2 2h5.865"/>
    <path d="M17 17v4"/>
    <path d="M18 17a4 4 0 0 0 4-4 8 6 0 0 0-8-6 6 5 0 0 0-6 5v3a2 2 0 0 0 2 2z"/>
    <path d="M2 10v5"/>
    <path d="M6 3h16"/>
    <path d="M7 21h14"/>
    <path d="M8 13H2"/>
  `,
  plane: `
    <path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>
  `,
  bus: `
    <path d="M8 6v6"/>
    <path d="M15 6v6"/>
    <path d="M2 12h19.6"/>
    <path d="M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2 0-.4-.1-.8-.2-1.2l-1.4-5C20.1 6.8 19.1 6 18 6H4a2 2 0 0 0-2 2v10h3"/>
    <circle cx="7" cy="18" r="2"/>
    <path d="M9 18h5"/>
    <circle cx="16" cy="18" r="2"/>
  `,
  "bus-front": `
    <path d="M4 6 2 7"/>
    <path d="M10 6h4"/>
    <path d="m22 7-2-1"/>
    <rect width="16" height="16" x="4" y="3" rx="2"/>
    <path d="M4 11h16"/>
    <path d="M8 15h.01"/>
    <path d="M16 15h.01"/>
    <path d="M6 19v2"/>
    <path d="M18 21v-2"/>
  `,
  van: `
    <path d="M13 6v5a1 1 0 0 0 1 1h6.102a1 1 0 0 1 .712.298l.898.91a1 1 0 0 1 .288.702V17a1 1 0 0 1-1 1h-3"/>
    <path d="M5 18H3a1 1 0 0 1-1-1V8a2 2 0 0 1 2-2h12c1.1 0 2.1.8 2.4 1.8l1.176 4.2"/>
    <path d="M9 18h5"/>
    <circle cx="16" cy="18" r="2"/>
    <circle cx="7" cy="18" r="2"/>
  `,
  car: `
    <path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/>
    <circle cx="7" cy="17" r="2"/>
    <path d="M9 17h6"/>
    <circle cx="17" cy="17" r="2"/>
  `,
  tractor: `
    <path d="m10 11 11 .9a1 1 0 0 1 .8 1.1l-.665 4.158a1 1 0 0 1-.988.842H20"/>
    <path d="M16 18h-5"/>
    <path d="M18 5a1 1 0 0 0-1 1v5.573"/>
    <path d="M3 4h8.129a1 1 0 0 1 .99.863L13 11.246"/>
    <path d="M4 11V4"/>
    <path d="M7 15h.01"/>
    <path d="M8 10.1V4"/>
    <circle cx="18" cy="18" r="2"/>
    <circle cx="7" cy="15" r="5"/>
  `,
  caravan: `
    <path d="M18 19V9a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v8a2 2 0 0 0 2 2h2"/>
    <path d="M2 9h3a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H2"/>
    <path d="M22 17v1a1 1 0 0 1-1 1H10v-9a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v9"/>
    <circle cx="8" cy="19" r="2"/>
  `,
  construction: `
    <rect x="2" y="6" width="20" height="8" rx="1"/>
    <path d="M17 14v7"/>
    <path d="M7 14v7"/>
    <path d="M17 3v3"/>
    <path d="M7 3v3"/>
    <path d="M10 14 2.3 6.3"/>
    <path d="m14 6 7.7 7.7"/>
    <path d="m8 6 8 8"/>
  `,
  "hard-hat": `
    <path d="M10 10V5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v5"/>
    <path d="M14 6a6 6 0 0 1 6 6v3"/>
    <path d="M4 15v-3a6 6 0 0 1 6-6"/>
    <rect x="2" y="15" width="20" height="4" rx="1"/>
  `,
  radiation: `
    <path d="M12 12h.01"/>
    <path d="M14 15.4641a4 4 0 0 1-4 0L7.52786 19.74597 A 1 1 0 0 0 7.99303 21.16211 10 10 0 0 0 16.00697 21.16211 1 1 0 0 0 16.47214 19.74597z"/>
    <path d="M16 12a4 4 0 0 0-2-3.464l2.472-4.282a1 1 0 0 1 1.46-.305 10 10 0 0 1 4.006 6.94A1 1 0 0 1 21 12z"/>
    <path d="M8 12a4 4 0 0 1 2-3.464L7.528 4.254a1 1 0 0 0-1.46-.305 10 10 0 0 0-4.006 6.94A1 1 0 0 0 3 12z"/>
  `,
  biohazard: `
    <circle cx="12" cy="11.9" r="2"/>
    <path d="M6.7 3.4c-.9 2.5 0 5.2 2.2 6.7C6.5 9 3.7 9.6 2 11.6"/>
    <path d="m8.9 10.1 1.4.8"/>
    <path d="M17.3 3.4c.9 2.5 0 5.2-2.2 6.7 2.4-1.2 5.2-.6 6.9 1.5"/>
    <path d="m15.1 10.1-1.4.8"/>
    <path d="M16.7 20.8c-2.6-.4-4.6-2.6-4.7-5.3-.2 2.6-2.1 4.8-4.7 5.2"/>
    <path d="M12 13.9v1.6"/>
    <path d="M13.5 5.4c-1-.2-2-.2-3 0"/>
    <path d="M17 16.4c.7-.7 1.2-1.6 1.5-2.5"/>
    <path d="M5.5 13.9c.3.9.8 1.8 1.5 2.5"/>
  `,
  siren: `
    <path d="M7 18v-6a5 5 0 1 1 10 0v6"/>
    <path d="M5 21a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-1a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2z"/>
    <path d="M21 12h1"/>
    <path d="M18.5 4.5 18 5"/>
    <path d="M2 12h1"/>
    <path d="M12 2v1"/>
    <path d="m4.929 4.929.707.707"/>
    <path d="M12 12v6"/>
  `,
  "shield-user": `
    <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>
    <path d="M6.376 18.91a6 6 0 0 1 11.249.003"/>
    <circle cx="12" cy="11" r="4"/>
  `,
  "id-card": `
    <path d="M16 10h2"/>
    <path d="M16 14h2"/>
    <path d="M6.17 15a3 3 0 0 1 5.66 0"/>
    <circle cx="9" cy="11" r="2"/>
    <rect x="2" y="5" width="20" height="14" rx="2"/>
  `,
  key: `
    <path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4"/>
    <path d="m21 2-9.6 9.6"/>
    <circle cx="7.5" cy="15.5" r="5.5"/>
  `,
  stamp: `
    <path d="M14 13V8.5C14 7 15 7 15 5a3 3 0 0 0-6 0c0 2 1 2 1 3.5V13"/>
    <path d="M20 15.5a2.5 2.5 0 0 0-2.5-2.5h-11A2.5 2.5 0 0 0 4 15.5V17a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1z"/>
    <path d="M5 22h14"/>
  `,
  "file-check": `
    <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/>
    <path d="M14 2v5a1 1 0 0 0 1 1h5"/>
    <path d="m9 15 2 2 4-4"/>
  `,
  "file-text": `
    <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/>
    <path d="M14 2v5a1 1 0 0 0 1 1h5"/>
    <path d="M10 9H8"/>
    <path d="M16 13H8"/>
    <path d="M16 17H8"/>
  `,
  "clipboard-check": `
    <rect width="8" height="4" x="8" y="2" rx="1" ry="1"/>
    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
    <path d="m9 14 2 2 4-4"/>
  `,
  "clipboard-list": `
    <rect width="8" height="4" x="8" y="2" rx="1" ry="1"/>
    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
    <path d="M12 11h4"/>
    <path d="M12 16h4"/>
    <path d="M8 11h.01"/>
    <path d="M8 16h.01"/>
  `,
  "calendar-check": `
    <path d="M8 2v4"/>
    <path d="M16 2v4"/>
    <rect width="18" height="18" x="3" y="4" rx="2"/>
    <path d="M3 10h18"/>
    <path d="m9 16 2 2 4-4"/>
  `,
  "badge-check": `
    <path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"/>
    <path d="m9 12 2 2 4-4"/>
  `,
  landmark: `
    <path d="M10 18v-7"/>
    <path d="M11.12 2.198a2 2 0 0 1 1.76.006l7.866 3.847c.476.233.31.949-.22.949H3.474c-.53 0-.695-.716-.22-.949z"/>
    <path d="M14 18v-7"/>
    <path d="M18 18v-7"/>
    <path d="M3 22h18"/>
    <path d="M6 18v-7"/>
  `,
  wallet: `
    <path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/>
    <path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>
  `,
  coins: `
    <path d="M13.744 17.736a6 6 0 1 1-7.48-7.48"/>
    <path d="M15 6h1v4"/>
    <path d="m6.134 14.768.866-.5 2 3.464"/>
    <circle cx="16" cy="8" r="6"/>
  `,
  scale: `
    <path d="M12 3v18"/>
    <path d="m19 8 3 8a5 5 0 0 1-6 0zV7"/>
    <path d="M3 7h1a17 17 0 0 0 8-2 17 17 0 0 0 8 2h1"/>
    <path d="m5 8 3 8a5 5 0 0 1-6 0zV7"/>
    <path d="M7 21h10"/>
  `,
  users: `
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
    <path d="M16 3.128a4 4 0 0 1 0 7.744"/>
    <path d="M22 21v-2a4 4 0 0 0-3-3.87"/>
    <circle cx="9" cy="7" r="4"/>
  `,
  mountain: `
    <path d="m8 3 4 8 5-5 5 15H2L8 3z"/>
  `,
  "tree-pine": `
    <path d="m17 14 3 3.3a1 1 0 0 1-.7 1.7H4.7a1 1 0 0 1-.7-1.7L7 14h-.3a1 1 0 0 1-.7-1.7L9 9h-.2A1 1 0 0 1 8 7.3L12 3l4 4.3a1 1 0 0 1-.8 1.7H15l3 3.3a1 1 0 0 1-.7 1.7H17Z"/>
    <path d="M12 22v-3"/>
  `,
  droplets: `
    <path d="M7 16.3c2.2 0 4-1.83 4-4.05 0-1.16-.57-2.26-1.71-3.19S7.29 6.75 7 5.3c-.29 1.45-1.14 2.84-2.29 3.76S3 11.1 3 12.25c0 2.22 1.8 4.05 4 4.05z"/>
    <path d="M12.56 6.6A10.97 10.97 0 0 0 14 3.02c.5 2.5 2 4.9 4 6.5s3 3.5 3 5.5a6.98 6.98 0 0 1-11.91 4.97"/>
  `,
  flame: `
    <path d="M12 3q1 4 4 6.5t3 5.5a1 1 0 0 1-14 0 5 5 0 0 1 1-3 1 1 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4"/>
  `,
  fuel: `
    <path d="M14 13h2a2 2 0 0 1 2 2v2a2 2 0 0 0 4 0v-6.998a2 2 0 0 0-.59-1.42L18 5"/>
    <path d="M14 21V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v16"/>
    <path d="M2 21h13"/>
    <path d="M3 9h11"/>
  `,
  wind: `
    <path d="M12.8 19.6A2 2 0 1 0 14 16H2"/>
    <path d="M17.5 8a2.5 2.5 0 1 1 2 4H2"/>
    <path d="M9.8 4.4A2 2 0 1 1 11 8H2"/>
  `,
  thermometer: `
    <path d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z"/>
  `,
  "cloud-rain": `
    <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/>
    <path d="M16 14v6"/>
    <path d="M8 14v6"/>
    <path d="M12 16v6"/>
  `,
  radio: `
    <path d="M16.247 7.761a6 6 0 0 1 0 8.478"/>
    <path d="M19.075 4.933a10 10 0 0 1 0 14.134"/>
    <path d="M4.925 19.067a10 10 0 0 1 0-14.134"/>
    <path d="M7.753 16.239a6 6 0 0 1 0-8.478"/>
    <circle cx="12" cy="12" r="2"/>
  `,
  "satellite-dish": `
    <path d="M4 10a7.31 7.31 0 0 0 10 10Z"/>
    <path d="m9 15 3-3"/>
    <path d="M17 13a6 6 0 0 0-6-6"/>
    <path d="M21 13A10 10 0 0 0 11 3"/>
  `,
  // END GENERATED LUCIDE_PATHS
};

/** Hex colors (not Tailwind classes — these go inside SVG strings, not className). */
export const STATUS_STROKE: Record<CheckStatus, string> = {
  "On Track": "#f59e0b", // amber-500
  Completed: "#10b981", // emerald-500
  Behind: "#ef4444", // red-500
  "N/A": "#d4d4d8", // zinc-300
  Available: "#10b981", // emerald-500 — severity "done"
  Pending: "#f59e0b", // amber-500 — severity "in_progress"
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
