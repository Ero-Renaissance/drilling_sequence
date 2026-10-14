import {
  Banknote,
  CircleDot,
  DraftingCompass,
  FilePenLine,
  Forklift,
  Gavel,
  HandCoins,
  Handshake,
  LandPlot,
  Leaf,
  MapPin,
  Receipt,
  ShieldCheck,
  Ship,
  Truck,
  type LucideIcon,
} from "lucide-react";
import { RotaryTable } from "./rotary-table-icon";

/**
 * The owned icon registry readiness checks draw from. A catalog check names an
 * `icon_key`; admins pick from this list and can never upload SVG (the icons are
 * embedded in the HTML/PDF export). Must stay identical to `ICON_KEYS` in
 * backend/app/models/readiness.py and to the canvas paths in
 * lib/check-icon-svg.ts — src/test/readiness-catalog.test.tsx and
 * backend/tests/test_readiness_catalog.py enforce both.
 */
export const ICON_KEYS = [
  "land-plot",
  "rotary-table",
  "map-pin",
  "drafting-compass",
  "gavel",
  "leaf",
  "banknote",
  // Phase 4 — Logistics
  "truck",
  "hand-coins",
  "file-signature",
  "forklift",
  "shield-check",
  "handshake",
  "receipt",
  "ship",
] as const;
export type IconKey = (typeof ICON_KEYS)[number];

export const CHECK_ICONS: Record<IconKey, LucideIcon> = {
  "land-plot": LandPlot,
  // Rotary table (the drilling "rotary wheel") — per user request, the LLI gate
  // wears rig-floor iconography rather than a generic materials cylinder.
  "rotary-table": RotaryTable,
  "map-pin": MapPin,
  "drafting-compass": DraftingCompass,
  gavel: Gavel,
  leaf: Leaf,
  banknote: Banknote,
  truck: Truck,
  "hand-coins": HandCoins,
  // lucide's FileSignature is an alias of FilePenLine (same paths).
  "file-signature": FilePenLine,
  forklift: Forklift,
  "shield-check": ShieldCheck,
  handshake: Handshake,
  receipt: Receipt,
  ship: Ship,
};

/** The React icon for a check's `icon_key`; a neutral dot for an unknown key
 *  (e.g. a newer catalog than this build) rather than a crash. */
export function checkIcon(iconKey: string): LucideIcon {
  return CHECK_ICONS[iconKey as IconKey] ?? CircleDot;
}
