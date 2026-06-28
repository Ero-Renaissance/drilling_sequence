/**
 * Contract classification — surfaced as a Y-axis indicator on the chart,
 * a chip in the activity edit dialog, and the Dashboard "Contract Alerts" KPI.
 *
 * The rig contract is a two-state WORKFLOW ITEM. Dates only become binding (and
 * only drive an expiry urgency) when the planner marks the contract "Completed"
 * (signed/in force); a "Draft" contract is still being prepared, so its dates
 * aren't binding.
 */

import type { ContractStatus } from "@/api/contracts";

export type ContractUrgency =
  | "healthy" //  Completed contract, > 90 days remaining
  | "soon" //    Completed contract, 30 – 90 days remaining
  | "critical" // Completed contract, 0 – 30 days remaining
  | "expired" //  Completed contract, end date is in the past
  | "incomplete" // Completed contract but no end date entered yet
  | "draft" //   Draft contract — not yet in force, dates aren't binding
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
    case "Draft":
      return "draft";
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
  draft: {
    label: "Draft",
    dotClass: "bg-zinc-400 dark:bg-zinc-500",
    hex: "#a1a1aa",
    tintBg: "bg-muted",
    tintText: "text-muted-foreground",
    tintBorder: "border-border",
  },
};

/** Returns days until contract_end (negative if expired). Null if no date. */
export function daysUntilExpiry(
  contract: ContractLike | null | undefined,
  now: Date = new Date(),
): number | null {
  if (!contract?.contract_end) return null;
  const end = new Date(contract.contract_end);
  return Math.floor((end.getTime() - now.getTime()) / 86_400_000);
}
