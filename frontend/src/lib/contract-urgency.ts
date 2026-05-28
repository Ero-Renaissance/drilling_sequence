/**
 * Contract classification — surfaced as a Y-axis indicator on the chart,
 * a chip in the activity edit dialog, and the Dashboard "Contract Alerts" KPI.
 *
 * The rig contract is a WORKFLOW ITEM with an explicit status. Dates only
 * become binding (and only drive an expiry urgency) when the planner marks
 * the contract as "Completed" — every other workflow state communicates the
 * negotiation phase, not an in-force agreement.
 */

import type { ContractStatus } from "@/api/contracts";

export type ContractUrgency =
  | "healthy" //  Completed contract, > 90 days remaining
  | "soon" //    Completed contract, 30 – 90 days remaining
  | "critical" // Completed contract, 0 – 30 days remaining
  | "expired" //  Completed contract, end date is in the past
  | "incomplete" // Completed contract but no end date entered yet
  | "in_progress" // Workflow: under negotiation
  | "not_started" // Workflow: paperwork hasn't begun
  | "na" //       Workflow: rig doesn't need a contract
  | null; //      No contract record on file

interface ContractLike {
  status?: ContractStatus;
  contract_end: string | null;
}

export function classifyContract(
  contract: ContractLike | null | undefined,
  now: Date = new Date(),
): ContractUrgency {
  if (!contract) return null;

  switch (contract.status) {
    case "N/A":
      return "na";
    case "Not Started":
      return "not_started";
    case "In Progress":
      return "in_progress";
    case "Completed":
    case undefined: {
      // status missing only for very old data — treat as Completed-ish so the
      // existing date-driven urgency still surfaces. New API responses always
      // include status.
      if (!contract.contract_end) return "incomplete";
      const end = new Date(contract.contract_end);
      const days = Math.floor((end.getTime() - now.getTime()) / 86_400_000);
      if (days < 0) return "expired";
      if (days < 30) return "critical";
      if (days < 90) return "soon";
      return "healthy";
    }
  }
  return null;
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
    label: "Critical (< 30d)",
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
  incomplete: {
    label: "Signed — no end date",
    dotClass: "bg-zinc-400",
    hex: "#a1a1aa",
    tintBg: "bg-muted",
    tintText: "text-muted-foreground",
    tintBorder: "border-border",
  },
  in_progress: {
    label: "Under negotiation",
    dotClass: "bg-amber-500",
    hex: "#f59e0b",
    tintBg: "bg-amber-500/12",
    tintText: "text-amber-600 dark:text-amber-400",
    tintBorder: "border-amber-500/30",
  },
  not_started: {
    label: "Not started",
    dotClass: "bg-zinc-400 dark:bg-zinc-500",
    hex: "#a1a1aa",
    tintBg: "bg-muted",
    tintText: "text-muted-foreground",
    tintBorder: "border-border",
  },
  na: {
    label: "Not applicable",
    dotClass: "bg-zinc-300 dark:bg-zinc-600",
    hex: "#d4d4d8",
    tintBg: "bg-muted",
    tintText: "text-muted-foreground",
    tintBorder: "border-border",
  },
};

/** The four urgencies tied to an in-force contract — used by the chart Y-axis
 *  AlarmClock formatter, which only renders the clock for these states. */
export const COMPLETED_URGENCIES: Array<Exclude<ContractUrgency, null>> = [
  "healthy",
  "soon",
  "critical",
  "expired",
  "incomplete",
];

export function isCompletedUrgency(u: ContractUrgency): boolean {
  return u !== null && COMPLETED_URGENCIES.includes(u);
}

/** Returns days until contract_end (negative if expired). Null if no date. */
export function daysUntilExpiry(
  contract: ContractLike | null | undefined,
  now: Date = new Date(),
): number | null {
  if (!contract?.contract_end) return null;
  const end = new Date(contract.contract_end);
  return Math.floor((end.getTime() - now.getTime()) / 86_400_000);
}
