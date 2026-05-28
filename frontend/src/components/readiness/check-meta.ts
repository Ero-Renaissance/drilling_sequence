import {
  Banknote,
  FileSignature,
  Gavel,
  Leaf,
  MapPin,
  Mountain,
  Truck,
  Waves,
  type LucideIcon,
} from "lucide-react";
import type { CheckCode, CheckStatus } from "@/api/readiness";

/**
 * Single source of truth for how each readiness check is presented.
 * Shape (icon) encodes WHICH check; color (per CheckStatus) encodes status.
 */
export const CHECK_META: Record<CheckCode, { label: string; icon: LucideIcon }> = {
  BUD: { label: "Budget", icon: Banknote },
  LLI: { label: "Long Lead Items", icon: Truck },
  LOC: { label: "Location", icon: MapPin },
  FID: { label: "Final Inv. Decision", icon: Gavel },
  EIA: { label: "Env. Assessment", icon: Leaf },
  FLOOD: { label: "Flood Assessment", icon: Waves },
  SUBS: { label: "Subsurface", icon: Mountain },
  CON: { label: "Contract", icon: FileSignature },
};

/**
 * Color applied to the icon stroke per status.
 *   Not Started → grey   (muted, looks "inactive")
 *   In Progress → amber  (work-in-flight)
 *   Completed   → green  (done)
 *   N/A         → muted + strikethrough (does not apply)
 */
export const STATUS_ICON_COLOR: Record<CheckStatus, string> = {
  "Not Started": "text-zinc-400 dark:text-zinc-500",
  "In Progress": "text-amber-500",
  Completed: "text-emerald-500",
  Behind: "text-red-500",
  "N/A": "text-zinc-300 dark:text-zinc-600 line-through",
};

/**
 * Solid status dot — used in the legend strip and as a sub-indicator alongside
 * the icon if we ever need both. Kept here so the legend stays in lockstep with
 * what cells render.
 */
export const STATUS_DOT: Record<CheckStatus, string> = {
  "Not Started": "bg-zinc-400 dark:bg-zinc-500",
  "In Progress": "bg-amber-500",
  Completed: "bg-emerald-500",
  Behind: "bg-red-500",
  "N/A": "bg-white ring-1 ring-zinc-300 dark:bg-zinc-100 dark:ring-zinc-400",
};
