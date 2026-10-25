import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ChevronDown, ChevronUp } from "lucide-react";
import { fetchDashboard, type DashboardResponse, type GateBreakdown } from "@/api/dashboard";
import { getActivityColor } from "@/lib/chart-colors";
import { readinessFiguresHint, readinessScope } from "@/lib/readiness-figures";
import { HORIZON_DAYS } from "@/lib/readiness-window";
import { ALL_LENS, PROJECTS_TEAM } from "@/components/readiness/catalog";

type Tone = "neutral" | "good" | "warn" | "bad";

const TONE: Record<Tone, string> = {
  neutral: "text-foreground",
  good: "text-foreground",
  warn: "text-amber-600 dark:text-amber-400",
  bad: "text-destructive",
};

const TILE_CLASS = "rounded-xl border border-border/70 bg-card p-4 shadow-soft-sm";
// Tiles are doors: same card, plus hover/focus affordance and link semantics.
const TILE_LINK_CLASS = `${TILE_CLASS} block transition-colors hover:border-primary/50 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50`;

function Tile({
  label,
  value,
  sub,
  tone = "neutral",
  to,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: Tone;
  /** Destination tab — every tile deep-links to the page that acts on it. */
  to?: string;
}) {
  const body = (
    <>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${TONE[tone]}`}>{value}</p>
      {sub ? <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p> : null}
    </>
  );
  if (to) {
    return (
      <Link to={to} className={TILE_LINK_CLASS}>
        {body}
      </Link>
    );
  }
  return <div className={TILE_CLASS}>{body}</div>;
}

/** Fleet demand over the plan window as a 2×2: kind (rigs / HWUs) ×
 *  procurement (in use = procured · planned = no awarded unit yet). The four
 *  are disjoint and sum to the lanes the plan occupies. */
function FleetTile({ rigs, to }: { rigs: DashboardResponse["rigs"]; to: string }) {
  const plannedHint =
    "Planned = capacity in the plan with no awarded unit behind it yet — procurement pending";
  // Rendered as a literal 2×2 (see docstring): one column per kind, each with
  // its in-use count on the shared baseline and its planned count beneath —
  // the columns keep both numbers and both sublines on the same grid tracks.
  return (
    <Link to={to} className={TILE_LINK_CLASS}>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Fleet status
      </p>
      <div className="mt-1 grid grid-cols-2 gap-4">
        <div>
          <p className="text-2xl font-semibold text-foreground">
            {rigs.in_use}
            <span className="ml-1 text-xs font-normal text-muted-foreground">
              {rigs.in_use === 1 ? "rig" : "rigs"} in use
            </span>
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground" title={plannedHint}>
            {rigs.planned_rigs} {rigs.planned_rigs === 1 ? "rig" : "rigs"} planned
          </p>
        </div>
        <div>
          <p className="text-2xl font-semibold text-foreground">
            {rigs.hwus_in_use}
            <span className="ml-1 text-xs font-normal text-muted-foreground">
              {rigs.hwus_in_use === 1 ? "HWU" : "HWUs"} in use
            </span>
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground" title={plannedHint}>
            {rigs.planned_hwus} {rigs.planned_hwus === 1 ? "HWU" : "HWUs"} planned
          </p>
        </div>
      </div>
    </Link>
  );
}

/** One readiness card: the Complete %, then "on track · behind", then what it
 *  counts (spec §3.7). The whole card opens the Readiness tab on its lens and
 *  window; "N behind" is its own door, straight to the behind items. */
function ReadinessCard({
  label,
  completePct,
  onTrackPct,
  behind,
  scope,
  to,
  behindTo,
  projectGates,
}: {
  label: string;
  completePct: number | null;
  onTrackPct: number | null;
  behind: number;
  scope: string;
  to: string;
  behindTo: string;
  /** The Project gates card (its not-counted cells are N/A), or a team's (its
   *  are the checks that don't apply) — the hover hint says which. */
  projectGates: boolean;
}) {
  const tone = readinessTone(completePct);
  return (
    <div
      data-testid="readiness-card"
      title={readinessFiguresHint(projectGates)}
      className={`relative ${TILE_CLASS} transition-colors focus-within:ring-2 focus-within:ring-primary/50 hover:border-primary/50 hover:bg-muted/30`}
    >
      {/* Stretched link: the whole card is the door; the "behind" link sits above it. */}
      <Link
        to={to}
        className="block after:absolute after:inset-0 after:rounded-xl after:content-[''] focus-visible:outline-none"
      >
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className={`mt-1 text-2xl font-semibold ${TONE[tone]}`}>
          {completePct === null ? "—" : `${completePct}%`}
          {completePct !== null && (
            <span className="ml-1.5 text-xs font-normal text-muted-foreground">complete</span>
          )}
        </p>
      </Link>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {onTrackPct === null ? (
          "Nothing to count"
        ) : (
          <>
            {onTrackPct}% on track ·{" "}
            {behind > 0 ? (
              <Link
                to={behindTo}
                className="relative z-10 font-medium text-destructive underline-offset-2 hover:underline"
                title="Show only the items behind"
              >
                {behind} behind
              </Link>
            ) : (
              "0 behind"
            )}
          </>
        )}
      </p>
      <p className="mt-0.5 text-[11px] text-muted-foreground/80">{scope}</p>
    </div>
  );
}

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
function BarList({
  items,
  max,
  empty = "No data yet.",
}: {
  items: { label: string; value: number; color: string }[];
  max: number;
  empty?: string;
}) {
  if (items.length === 0) return <p className="text-xs text-muted-foreground">{empty}</p>;
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

// Focus-window presets, mirrored by the backend's allow-list. Shared by the
// readiness block and the activity-type mix card.
const HORIZON_OPTIONS = [
  { value: 6, label: "Next 6 months" },
  { value: 12, label: "Next 12 months" },
  { value: 24, label: "Next 24 months" },
  { value: 0, label: "All duration" },
] as const;

/** A readiness tile's door: the Readiness tab on that tile's lens and window, so
 *  the tab lists exactly what the tile counted (spec §3.7) — for a team, its
 *  Wells view, as a team tile counts wells (spec §8.8). */
function readinessLink(base: string, lens: string, months: number, focus?: "behind"): string {
  const params = new URLSearchParams({ lens });
  if (lens !== PROJECTS_TEAM) params.set("view", "wells");
  if (months in HORIZON_DAYS) params.set("horizon", String(months));
  if (focus) params.set("focus", focus);
  return `${base}/readiness?${params.toString()}`;
}

const FOCUS_KEY = "ds.overview-readiness-focus";

function horizonSuffix(months: number): string {
  return months === 0 ? "all duration" : `next ${months} months`;
}

export function ProjectDashboard({
  projectId,
  afterTiles,
}: {
  projectId: string;
  /** Rendered directly under the KPI tiles — the Overview's "read this
   *  first" slot (key notes). */
  afterTiles?: React.ReactNode;
}) {
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
  // Activity-mix window — same viewing-habit treatment, own key. Defaults to
  // the whole plan (0), the card's historical behaviour.
  const [mixHorizon, setMixHorizon] = useState<number>(() => {
    try {
      const raw = window.localStorage.getItem("ds.activity-mix-horizon");
      if (raw === null) return 0;
      const v = Number(raw);
      return v === 0 || v === 6 || v === 12 || v === 24 ? v : 0;
    } catch {
      return 0;
    }
  });
  function updateMixHorizon(next: number) {
    setMixHorizon(next);
    try {
      window.localStorage.setItem("ds.activity-mix-horizon", String(next));
    } catch {
      // storage unavailable — the in-session choice still applies
    }
  }

  // Team focus — which readiness cards the Overview shows: "all" (the default:
  // the campaign's full picture) or one team, e.g. to present Logistics alone.
  // A personal view, never a permission: remembered per browser and carried in
  // ?lens= so a focused link can be bookmarked or shared.
  const [searchParams, setSearchParams] = useSearchParams();
  const [savedFocus, setSavedFocus] = useState<string>(() => {
    try {
      return window.localStorage.getItem(FOCUS_KEY) ?? ALL_LENS;
    } catch {
      return ALL_LENS;
    }
  });
  function updateFocus(next: string) {
    setSavedFocus(next);
    try {
      window.localStorage.setItem(FOCUS_KEY, next);
    } catch {
      // storage unavailable — the in-session choice still applies
    }
    // Keep "all" in the URL too: a shared all-teams link must open on all teams,
    // not fall back to the recipient's own saved focus.
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        params.set("lens", next);
        return params;
      },
      { replace: true },
    );
  }

  // Breakdown panel collapse — same pattern as the "Rigs & well spuds" section:
  // open by default, in-session only.
  const [breakdownOpen, setBreakdownOpen] = useState(true);

  // Blank the page only when switching CAMPAIGN — a horizon change refetches
  // in place, keeping the current numbers up instead of flashing "Loading".
  useEffect(() => setData(null), [projectId]);

  useEffect(() => {
    let active = true;
    setError(null);
    fetchDashboard(projectId, horizon, mixHorizon)
      .then((d) => active && setData(d))
      .catch(() => active && setError("Couldn't load the dashboard."));
    return () => {
      active = false;
    };
  }, [projectId, horizon, mixHorizon]);

  if (error) return <p className="py-12 text-center text-sm text-destructive">{error}</p>;
  if (!data) return <p className="py-12 text-center text-sm text-muted-foreground">Loading dashboard…</p>;

  const { activities, readiness, rigs, contracts } = data;
  const base = `/projects/${projectId}`;

  const contractsAtRisk = contracts.expired + contracts.critical + contracts.soon;

  // The readiness cards, Project gates first, then each team.
  const cards = [
    {
      code: PROJECTS_TEAM,
      label: "Project gates",
      completePct: readiness.overall_pct,
      onTrackPct: readiness.on_track_pct,
      behind: readiness.behind_cells,
      scope: readinessScope(readiness.focus_count, "projects"),
    },
    ...(data.team_readiness ?? []).map((t) => ({
      code: t.team_code,
      label: t.name,
      completePct: t.overall_pct,
      onTrackPct: t.on_track_pct,
      behind: t.behind_cells,
      scope: readinessScope(t.focus_count, t.unit),
    })),
  ];
  // The link's ?lens= wins (all teams included), then the saved focus, then All.
  const urlFocus = searchParams.get("lens");
  const isFocus = (code: string | null) =>
    code === ALL_LENS || cards.some((c) => c.code === code);
  const focus = isFocus(urlFocus) ? urlFocus! : isFocus(savedFocus) ? savedFocus : ALL_LENS;
  const shownCards = focus === ALL_LENS ? cards : cards.filter((c) => c.code === focus);
  const hiddenCount = cards.length - shownCards.length;

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
      {/* Hero tiles — the plan's operations */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Tile
          to={`${base}/data`}
          label="Completed YTD"
          value={String(activities.completed_ytd)}
          sub={`${activities.completed_this_quarter} this quarter`}
        />
        <FleetTile rigs={rigs} to={`${base}/fleet`} />
        <Tile
          to={`${base}/fleet?focus=contracts`}
          label="Contracts at risk"
          value={String(contractsAtRisk)}
          sub={`${contracts.expired} expired · ${contracts.critical} critical · ${contracts.soon} soon`}
          tone={contracts.expired || contracts.critical ? "bad" : contracts.soon ? "warn" : "good"}
        />
      </div>

      {/* Readiness — one card per team (Project gates first), side by side over
          ONE window, picked here. Each card reads the same three figures
          (spec §3.7): Complete, then on track and behind, and what it counts. */}
      <section aria-label="Readiness" className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Readiness · {horizonSuffix(horizon)}
          </h2>
          <div className="flex items-center gap-2">
            {cards.length > 1 && (
              <select
                aria-label="Readiness teams shown"
                value={focus}
                onChange={(e) => updateFocus(e.target.value)}
                className="rounded-md border border-border bg-background px-1.5 py-0.5 text-xs text-foreground"
              >
                <option value={ALL_LENS}>All teams</option>
                {cards.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                  </option>
                ))}
              </select>
            )}
            <select
              aria-label="Readiness horizon"
              value={String(horizon)}
              onChange={(e) => updateHorizon(Number(e.target.value))}
              className="rounded-md border border-border bg-background px-1.5 py-0.5 text-xs text-foreground"
            >
              {HORIZON_OPTIONS.map((h) => (
                <option key={h.value} value={String(h.value)}>
                  {h.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        {/* Say so when other teams are hidden — a focused screen must not pass
            for the whole picture. */}
        {hiddenCount > 0 && (
          <p className="text-xs text-muted-foreground" data-testid="readiness-focus-note">
            Focused on {shownCards[0].label} · {hiddenCount} other{" "}
            {hiddenCount === 1 ? "team" : "teams"} hidden ·{" "}
            <button
              type="button"
              onClick={() => updateFocus(ALL_LENS)}
              className="font-medium text-primary hover:underline"
            >
              Show all
            </button>
          </p>
        )}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {shownCards.map((c) => (
            <ReadinessCard
              key={c.code}
              label={c.label}
              completePct={c.completePct}
              onTrackPct={c.onTrackPct}
              behind={c.behind}
              scope={c.scope}
              to={readinessLink(base, c.code, horizon)}
              behindTo={readinessLink(base, c.code, horizon, "behind")}
              projectGates={c.code === PROJECTS_TEAM}
            />
          ))}
        </div>
      </section>

      {afterTiles}


      {/* Breakdown — collapsible, matching the "Rigs & well spuds" section */}
      <div className="rounded-lg border border-border/70 bg-card shadow-soft-sm">
        <button
          type="button"
          onClick={() => setBreakdownOpen((v) => !v)}
          aria-expanded={breakdownOpen}
          aria-controls="dashboard-breakdown"
          className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium text-foreground"
        >
          <span>Breakdown</span>
          {breakdownOpen ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </button>

        {breakdownOpen && (
          <div
            id="dashboard-breakdown"
            className="grid grid-cols-1 gap-3 border-t border-border/60 p-3 lg:grid-cols-2"
          >
            {/* Follows the Readiness group's window (picked in its header); a
                Project gates card, so a focus on another team hides it. */}
            {(focus === ALL_LENS || focus === PROJECTS_TEAM) && (
              <BreakdownCard title={`Readiness by gate · ${horizonSuffix(horizon)}`}>
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
            )}

            <BreakdownCard
              title={`Activity-type mix · ${horizonSuffix(mixHorizon)}`}
              action={
                <select
                  aria-label="Activity mix horizon"
                  value={String(mixHorizon)}
                  onChange={(e) => updateMixHorizon(Number(e.target.value))}
                  className="rounded-md border border-border bg-background px-1.5 py-0.5 text-xs text-foreground"
                >
                  {HORIZON_OPTIONS.map((h) => (
                    <option key={h.value} value={String(h.value)}>
                      {h.label}
                    </option>
                  ))}
                </select>
              }
            >
              <BarList
                items={typeItems}
                max={typeMax}
                empty={
                  mixHorizon === 0
                    ? "No data yet."
                    : "No activities starting in this window."
                }
              />
            </BreakdownCard>
          </div>
        )}
      </div>
    </div>
  );
}
