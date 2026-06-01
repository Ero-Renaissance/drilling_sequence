import { useEffect, useMemo, useState } from "react";
import { useParams, NavLink } from "react-router-dom";
import {
  ArrowLeft,
  Ban,
  CheckCircle2,
  ChevronDown,
  Circle,
  Clock,
  PenLine,
  Printer,
  RotateCcw,
  XCircle,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  getRevision,
  listRevisions,
  signRevision,
  signReview,
  rejectRevision,
  requestChanges,
  reviewRequestChanges,
  type Revision,
  type RevisionDetail as RevisionDetailType,
} from "@/api/revisions";
import { RevisionDiff } from "@/components/revisions/RevisionDiff";
import { DecisionDialog, type DecisionAction } from "@/components/revisions/DecisionDialog";
import { projectsApi } from "@/api/projects";
import type { Project } from "@/types";
import type { Activity } from "@/api/activities";
import type { CheckCode, CheckStatus } from "@/api/readiness";
import { useAuthStore } from "@/store/auth";
import { DrillChart } from "@/components/chart/DrillChart";
import type { ReadinessMap } from "@/lib/chart-utils";

interface SnapshotRow {
  id: string;
  activity_type: string;
  start_date: string;
  end_date: string;
  well_name: string | null;
  rig_name: string | null;
  location: string | null;
  plan_type: string | null;
  risk: string | null;
  comment: string | null;
  readiness?: Record<string, CheckStatus>;
}

function relativeTime(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

function initials(value: string): string {
  return value
    .split(/[\s.@_-]+/)
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function revLabel(rev: { label: string | null; rev_number: number }): string {
  return rev.label ?? `Rev. ${String(rev.rev_number).padStart(2, "0")}`;
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: RevisionDetailType["status"] }) {
  if (status === "approved") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/12 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="h-3 w-3" />
        Approved
      </span>
    );
  }
  if (status === "discarded") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-xs font-medium text-muted-foreground">
        <XCircle className="h-3 w-3" />
        Discarded
      </span>
    );
  }
  if (status === "rejected") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-red-500/30 bg-red-500/12 px-2 py-0.5 text-xs font-medium text-red-600 dark:text-red-400">
        <Ban className="h-3 w-3" />
        Rejected
      </span>
    );
  }
  if (status === "changes_requested") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-orange-500/30 bg-orange-500/12 px-2 py-0.5 text-xs font-medium text-orange-600 dark:text-orange-400">
        <RotateCcw className="h-3 w-3" />
        Changes requested
      </span>
    );
  }
  if (status === "pending_review") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-sky-500/30 bg-sky-500/12 px-2 py-0.5 text-xs font-medium text-sky-600 dark:text-sky-400">
        <PenLine className="h-3 w-3" />
        In review
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/12 px-2 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
      <Clock className="h-3 w-3" />
      Pending approval
    </span>
  );
}

// ── Reviewer status panel (review stage) ──────────────────────────────────────

