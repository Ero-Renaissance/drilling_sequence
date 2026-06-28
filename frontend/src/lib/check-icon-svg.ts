/**
 * SVG path data for each readiness-check icon, extracted from lucide-react v0.400.0
 * so we can render the same iconography inside the ECharts canvas (where React
 * components can't be used).
 *
 * Each entry is a list of `<path d="...">` strings. We assemble a self-contained
 * SVG document on demand, sub in the stroke color for the current readiness
 * status, and pass it to ECharts as an image data-URI.
 */

import type { CheckCode, CheckStatus } from "@/api/readiness";

const LUCIDE_PATHS: Record<CheckCode, string> = {
  FDP: `
    <path d="m12 8 6-3-6-3v10"/>
    <path d="m8 11.99-5.5 3.14a1 1 0 0 0 0 1.74l8.5 4.86a2 2 0 0 0 2 0l8.5-4.86a1 1 0 0 0 0-1.74L16 12"/>
    <path d="m6.49 12.85 11.02 6.3"/>
    <path d="M17.51 12.85 6.5 19.15"/>
  `,
  LLI: `
    <path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/>
    <path d="M15 18H9"/>
    <path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/>
    <circle cx="17" cy="18" r="2"/>
    <circle cx="7" cy="18" r="2"/>
  `,
  LOC: `
    <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/>
    <circle cx="12" cy="10" r="3"/>
  `,
  FE: `
    <circle cx="12" cy="5" r="2"/>
    <path d="m3 21 8.02-14.26"/>
    <path d="m12.99 6.74 1.93 3.44"/>
    <path d="M19 12c-3.87 4-10.13 4-14 0"/>
    <path d="m21 21-2.16-3.84"/>
  `,
  FID: `
    <path d="m14.5 12.5-8 8a2.119 2.119 0 1 1-3-3l8-8"/>
    <path d="m16 16 6-6"/>
    <path d="m8 8 6-6"/>
    <path d="m9 7 8 8"/>
    <path d="m21 11-8-8"/>
  `,
  EIA: `
    <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/>
    <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>
  `,
  BUD: `
    <rect width="20" height="12" x="2" y="6" rx="2"/>
    <circle cx="12" cy="12" r="2"/>
    <path d="M6 12h.01M18 12h.01"/>
  `,
};

/** Hex colors (not Tailwind classes — these go inside SVG strings, not className). */
export const STATUS_STROKE: Record<CheckStatus, string> = {
  "On Track": "#f59e0b", // amber-500
  Completed: "#10b981", // emerald-500
  Behind: "#ef4444", // red-500
  "N/A": "#d4d4d8", // zinc-300
};

/** Build a self-contained SVG string for a given check + status. */
export function buildCheckSvg(code: CheckCode, status: CheckStatus): string {
  const stroke = STATUS_STROKE[status];
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" ` +
    `stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
    LUCIDE_PATHS[code] +
    `</svg>`
  );
}

/** Build a `data:image/svg+xml;utf8,...` URI suitable for ECharts `image.style.image`. */
export function buildCheckSvgDataUri(code: CheckCode, status: CheckStatus): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(buildCheckSvg(code, status))}`;
}

// ── AlarmClock — used as the rig-level contract expiry icon ───────────────────

const ALARM_CLOCK_PATHS = `
  <circle cx="12" cy="13" r="8"/>
  <path d="M12 9v4l2 2"/>
  <path d="M5 3 2 6"/>
  <path d="m22 6-3-3"/>
  <path d="M6.38 18.7 4 21"/>
  <path d="M17.64 18.67 20 21"/>
`;

export function buildAlarmClockSvg(strokeHex: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" ` +
    `stroke="${strokeHex}" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round">` +
    ALARM_CLOCK_PATHS +
    `</svg>`
  );
}

export function buildAlarmClockSvgDataUri(strokeHex: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(buildAlarmClockSvg(strokeHex))}`;
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
