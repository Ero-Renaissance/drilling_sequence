/**
 * Contract classification — surfaced as a Y-axis indicator on the chart,
 * a chip in the activity edit dialog, and the Dashboard "Contract Alerts" KPI.
 *
 * A contract IS its end date: it exists iff an end date is on file, and the
 * date drives the urgency directly. (The old Draft/Completed workflow status
 * is retired — "no contract" is the absence of a record, not a status value.)
 */

// Urgency tiers are keyed to the QUARTERLY approval cadence, not calendar
// gut-feel: "soon" = two approval cycles left (start the renewal/re-tender
// conversation), "critical" = less than one cycle left (the current sitting is
// the last formal opportunity to act before lapse). A rig contract cannot be
// re-tendered in weeks, so a shorter "critical" window would only announce
// problems after the decision window had already closed.
export type ContractUrgency =
  | "healthy" //  > 6 months remaining
  | "soon" //    3 – 6 months remaining (two cycles)
  | "critical" // < 3 months remaining (last cycle)
  | "expired" //  end date is in the past
  | null; //      No contract on file (no record, or a legacy date-less row)

interface ContractLike {
  contract_end: string | null;
}

export function classifyContract(
  contract: ContractLike | null | undefined,
  now: Date = new Date(),
): ContractUrgency {
  if (!contract?.contract_end) return null;
  const end = new Date(contract.contract_end);
  const days = Math.floor((end.getTime() - now.getTime()) / 86_400_000);
  if (days < 0) return "expired";
  if (days < 90) return "critical";
  if (days < 180) return "soon";
  return "healthy";
}

interface UrgencyVisual {
  label: string;
  dotClass: string;
  hex: string;
  tintBg: string;
  tintText: string;
  tintBorder: string;
}

export const URGENCY_VISUAL: Record<
  Exclude<ContractUrgency, null>,
  UrgencyVisual
> = {
  healthy: {
    label: "Healthy",
    dotClass: "bg-emerald-500",
    hex: "#10b981",
    tintBg: "bg-emerald-500/12",
    tintText: "text-emerald-600 dark:text-emerald-400",
    tintBorder: "border-emerald-500/30",
  },
  soon: {
    label: "Expiring soon",
    dotClass: "bg-amber-500",
    hex: "#f59e0b",
    tintBg: "bg-amber-500/12",
    tintText: "text-amber-600 dark:text-amber-400",
    tintBorder: "border-amber-500/30",
  },
  critical: {
    label: "Critical (< 3 months)",
    dotClass: "bg-orange-500",
    hex: "#f97316",
    tintBg: "bg-orange-500/12",
    tintText: "text-orange-600 dark:text-orange-400",
    tintBorder: "border-orange-500/30",
  },
  expired: {
    label: "Expired",
    dotClass: "bg-red-600",
    hex: "#dc2626",
    tintBg: "bg-red-500/15",
    tintText: "text-red-600 dark:text-red-400",
    tintBorder: "border-red-500/35",
  },
};

/**
 * The contract-expiration DATE MARKER on the sequence chart and the printed
 * sequence — ALWAYS this one red, whether the contract has expired or is years
 * out. The mark states a FACT (the date this rig's contract ends), so it must
 * not shift colour with proximity: a planner scanning the sequence has to spot
 * the wall at any distance, and a marker that fades to a "milder" colour when
 * the date is far away hides exactly the long-range case worth catching.
 *
 * Urgency GRADING (green→amber→orange→red by time remaining) belongs to
 * URGENCY_VISUAL above, which colours a CONTRACT's own status chip on the
 * Fleet tab and the Overview's Contracts-at-Risk tile — not this date marker.
 */
export const CONTRACT_MARKER_HEX = URGENCY_VISUAL.expired.hex;

/** Returns days until contract_end (negative if expired). Null if no date. */
export function daysUntilExpiry(
  contract: ContractLike | null | undefined,
  now: Date = new Date(),
): number | null {
  if (!contract?.contract_end) return null;
  const end = new Date(contract.contract_end);
  return Math.floor((end.getTime() - now.getTime()) / 86_400_000);
}
