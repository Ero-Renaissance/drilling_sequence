import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  CheckCircle2,
  ChevronRight,
  Circle,
  Clock,
  ExternalLink,
  GitCompare,
  PenLine,
  RefreshCw,
  RotateCcw,
  Trash2,
  Ban,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  listRevisions,
  discardRevision,
  type Revision,
  type ApproverSignStatus,
} from "@/api/revisions";
import { CreateRevisionDialog } from "./CreateRevisionDialog";

function relativeTime(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

function revLabel(rev: Revision): string {
  return rev.label ?? `Rev. ${String(rev.rev_number).padStart(2, "0")}`;
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: Revision["status"] }) {
  if (status === "approved") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/12 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="h-3 w-3" />
        Approved
      </span>
    );
  }
  if (status === "discarded") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
        <XCircle className="h-3 w-3" />
        Discarded
      </span>
    );
  }
  if (status === "rejected") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-red-500/30 bg-red-500/12 px-2 py-0.5 text-[11px] font-medium text-red-600 dark:text-red-400">
        <Ban className="h-3 w-3" />
        Rejected
      </span>
    );
  }
  if (status === "changes_requested") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-orange-500/30 bg-orange-500/12 px-2 py-0.5 text-[11px] font-medium text-orange-600 dark:text-orange-400">
        <RotateCcw className="h-3 w-3" />
        Changes requested
      </span>
    );
  }
  if (status === "pending_review") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-sky-500/30 bg-sky-500/12 px-2 py-0.5 text-[11px] font-medium text-sky-600 dark:text-sky-400">
        <PenLine className="h-3 w-3" />
        In review
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/12 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
      <Clock className="h-3 w-3" />
      Pending approval
    </span>
  );
}

function ReviewSkippedBadge() {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
      title="The planner submitted this straight to approval, skipping review."
    >
      Review skipped
    </span>
  );
}

// ── Required-approver progress row ────────────────────────────────────────────

