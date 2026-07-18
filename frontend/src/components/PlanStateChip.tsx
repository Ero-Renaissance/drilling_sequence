import { Link } from "react-router-dom";

import type { ProjectApprovalSummary } from "@/types";

const TONE_STYLES = {
  green: "border-emerald-600/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  amber: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  red: "border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400",
  neutral: "border-border/70 bg-muted/40 text-muted-foreground",
} as const;

/** The chip's text + tone for a plan state. Exported for direct unit tests. */
export function planStateLabel(a: ProjectApprovalSummary): {
  label: string;
  tone: keyof typeof TONE_STYLES;
} {
  switch (a.status) {
    case "approved":
      return {
        label: a.rev_number != null ? `Approved · Rev ${a.rev_number}` : "Approved",
        tone: "green",
      };
    case "pending_approval":
      // Zero designated approvers can never complete — surface the footgun.
      return a.approvers === 0
        ? { label: "Pending approval · no approvers", tone: "red" }
        : { label: `Pending approval · ${a.signed}/${a.approvers} signed`, tone: "amber" };
    case "pending_review":
      return { label: "Pending endorsement", tone: "amber" };
    case "changes_requested":
      return { label: "Changes requested", tone: "amber" };
    case "rejected":
      return { label: "Rejected", tone: "red" };
    default:
      // "draft", "discarded", or anything unknown: the plan is simply being
      // worked on — no revision represents it.
      return { label: "Draft", tone: "neutral" };
  }
}

/**
 * Compact plan-state chip beside the campaign name — visible on every tab,
 * replacing the retired Overview "Approval" tile. Clicks through to the
 * Approvals tab. While a revision is pending the lock banner carries the
 * detail; this chip is the resting-state indicator (Approved / Draft / …).
 */
export function PlanStateChip({
  projectId,
  approval,
}: {
  projectId: string;
  approval: ProjectApprovalSummary | null | undefined;
}) {
  if (!approval) return null;
  const { label, tone } = planStateLabel(approval);
  return (
    <Link
      to={`/projects/${projectId}/signatures`}
      title="Open the Approvals tab"
      className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-opacity hover:opacity-80 ${TONE_STYLES[tone]}`}
    >
      {label}
    </Link>
  );
}
