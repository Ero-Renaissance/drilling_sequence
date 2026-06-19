import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2 } from "lucide-react";
import { fetchDashboard, type DashboardResponse, type GateBreakdown } from "@/api/dashboard";
import { getActivityColor } from "@/lib/chart-colors";

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

// ── Breakdown panel (Phase 2) ────────────────────────────────────────────────

const GATE_COLORS = {
  completed: "#16a34a",
  in_progress: "#f59e0b",
  behind: "#ef4444",
  not_started: "#94a3b8",
  na: "#cbd5e1",
} as const;

const PLAN_COLORS: Record<string, string> = {
  Firm: "#16a34a",
  Option: "#f59e0b",
  "Out of Plan": "#94a3b8",
};

function BreakdownCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border/70 bg-card p-4 shadow-soft-sm">
      <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
      {children}
    </div>
  );
}

/** Label · proportional bar · count, sorted by the caller. */
function BarList({ items, max }: { items: { label: string; value: number; color: string }[]; max: number }) {
  if (items.length === 0) return <p className="text-xs text-muted-foreground">No data yet.</p>;
  return (
    <div className="space-y-1.5">
      {items.map((it) => (
        <div key={it.label} className="flex items-center gap-2">
          <span className="w-28 shrink-0 truncate text-xs text-muted-foreground" title={it.label}>
            {it.label}
          </span>
          <div className="h-3 flex-1 overflow-hidden rounded-sm bg-muted">
            <div
              className="h-full rounded-sm"
              style={{ width: `${(it.value / max) * 100}%`, backgroundColor: it.color }}
            />
          </div>
          <span className="w-8 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
            {it.value}
          </span>
        </div>
      ))}
    </div>
  );
}

/** A gate's 5-status split as a single stacked bar. */
function GateRow({ gate }: { gate: GateBreakdown }) {
  const total =
    gate.completed + gate.in_progress + gate.not_started + gate.behind + gate.na;
  const seg = (value: number, color: string) =>
    value > 0 ? (
      <div className="h-full" style={{ width: `${(value / total) * 100}%`, backgroundColor: color }} />
    ) : null;
  return (
    <div className="flex items-center gap-2">
      <span className="w-10 shrink-0 text-xs font-medium text-muted-foreground">{gate.code}</span>
      <div className="flex h-3 flex-1 overflow-hidden rounded-sm bg-muted">
        {total > 0 && (
          <>
            {seg(gate.completed, GATE_COLORS.completed)}
            {seg(gate.in_progress, GATE_COLORS.in_progress)}
            {seg(gate.behind, GATE_COLORS.behind)}
            {seg(gate.not_started, GATE_COLORS.not_started)}
            {seg(gate.na, GATE_COLORS.na)}
          </>
        )}
      </div>
      <span className="w-6 shrink-0 text-right text-xs font-semibold tabular-nums text-destructive">
        {gate.behind > 0 ? gate.behind : ""}
      </span>
    </div>
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

  const { activities, readiness, rigs, contracts, approval, watchlist } = data;
  const base = `/projects/${projectId}`;

  const contractsAtRisk = contracts.expired + contracts.critical + contracts.soon;
  const watchlistTotal =
    watchlist.near_term_not_ready +
    watchlist.overdue +
    watchlist.conflicts +
    watchlist.past_contract +
    watchlist.contracts_expiring +
    watchlist.flood_risk_near_term +
    watchlist.stale_approval +
    watchlist.drift_since_approved;

  // Breakdown data.
  const planItems = Object.entries(activities.by_plan_type)
    .map(([label, value]) => ({ label, value, color: PLAN_COLORS[label] ?? "#cbd5e1" }))
    .sort((a, b) => b.value - a.value);
  const typeItems = Object.entries(activities.by_activity_type)
    .map(([label, value]) => ({ label, value, color: getActivityColor(label) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);
  const idleItems = rigs.per_rig
    .filter((r) => r.idle_days > 0)
    .sort((a, b) => b.idle_days - a.idle_days)
    .slice(0, 8)
    .map((r) => ({ label: r.rig, value: r.idle_days, color: "#f59e0b" }));
  const planMax = Math.max(1, ...planItems.map((i) => i.value));
  const typeMax = Math.max(1, ...typeItems.map((i) => i.value));
  const idleMax = Math.max(1, ...idleItems.map((i) => i.value));

  return (
    <div className="space-y-6">
      {/* Hero tiles */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        <Tile
          label="Completed YTD"
          value={String(activities.completed_ytd)}
          sub={`${activities.completed_this_quarter} this quarter`}
        />
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
              count={watchlist.flood_risk_near_term}
              label={`${plural(watchlist.flood_risk_near_term, "flood-risk activity", "flood-risk activities")} starting soon`}
              to={`${base}/data?focus=flood-risk`}
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

      {/* Breakdown */}
      <div>
        <h3 className="mb-2 text-sm font-semibold text-foreground">Breakdown</h3>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <BreakdownCard title="Readiness by gate · next 12 months">
            {readiness.by_gate.length ? (
              <div className="space-y-1.5">
                {readiness.by_gate.map((g) => (
                  <GateRow key={g.code} gate={g} />
                ))}
                <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1 text-[10px] text-muted-foreground">
                  <span><span style={{ color: GATE_COLORS.completed }}>●</span> Completed</span>
                  <span><span style={{ color: GATE_COLORS.in_progress }}>●</span> On track</span>
                  <span><span style={{ color: GATE_COLORS.behind }}>●</span> Behind</span>
                  <span><span style={{ color: GATE_COLORS.not_started }}>●</span> Not started</span>
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No data yet.</p>
            )}
          </BreakdownCard>

          <BreakdownCard title="Plan firmness">
            <BarList items={planItems} max={planMax} />
          </BreakdownCard>

          <BreakdownCard title="Activity-type mix">
            <BarList items={typeItems} max={typeMax} />
          </BreakdownCard>

          <BreakdownCard title="Rig idle gaps (days)">
            <BarList items={idleItems} max={idleMax} />
          </BreakdownCard>
        </div>
      </div>
    </div>
  );
}