function ReviewerPanel({ revision }: { revision: RevisionDetailType }) {
  if (revision.reviewer_status.length === 0) return null;
  const signedCount = revision.reviewer_status.filter((s) => s.signed).length;
  return (
    <div className="rounded-xl border border-sky-500/25 bg-sky-500/[0.04] p-4 shadow-soft-sm print:break-inside-avoid">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">Technical review</h2>
        <span className="text-xs tabular-nums text-muted-foreground">
          {signedCount} of {revision.reviewer_status.length} reviewed
        </span>
      </div>
      <div className="space-y-1.5">
        {revision.reviewer_status.map((r) => (
          <div key={r.email} className="flex items-center gap-2 rounded-md px-1 py-0.5 text-sm">
            {r.signed ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-sky-500" />
            ) : (
              <Circle className="h-4 w-4 shrink-0 text-muted-foreground/40" />
            )}
            <span
              className={cn(
                "min-w-0 truncate font-medium",
                r.signed ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {r.name ?? r.email}
            </span>
            <span className="text-muted-foreground/60">·</span>
            <span className="text-muted-foreground">{r.role_label}</span>
            {r.signed && r.signed_at ? (
              <span className="ml-auto text-xs text-muted-foreground">
                {relativeTime(r.signed_at)}
              </span>
            ) : (
              <span className="ml-auto rounded-full border border-sky-500/30 bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-medium text-sky-600 dark:text-sky-400">
                pending
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Convert snapshot rows back into shapes the live components expect ────────

function snapshotToActivities(rows: SnapshotRow[]): Activity[] {
  return rows.map((r) => ({
    id: r.id,
    project_id: "",
    activity_type: r.activity_type,
    start_date: r.start_date,
    end_date: r.end_date,
    well_name: r.well_name,
    rig_name: r.rig_name,
    project_group: null,
    location: r.location,
    risk: r.risk,
    comment: r.comment,
    plan_type: r.plan_type,
    updated_at: "",
    updated_by_name: null,
    locked_by_revision_id: null,
  }));
}

function snapshotToReadinessMap(rows: SnapshotRow[]): ReadinessMap {
  const map: ReadinessMap = new Map();
  for (const r of rows) {
    if (!r.readiness) continue;
    const checks: Record<string, { status: CheckStatus }> = {};
    for (const [code, status] of Object.entries(r.readiness)) {
      checks[code] = { status };
    }
    map.set(r.id, checks as Record<CheckCode, { status: CheckStatus }>);
  }
  return map;
}

// ── Tabular detail (collapsible) ──────────────────────────────────────────────

function TabularDetail({ rows }: { rows: SnapshotRow[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-border/70 bg-card shadow-soft-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/30 print:hidden"
      >
        <div>
          <div className="text-sm font-semibold text-foreground">Tabular detail</div>
          <p className="text-xs text-muted-foreground">
            Full row-by-row data for every activity in this snapshot
          </p>
        </div>
        <ChevronDown
          className={cn(
            "h-4 w-4 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {/* Always render in print mode regardless of open state */}
      <div className={cn(!open && "hidden print:block")}>
        <div className="overflow-x-auto border-t border-border/70 print:border-0">
          <table className="w-full min-w-max border-collapse text-sm">
            <thead>
              <tr className="border-b border-border/70 bg-muted/30">
                {[
                  "Activity Type",
                  "Start",
                  "End",
                  "Well",
                  "Rig",
                  "Location",
                  "Plan Type",
                  "Risk",
                  "Comment",
                ].map((h) => (
                  <th
                    key={h}
                    className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr
                  key={row.id}
                  className={cn(
                    "border-b border-border/40",
                    i % 2 === 1 && "bg-muted/15",
                  )}
                >
                  <td className="px-3 py-2 font-medium text-foreground">{row.activity_type}</td>
                  <td className="px-3 py-2 text-muted-foreground">{row.start_date}</td>
                  <td className="px-3 py-2 text-muted-foreground">{row.end_date}</td>
                  <td className="px-3 py-2 text-muted-foreground">{row.well_name ?? "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">{row.rig_name ?? "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">{row.location ?? "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">{row.plan_type ?? "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">{row.risk ?? "—"}</td>
                  <td className="max-w-xs px-3 py-2 text-muted-foreground/80">
                    {row.comment ?? ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Signatures display ────────────────────────────────────────────────────────

function SignaturesPanel({ revision }: { revision: RevisionDetailType }) {
  // Required-approver flow takes precedence when configured
  if (revision.approver_status.length > 0) {
    const signedCount = revision.approver_status.filter((s) => s.signed).length;
    return (
      <div className="rounded-xl border border-border/70 bg-card p-4 shadow-soft-sm print:break-inside-avoid">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Required signatures</h2>
          <span className="text-xs tabular-nums text-muted-foreground">
            {signedCount} of {revision.approver_status.length}
          </span>
        </div>
        <div className="space-y-1.5">
          {revision.approver_status.map((a) => (
            <div
              key={a.email}
              className="flex items-center gap-2 rounded-md px-1 py-0.5 text-sm"
            >
              {a.signed ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
              ) : (
                <Circle className="h-4 w-4 shrink-0 text-muted-foreground/40" />
              )}
              <span
                className={cn(
                  "min-w-0 truncate font-medium",
                  a.signed ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {a.name ?? a.email}
              </span>
              <span className="text-muted-foreground/60">·</span>
              <span className="text-muted-foreground">{a.role_label}</span>
              {a.signed && a.signed_at ? (
                <span className="ml-auto text-xs text-muted-foreground">
                  {relativeTime(a.signed_at)}
                </span>
              ) : (
                <span className="ml-auto rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                  pending
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Ad-hoc signatures — chip strip when ≤3, list otherwise
  if (revision.signatures.length === 0) return null;

  if (revision.signatures.length <= 3) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.05] px-4 py-3 print:break-inside-avoid">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Signed by
        </span>
        {revision.signatures.map((sig) => (
          <div
            key={sig.id}
            className="flex items-center gap-2 rounded-full border border-border/60 bg-card px-2 py-1 text-xs"
          >
            <Avatar className="h-5 w-5">
              <AvatarFallback className="bg-emerald-500/15 text-[9px] text-emerald-600 dark:text-emerald-400">
                {initials(sig.user_name ?? "?")}
              </AvatarFallback>
            </Avatar>
            <span className="font-medium text-foreground">{sig.user_name ?? "Unknown"}</span>
            <span className="text-muted-foreground/70">{sig.role_label}</span>
            <span className="text-muted-foreground/70">·</span>
            <span className="text-muted-foreground/70">{relativeTime(sig.signed_at)}</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.04] p-4 print:break-inside-avoid">
      <h2 className="mb-3 text-sm font-semibold text-foreground">Signatures</h2>
      <div className="space-y-1.5">
        {revision.signatures.map((sig) => (
          <div key={sig.id} className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
            <span className="font-medium text-foreground">{sig.user_name ?? "Unknown"}</span>
            <span className="text-muted-foreground/60">·</span>
            <span className="text-muted-foreground">{sig.role_label}</span>
            <span className="ml-auto text-xs text-muted-foreground">
              {relativeTime(sig.signed_at)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function RevisionDetail() {
  const { projectId, revisionId } = useParams<{ projectId: string; revisionId: string }>();
  const [revision, setRevision] = useState<RevisionDetailType | null>(null);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [decision, setDecision] = useState<DecisionAction | null>(null);
  const [deciding, setDeciding] = useState(false);
  // Review stage (separate from the approval-stage decision dialog).
  const [reviewSigning, setReviewSigning] = useState(false);
  const [reviewChangesOpen, setReviewChangesOpen] = useState(false);
  const [reviewDeciding, setReviewDeciding] = useState(false);
  const user = useAuthStore((s) => s.user);

  useEffect(() => {
    if (!projectId || !revisionId) return;
    setLoading(true);
    getRevision(projectId, revisionId)
      .then(setRevision)
      .catch(() => setError("Revision not found"))
      .finally(() => setLoading(false));
  }, [projectId, revisionId]);

  useEffect(() => {
    if (!projectId) return;
    listRevisions(projectId)
      .then(setRevisions)
      .catch(() => setRevisions([]));
    projectsApi
      .get(projectId)
      .then(setProject)
      .catch(() => setProject(null));
  }, [projectId]);

  // Brand the tab/print title so a saved PDF defaults to a meaningful filename.
  useEffect(() => {
    if (project?.name && revision) {
      document.title = `RAEC — ${project.name} — ${revLabel(revision)}`;
    }
    return () => {
      document.title = "Drilling Sequence Planner";
    };
  }, [project, revision]);

  const snapshot = useMemo<SnapshotRow[]>(
    () => (revision ? JSON.parse(revision.snapshot_json) : []),
    [revision],
  );
  const snapshotActivities = useMemo(() => snapshotToActivities(snapshot), [snapshot]);
  const snapshotReadinessMap = useMemo(
    () => snapshotToReadinessMap(snapshot),
    [snapshot],
  );

  async function handleSign() {
    if (!projectId || !revisionId) return;
    setSigning(true);
    setError(null);
    try {
      const updated = await signRevision(projectId, revisionId);
      setRevision((prev) => (prev ? { ...prev, ...updated } : null));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to sign revision");
    } finally {
      setSigning(false);
    }
  }

  async function handleSignReview() {
    if (!projectId || !revisionId) return;
    setReviewSigning(true);
    setError(null);
    try {
      const updated = await signReview(projectId, revisionId);
      setRevision((prev) => (prev ? { ...prev, ...updated } : null));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to sign off review");
    } finally {
      setReviewSigning(false);
    }
  }

  async function handleReviewChanges(reason: string) {
    if (!projectId || !revisionId) return;
    setReviewDeciding(true);
    setError(null);
    try {
      const updated = await reviewRequestChanges(projectId, revisionId, reason);
      setRevision((prev) => (prev ? { ...prev, ...updated } : null));
      setReviewChangesOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to request changes");
    } finally {
      setReviewDeciding(false);
    }
  }

  async function handleDecision(reason: string) {
    if (!projectId || !revisionId || !decision) return;
    setDeciding(true);
    setError(null);
    try {
      const updated =
        decision === "reject"
          ? await rejectRevision(projectId, revisionId, reason)
          : await requestChanges(projectId, revisionId, reason);
      setRevision((prev) => (prev ? { ...prev, ...updated } : null));
      setDecision(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update revision");
    } finally {
      setDeciding(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        Loading revision…
      </div>
    );
  }

  if (error && !revision) {
    return (
      <div className="flex h-64 items-center justify-center text-destructive">{error}</div>
    );
  }

  if (!revision) return null;

  const alreadySigned = user
    ? revision.signatures.some((s) => s.user_id === user.id)
    : false;
  const canSign = revision.status === "pending_approval" && !alreadySigned;
  const canReview = revision.status === "pending_review";

  const statusLabel =
    revision.status === "approved"
      ? "Approved"
      : revision.status === "rejected"
        ? "Rejected"
        : revision.status === "changes_requested"
          ? "Changes requested"
          : revision.status === "discarded"
            ? "Discarded"
            : revision.status === "pending_review"
              ? "In review"
              : "Pending approval";
  const docDate = new Date(revision.created_at).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="space-y-5">
      {/* Inline print stylesheet — keeps it co-located with the page that uses it */}
      <style>{`
        @media print {
          @page { size: A4 landscape; margin: 14mm; }
          /* Force light document tokens so a dark-mode user still gets a clean,
             readable PDF (dark text on white), not light text on white. */
          :root, .dark {
            --background: 0 0% 100%;
            --foreground: 222 24% 12%;
            --card: 0 0% 100%;
            --card-foreground: 222 24% 12%;
            --muted: 220 14% 95%;
            --muted-foreground: 220 9% 40%;
            --border: 220 13% 85%;
          }
          body { background: white !important; }
          aside, header, .print\\:hidden { display: none !important; }
          main { overflow: visible !important; }
          /* Unclip scroll containers + height caps so content paginates across
             pages and the chart legend (below the Gantt) isn't cut off. */
          .overflow-auto, .overflow-y-auto { overflow: visible !important; }
          .h-full, .h-screen { height: auto !important; }
          .shadow-soft-sm, .shadow-soft-md, .shadow-soft-lg { box-shadow: none !important; }
          /* Preserve brand colours (gradient linebar, status badges) in print. */
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          /* Room for the fixed confidentiality footer. */
          main > div { padding-bottom: 12mm; }
        }
      `}</style>

      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <Button variant="ghost" size="icon" asChild className="text-muted-foreground">
          <NavLink to={`/projects/${projectId}/signatures`}>
            <ArrowLeft className="h-4 w-4" />
          </NavLink>
        </Button>
        <h1 className="text-xl font-semibold tracking-tight">{revLabel(revision)}</h1>
        <StatusBadge status={revision.status} />
        {revision.review_skipped && (
          <span
            className="inline-flex items-center rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
            title="The planner submitted this straight to approval, skipping technical review."
          >
            Review skipped
          </span>
        )}

        <div className="ml-auto flex items-center gap-2">
          {canReview && (
            <>
              <Button onClick={handleSignReview} disabled={reviewSigning} data-testid="sign-review">
                <PenLine className="h-4 w-4" />
                {reviewSigning ? "Signing…" : "Sign off review"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setReviewChangesOpen(true)}
                className="text-orange-600 hover:bg-orange-500/10 hover:text-orange-600 dark:text-orange-400"
                data-testid="review-request-changes"
              >
                <RotateCcw className="h-4 w-4" />
                Request changes
              </Button>
            </>
          )}
          {canSign && (
            <Button onClick={handleSign} disabled={signing}>
              <PenLine className="h-4 w-4" />
              {signing ? "Signing…" : "Sign & Approve"}
            </Button>
          )}
          {alreadySigned && revision.status === "pending_approval" && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" /> You have signed
            </span>
          )}
          {revision.status === "pending_approval" && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDecision("request-changes")}
                className="text-orange-600 hover:bg-orange-500/10 hover:text-orange-600 dark:text-orange-400"
                data-testid="request-changes-revision"
              >
                <RotateCcw className="h-4 w-4" />
                Request changes
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDecision("reject")}
                className="text-red-600 hover:bg-red-500/10 hover:text-red-600 dark:text-red-400"
                data-testid="reject-revision"
              >
                <Ban className="h-4 w-4" />
                Reject
              </Button>
            </>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.print()}
            title="Print or save as PDF"
          >
            <Printer className="h-4 w-4" />
            Export PDF
          </Button>
        </div>
      </div>

      {/* Branded document header — only visible when printing */}
      <div className="hidden print:block">
        <div className="flex items-end justify-between gap-6">
          <img
            src="/raec-logo.png"
            alt="Renaissance Africa Energy"
            className="h-11 w-auto"
          />
          <div className="text-right">
            <h1 className="text-lg font-bold tracking-tight text-foreground">
              {project?.name ?? "Drilling Sequence"}
            </h1>
            <p className="text-xs text-muted-foreground">
              {[project?.field, project?.region].filter(Boolean).join(" · ")}
            </p>
          </div>
        </div>
        <img src="/raec-linebar.png" alt="" className="mt-1.5 h-[5px] w-full object-cover" />
        <div className="mt-1.5 flex items-center justify-between text-[11px]">
          <span className="font-semibold uppercase tracking-wider text-muted-foreground">
            Drilling Sequence — Formal Approval Record
          </span>
          <span className="tabular-nums text-foreground">
            {revLabel(revision)} · {statusLabel} · {docDate} · {snapshot.length} activities
          </span>
        </div>
      </div>

      {/* Print-only confidentiality footer (repeats per page in Chrome) */}
      <div className="fixed inset-x-0 bottom-0 hidden border-t border-border/60 bg-white px-3 pt-1 text-[9px] text-muted-foreground print:block">
        Renaissance Africa Energy Company Limited — Confidential ·{" "}
        {project?.name ?? "Drilling Sequence"} · {revLabel(revision)}
      </div>

      {/* Compact metadata bar */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground print:text-[11px]">
        <span className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-card px-2 py-1">
          <span className="font-medium text-foreground">Rev #{revision.rev_number}</span>
        </span>
        <span className="text-muted-foreground/60">·</span>
        <span>
          Created by <span className="font-medium text-foreground">{revision.created_by_name ?? "—"}</span>
        </span>
        <span className="text-muted-foreground/60">·</span>
        <span>{relativeTime(revision.created_at)}</span>
        <span className="text-muted-foreground/60">·</span>
        <span>
          <span className="tabular-nums font-medium text-foreground">{snapshot.length}</span>{" "}
          {snapshot.length === 1 ? "activity" : "activities"}
        </span>
      </div>

      {error && (
        <div
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {error}
        </div>
      )}

      {/* Decision outcome — reviewer's reason for reject / changes-requested */}
      {revision.decision_reason &&
        (revision.status === "rejected" || revision.status === "changes_requested") && (
          <div
            className={cn(
              "rounded-xl border px-4 py-3 text-sm print:break-inside-avoid",
              revision.status === "rejected"
                ? "border-red-500/30 bg-red-500/[0.06]"
                : "border-orange-500/30 bg-orange-500/[0.06]",
            )}
          >
            <div className="flex items-center gap-2 font-medium text-foreground">
              {revision.status === "rejected" ? (
                <Ban className="h-4 w-4 text-red-600 dark:text-red-400" />
              ) : (
                <RotateCcw className="h-4 w-4 text-orange-600 dark:text-orange-400" />
              )}
              {revision.status === "rejected" ? "Rejected" : "Changes requested"}
              {revision.decision_by_name && (
                <span className="font-normal text-muted-foreground">
                  by {revision.decision_by_name}
                </span>
              )}
            </div>
            <p className="mt-1.5 italic text-muted-foreground">“{revision.decision_reason}”</p>
          </div>
        )}

      {/* Technical review (when the revision was routed through review) */}
      <ReviewerPanel revision={revision} />

      {/* Signatures */}
      <SignaturesPanel revision={revision} />

      {/* What changed — diff against a prior revision (or the live plan) */}
      <div className="print:hidden">
        <RevisionDiff projectId={projectId!} target={revision} revisions={revisions} />
      </div>

      {/* Schedule snapshot — Gantt + legend. Flows naturally in print (no forced
          page break, no break-inside-avoid) so it paginates without clipping. The
          export deliberately carries only the approval record + chart + legend;
          the tabular detail is screen-only. */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">Schedule snapshot</h2>
        {snapshotActivities.length > 0 ? (
          <DrillChart
            activities={snapshotActivities}
            readinessMap={snapshotReadinessMap}
          />
        ) : (
          <div className="flex h-32 items-center justify-center rounded-xl border border-dashed text-muted-foreground">
            No activities in this snapshot.
          </div>
        )}
        {snapshotActivities.length > 0 && (
          <div className="print:hidden">
            <TabularDetail rows={snapshot} />
          </div>
        )}
      </div>

      <DecisionDialog
        open={decision !== null}
        action={decision ?? "reject"}
        revLabel={revLabel(revision)}
        loading={deciding}
        onOpenChange={(open) => {
          if (!open) setDecision(null);
        }}
        onConfirm={handleDecision}
      />

      {/* Review-stage request-changes (reviewers can't terminally reject) */}
      <DecisionDialog
        open={reviewChangesOpen}
        action="request-changes"
        revLabel={revLabel(revision)}
        loading={reviewDeciding}
        onOpenChange={(open) => {
          if (!open) setReviewChangesOpen(false);
        }}
        onConfirm={handleReviewChanges}
      />
    </div>
  );
}