function ApproverStatusList({
  statuses,
  title = "Required signatures",
}: {
  statuses: ApproverSignStatus[];
  title?: string;
}) {
  if (statuses.length === 0) return null;
  const signedCount = statuses.filter((s) => s.signed).length;
  return (
    <div className="mt-3 border-t border-border/70 pt-3">
      <div className="mb-1.5 flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {title}
        </p>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {signedCount} of {statuses.length}
        </span>
      </div>
      <div className="space-y-1">
        {statuses.map((s) => (
          <div
            key={s.email}
            className="flex items-center gap-2 rounded-md px-1 py-0.5 text-xs"
          >
            {s.signed ? (
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
            ) : (
              <Circle className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />
            )}
            <span
              className={cn(
                "min-w-0 truncate font-medium",
                s.signed ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {s.name ?? s.email}
            </span>
            <span className="text-muted-foreground/60">·</span>
            <span className="text-muted-foreground">{s.role_label}</span>
            {s.signed && s.signer_name && s.signer_name !== s.name && (
              <>
                <span className="text-muted-foreground/60">·</span>
                <span className="text-muted-foreground">signed by {s.signer_name}</span>
              </>
            )}
            {!s.signed && (
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

// ── Pending revision card (prominent — the work) ──────────────────────────────

function PendingRevisionCard({
  projectId,
  rev,
  actionLoading,
  onDiscard,
}: {
  projectId: string;
  rev: Revision;
  actionLoading: string | null;
  onDiscard: (r: Revision) => void;
}) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-amber-500/30 bg-amber-500/[0.04] p-5 shadow-soft-sm">
      <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-amber-500/60 via-amber-500 to-amber-500/60" />

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to={`/projects/${projectId}/revisions/${rev.id}`}
              className="text-base font-semibold tracking-tight text-foreground hover:underline"
            >
              {revLabel(rev)}
            </Link>
            <StatusBadge status={rev.status} />
            {rev.review_skipped && <ReviewSkippedBadge />}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Created by {rev.created_by_name ?? "Unknown"} · {relativeTime(rev.created_at)}
          </p>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {rev.status === "pending_review"
              ? "Awaiting review before it can go to approval."
              : "Review the changes and schedule snapshot before deciding."}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button size="sm" asChild data-testid="review-revision">
            <Link to={`/projects/${projectId}/revisions/${rev.id}`}>
              <GitCompare className="h-3.5 w-3.5" />
              <span className="ml-1.5">
                {rev.status === "pending_review" ? "Open & review" : "Review & sign"}
              </span>
            </Link>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onDiscard(rev)}
            disabled={actionLoading === rev.id}
            className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            data-testid="discard-revision"
            title="Discard revision"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {rev.reviewer_status.length > 0 && (
        <ApproverStatusList statuses={rev.reviewer_status} title="Required reviews" />
      )}

      {rev.approver_status.length > 0 && <ApproverStatusList statuses={rev.approver_status} />}

      {rev.approver_status.length === 0 && rev.signatures.length > 0 && (
        <AdHocSignaturesList rev={rev} />
      )}
    </div>
  );
}

// ── Historical revision row (compact) ─────────────────────────────────────────

function HistoryRow({
  projectId,
  rev,
}: {
  projectId: string;
  rev: Revision;
}) {
  return (
    <Link
      to={`/projects/${projectId}/revisions/${rev.id}`}
      className={cn(
        "group flex items-center gap-3 rounded-lg border border-border/60 bg-card px-4 py-3 transition-all hover:border-border hover:shadow-soft-sm",
        rev.status === "discarded" && "opacity-70",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">{revLabel(rev)}</span>
          <StatusBadge status={rev.status} />
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {rev.created_by_name ?? "Unknown"} · {relativeTime(rev.created_at)}
          {rev.approver_status.length > 0 && (
            <>
              {" · "}
              <span className="tabular-nums">
                {rev.approver_status.filter((s) => s.signed).length}/
                {rev.approver_status.length} signed
              </span>
            </>
          )}
        </p>
        {rev.decision_reason && (
          <p className="mt-1 truncate text-xs italic text-muted-foreground/90">
            “{rev.decision_reason}”
            {rev.decision_by_name && (
              <span className="not-italic text-muted-foreground/70">
                {" "}— {rev.decision_by_name}
              </span>
            )}
          </p>
        )}
      </div>
      <ChevronRight className="h-4 w-4 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5 group-hover:text-muted-foreground" />
    </Link>
  );
}

function AdHocSignaturesList({ rev }: { rev: Revision }) {
  return (
    <div className="mt-3 border-t border-border/70 pt-3">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        Signatures
      </p>
      <div className="space-y-1">
        {rev.signatures.map((sig) => (
          <div
            key={sig.id}
            className="flex items-center gap-2 text-xs text-muted-foreground"
          >
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
            <span className="font-medium text-foreground">{sig.user_name ?? "Unknown"}</span>
            <span className="text-muted-foreground/60">·</span>
            <span>{sig.role_label}</span>
            <span className="text-muted-foreground/60">·</span>
            <span>{relativeTime(sig.signed_at)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface RevisionListProps {
  projectId: string;
}

export function RevisionList({ projectId }: RevisionListProps) {
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRevisions(await listRevisions(projectId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load revisions");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleDiscard(revision: Revision) {
    if (!confirm(`Discard "${revLabel(revision)}"? This will unlock all activities.`)) return;
    setActionLoading(revision.id);
    setError(null);
    try {
      await discardRevision(projectId, revision.id);
      setRevisions((prev) =>
        prev.map((r) => (r.id === revision.id ? { ...r, status: "discarded" } : r)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to discard revision");
    } finally {
      setActionLoading(null);
    }
  }

  const isOpen = (s: Revision["status"]) =>
    s === "pending_approval" || s === "pending_review";
  const pending = revisions.filter((r) => isOpen(r.status));
  const history = revisions.filter((r) => !isOpen(r.status));

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-card px-3 py-2 shadow-soft-sm">
        <CreateRevisionDialog
          projectId={projectId}
          onCreated={(rev) => {
            setRevisions((prev) => [rev, ...prev]);
          }}
        />
        <div className="mx-1 h-4 w-px bg-border" />
        <Button
          variant="ghost"
          size="sm"
          onClick={load}
          disabled={loading}
          className="text-muted-foreground"
        >
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          <span className="ml-1.5">Refresh</span>
        </Button>
        {pending.length > 0 && (
          <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-700 dark:text-amber-400">
            <Clock className="h-3 w-3" />
            Activities locked — revision open
          </span>
        )}
      </div>

      {error && (
        <div
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {error}
        </div>
      )}

      {/* Empty state */}
      {revisions.length === 0 && !loading && (
        <div className="flex h-48 items-center justify-center rounded-xl border border-dashed border-border/70 text-muted-foreground">
          <div className="text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <PenLine className="h-5 w-5" />
            </div>
            <p className="font-medium text-foreground">No revisions yet</p>
            <p className="text-sm">Create a revision to start the approval workflow.</p>
          </div>
        </div>
      )}

      {/* Pending revisions — prominent */}
      {pending.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Awaiting your action
          </h3>
          {pending.map((rev) => (
            <PendingRevisionCard
              key={rev.id}
              projectId={projectId}
              rev={rev}
              actionLoading={actionLoading}
              onDiscard={handleDiscard}
            />
          ))}
        </div>
      )}

      {/* History — compact list */}
      {history.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              History
              <span className="ml-2 normal-case tracking-normal text-muted-foreground/70">
                {history.length} revision{history.length !== 1 ? "s" : ""}
              </span>
            </h3>
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/60">
              <ExternalLink className="h-3 w-3" /> click to open
            </span>
          </div>
          <div className="space-y-1.5">
            {history.map((rev) => (
              <HistoryRow key={rev.id} projectId={projectId} rev={rev} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
