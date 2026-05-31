import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2 } from "lucide-react";
import { fetchDashboard, type DashboardResponse } from "@/api/dashboard";

type Tone = "neutral" | "good" | "warn" | "bad";

const TONE: Record<Tone, string> = {
  neutral: "text-foreground",
  good: "text-foreground",
  warn: "text-amber-600 dark:text-amber-400",
  bad: "text-destructive",
};

function Tile({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: Tone;
}) {
  return (
    <div className="rounded-xl border border-border/70 bg-card p-4 shadow-soft-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${TONE[tone]}`}>{value}</p>
      {sub ? <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

function plural(n: number, one: string, many = one + "s"): string {
  return `${n} ${n === 1 ? one : many}`;
}

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  pending_approval: "Pending approval",
  approved: "Approved",
  changes_requested: "Changes requested",
  rejected: "Rejected",
  discarded: "Discarded",
};

const STATUS_TONE: Record<string, Tone> = {
  approved: "good",
  pending_approval: "warn",
  changes_requested: "bad",
  rejected: "bad",
  draft: "neutral",
  discarded: "neutral",
};

function readinessTone(pct: number | null): Tone {
  if (pct === null) return "neutral";
  if (pct >= 80) return "good";
  if (pct >= 50) return "warn";
  return "bad";
}

function WatchRow({ count, label, to }: { count: number; label: string; to: string }) {
  if (!count) return null;
  return (
    <Link
      to={to}
      className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2 text-sm transition-colors hover:bg-muted/50"
    >
      <span>{label}</span>
      <span className="ml-3 shrink-0 rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-semibold text-destructive">
        {count}
      </span>
    </Link>
  );
}

export function ProjectDashboard({ projectId }: { projectId: string }) {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setData(null);
    setError(null);
    fetchDashboard(projectId)
      .then((d) => active && setData(d))
      .catch(() => active && setError("Couldn't load the dashboard."));
    return () => {
      active = false;
    };
  }, [projectId]);

  if (error) return <p className="py-12 text-center text-sm text-destructive">{error}</p>;
  if (!data) return <p className="py-12 text-center text-sm text-muted-foreground">Loading dashboard…</p>;

  const { readiness, rigs, contracts, approval, watchlist } = data;
  const base = `/projects/${projectId}`;

  const contractsAtRisk = contracts.expired + contracts.critical + contracts.soon;
  const watchlistTotal =
    watchlist.near_term_not_ready +
    watchlist.overdue +
    watchlist.conflicts +
    watchlist.past_contract +
    watchlist.contracts_expiring +
    watchlist.high_risk_near_term +
    watchlist.stale_approval +
    watchlist.drift_since_approved;

  return (
    <div className="space-y-6">
      {/* Hero tiles */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile
          label="Readiness · next 12 months"
          value={readiness.overall_pct === null ? "—" : `${readiness.overall_pct}%`}
          sub={`${readiness.ready}/${readiness.focus_count} ready · ${readiness.behind_cells} behind`}
          tone={readinessTone(readiness.overall_pct)}
        />
        <Tile
          label="Approval"
          value={STATUS_LABEL[approval.current_status] ?? approval.current_status}
          sub={
            approval.current_status === "pending_approval"
              ? `${approval.signed}/${approval.approvers} signed`
              : approval.approvers === 0
                ? "No approvers configured"
                : undefined
          }
          tone={STATUS_TONE[approval.current_status] ?? "neutral"}
        />
        <Tile
          label="Rigs in use"
          value={String(rigs.in_use)}
          sub={`${plural(rigs.total_idle_days, "idle rig-day")}`}
        />
        <Tile
          label="Contracts at risk"
          value={String(contractsAtRisk)}
          sub={`${contracts.expired} expired · ${contracts.critical} critical · ${contracts.soon} soon`}
          tone={contracts.expired || contracts.critical ? "bad" : contracts.soon ? "warn" : "good"}
        />
      </div>

      {/* Needs attention */}
      <div>
        <h3 className="mb-2 text-sm font-semibold text-foreground">Needs attention</h3>
        {watchlistTotal === 0 ? (
          <div className="flex items-center gap-2 rounded-lg border border-border/60 px-3 py-3 text-sm text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            All clear — nothing needs your attention right now.
          </div>
        ) : (
          <div className="space-y-2">
            <WatchRow
              count={watchlist.near_term_not_ready}
              label={`${plural(watchlist.near_term_not_ready, "activity", "activities")} starting soon and not ready`}
              to={`${base}/readiness?focus=not-ready`}
            />
            <WatchRow
              count={watchlist.overdue}
              label={`${plural(watchlist.overdue, "activity", "activities")} overdue (past due, not marked complete)`}
              to={`${base}/data?focus=overdue`}
            />
            <WatchRow
              count={watchlist.conflicts}
              label={`${plural(watchlist.conflicts, "rig conflict")} blocking submission`}
              to={`${base}/data?focus=conflicts`}
            />
            <WatchRow
              count={watchlist.past_contract}
              label={`${plural(watchlist.past_contract, "activity", "activities")} scheduled past the rig's contract end`}
              to={`${base}/data?focus=past-contract`}
            />
            <WatchRow
              count={watchlist.contracts_expiring}
              label={`${plural(watchlist.contracts_expiring, "rig contract")} expiring soon`}
              to={`${base}/chart`}
            />
            <WatchRow
              count={watchlist.high_risk_near_term}
              label={`${plural(watchlist.high_risk_near_term, "high-risk activity", "high-risk activities")} starting soon`}
              to={`${base}/data?focus=high-risk`}
            />
            <WatchRow
              count={watchlist.stale_approval}
              label="A revision has been pending approval over a week"
              to={`${base}/signatures`}
            />
            <WatchRow
              count={watchlist.drift_since_approved}
              label={`${plural(watchlist.drift_since_approved, "change")} since the last approved plan`}
              to={`${base}/compare`}
            />
          </div>
        )}
      </div>
    </div>
  );
}
