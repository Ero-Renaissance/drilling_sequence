import { useEffect, useState } from "react";
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

/** Fleet demand over the plan window as a 2×2: kind (rigs / HWUs) ×
 *  procurement (in use = procured · planned = no awarded unit yet). The four
 *  are disjoint and sum to the lanes the plan occupies. */
function FleetTile({ rigs }: { rigs: DashboardResponse["rigs"] }) {
  const plannedHint =
    "Planned = capacity in the plan with no awarded unit behind it yet — procurement pending";
  // Rendered as a literal 2×2 (see docstring): one column per kind, each with
  // its in-use count on the shared baseline and its planned count beneath —
  // the columns keep both numbers and both sublines on the same grid tracks.
  return (
    <div className="rounded-xl border border-border/70 bg-card p-4 shadow-soft-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Fleet status
      </p>
      <div className="mt-1 grid grid-cols-2 gap-4">
        <div>
          <p className="text-2xl font-semibold text-foreground">
            {rigs.in_use}
            <span className="ml-1 text-xs font-normal text-muted-foreground">
              {rigs.in_use === 1 ? "rig" : "rigs"}
            </span>
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground" title={plannedHint}>
            {rigs.planned_rigs} planned
          </p>
        </div>
        <div>
          <p className="text-2xl font-semibold text-foreground">
            {rigs.hwus_in_use}
            <span className="ml-1 text-xs font-normal text-muted-foreground">
              {rigs.hwus_in_use === 1 ? "HWU" : "HWUs"}
            </span>
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground" title={plannedHint}>
            {rigs.planned_hwus} planned
          </p>
        </div>
      </div>
    </div>
  );
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

// ── Breakdown panel (Phase 2) ────────────────────────────────────────────────

const GATE_COLORS = {
  completed: "#16a34a",
  on_track: "#f59e0b",
  behind: "#ef4444",
  na: "#cbd5e1",
} as const;

function BreakdownCard({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border/70 bg-card p-4 shadow-soft-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
        {action}
      </div>
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

/** A gate's status split as a single stacked bar, each segment carrying its
 *  PROJECT count (a thin segment keeps the count in its tooltip). */
function GateRow({ gate }: { gate: GateBreakdown }) {
  const total = gate.completed + gate.on_track + gate.behind + gate.na;
  const seg = (value: number, color: string, label: string, textColor = "#ffffff") => {
    if (value <= 0) return null;
    const pct = (value / total) * 100;
    return (
      <div
        className="flex h-full items-center justify-center"
        style={{ width: `${pct}%`, backgroundColor: color }}
        title={`${label}: ${value} ${value === 1 ? "project" : "projects"}`}
      >
        {pct >= 7 && (
          <span className="text-[10px] font-semibold leading-none" style={{ color: textColor }}>
            {value}
          </span>
        )}
      </div>
    );
  };
  return (
    <div className="flex items-center gap-2">
      <span className="w-10 shrink-0 text-xs font-medium text-muted-foreground">{gate.code}</span>
      <div className="flex h-4 flex-1 overflow-hidden rounded-sm bg-muted">
        {total > 0 && (
          <>
            {seg(gate.completed, GATE_COLORS.completed, "Completed")}
            {seg(gate.on_track, GATE_COLORS.on_track, "On track")}
            {seg(gate.behind, GATE_COLORS.behind, "Behind")}
            {seg(gate.na, GATE_COLORS.na, "N/A", "#334155")}
          </>
        )}
      </div>
    </div>
  );
}

// Readiness focus-window presets, mirrored by the backend's allow-list.
const READINESS_HORIZONS = [
  { value: 6, label: "Next 6 months" },
  { value: 12, label: "Next 12 months" },
  { value: 24, label: "Next 24 months" },
  { value: 0, label: "All projects" },
] as const;

function horizonSuffix(months: number): string {
  return months === 0 ? "all projects" : `next ${months} months`;
}

export function ProjectDashboard({ projectId }: { projectId: string }) {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Readiness focus window — a per-user viewing habit, persisted like the
  // spud map. Drives the whole readiness block (tile + by-gate card).
  const [horizon, setHorizon] = useState<number>(() => {
    try {
      // Read the raw string first: Number(null) is 0, which would silently
      // turn a MISSING key into the "All projects" horizon instead of 12.
      const raw = window.localStorage.getItem("ds.readiness-horizon");
      if (raw === null) return 12;
      const v = Number(raw);
      return v === 0 || v === 6 || v === 12 || v === 24 ? v : 12;
    } catch {
      return 12;
    }
  });
  function updateHorizon(next: number) {
    setHorizon(next);
    try {
      window.localStorage.setItem("ds.readiness-horizon", String(next));
    } catch {
      // storage unavailable — the in-session choice still applies
    }
  }

  // Blank the page only when switching CAMPAIGN — a horizon change refetches
  // in place, keeping the current numbers up instead of flashing "Loading".
  useEffect(() => setData(null), [projectId]);

  useEffect(() => {
    let active = true;
    setError(null);
    fetchDashboard(projectId, horizon)
      .then((d) => active && setData(d))
      .catch(() => active && setError("Couldn't load the dashboard."));
    return () => {
      active = false;
    };
  }, [projectId, horizon]);

  if (error) return <p className="py-12 text-center text-sm text-destructive">{error}</p>;
  if (!data) return <p className="py-12 text-center text-sm text-muted-foreground">Loading dashboard…</p>;

  const { activities, readiness, rigs, contracts, approval } = data;

  const contractsAtRisk = contracts.expired + contracts.critical + contracts.soon;

  // Breakdown data. (Plan firmness and rig idle gaps were retired from this
  // page 2026-07 — plan type reads off the grid/chart, idle gaps off the
  // sequence itself; the by_plan_type / per_rig API fields still feed the
  // fleet tile and other consumers.)
  const typeItems = Object.entries(activities.by_activity_type)
    .map(([label, value]) => ({ label, value, color: getActivityColor(label) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);
  const typeMax = Math.max(1, ...typeItems.map((i) => i.value));

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
          label={`Readiness · ${horizonSuffix(horizon)}`}
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
        <FleetTile rigs={rigs} />
        <Tile
          label="Contracts at risk"
          value={String(contractsAtRisk)}
          sub={`${contracts.expired} expired · ${contracts.critical} critical · ${contracts.soon} soon`}
          tone={contracts.expired || contracts.critical ? "bad" : contracts.soon ? "warn" : "good"}
        />
      </div>


      {/* Breakdown */}
      <div>
        <h3 className="mb-2 text-sm font-semibold text-foreground">Breakdown</h3>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <BreakdownCard
            title={`Readiness by gate · ${horizonSuffix(horizon)}`}
            action={
              <select
                aria-label="Readiness horizon"
                value={String(horizon)}
                onChange={(e) => updateHorizon(Number(e.target.value))}
                className="rounded-md border border-border bg-background px-1.5 py-0.5 text-xs text-foreground"
              >
                {READINESS_HORIZONS.map((h) => (
                  <option key={h.value} value={String(h.value)}>
                    {h.label}
                  </option>
                ))}
              </select>
            }
          >
            {readiness.by_gate.length ? (
              <div className="space-y-1.5">
                {readiness.by_gate.map((g) => (
                  <GateRow key={g.code} gate={g} />
                ))}
                <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1 text-[10px] text-muted-foreground">
                  <span><span style={{ color: GATE_COLORS.completed }}>●</span> Completed</span>
                  <span><span style={{ color: GATE_COLORS.on_track }}>●</span> On track</span>
                  <span><span style={{ color: GATE_COLORS.behind }}>●</span> Behind</span>
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No data yet.</p>
            )}
          </BreakdownCard>

          <BreakdownCard title="Activity-type mix">
            <BarList items={typeItems} max={typeMax} />
          </BreakdownCard>
        </div>
      </div>
    </div>
  );
}
