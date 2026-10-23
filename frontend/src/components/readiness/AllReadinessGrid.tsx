import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { listActivities, type Activity } from "@/api/activities";
import {
  getTeamReadiness,
  listReadiness,
  type CatalogCheck,
  type CatalogTeam,
  type CheckState,
  type TeamReadiness,
} from "@/api/readiness";
import { Button } from "@/components/ui/button";
import { PaginationFooter } from "@/components/ui/pagination-footer";
import { SearchInput } from "@/components/ui/search-input";
import { useAuthStore } from "@/store/auth";
import { teamValuesFor } from "@/lib/readiness-lens";
import { summariseTeam, summaryLine, teamDetails } from "@/lib/team-summary";
import { cn, formatDate } from "@/lib/utils";
import { focusStartOf, inWindow } from "@/lib/readiness-window";
import { ReadinessDot } from "./ReadinessDot";
import {
  PROJECTS_TEAM,
  defaultLens,
  lensLabel,
  useProjectGates,
  useReadinessTeams,
  type Lens,
} from "./catalog";
import { NOTHING_APPLIES, NOT_APPLICABLE, STATUS_ICON_COLOR, applies } from "./check-meta";
import { checkIcon } from "./icon-registry";
import { ReadinessWindowSelect, useReadinessWindow } from "./ReadinessWindow";

interface WellRow {
  key: string;
  well_project: string;
  well_name: string;
  activity_type: string;
  start_date: string;
}

// Project-gate cells (no `applies`) or a team's cells (with `applies`).
type Values = Record<string, CheckState & { source?: string; applies?: boolean }>;

/**
 * Every team at once — the "All" view of the Readiness page. One row per well
 * activity; one column group per team. A group collapses to a single column
 * showing that team's WORST status, so the full picture stays readable; only the
 * user's own team starts expanded. Read-only: a group header opens that team's
 * view, where changes are made (including which checks apply).
 *
 * A team check that doesn't apply to a well (spec §3.8) shows a muted "—" in
 * its column; a folded team is the worst of the checks that apply, "—" when
 * none does. The Project gates read as they always have, N/A drawn grey.
 */
export function AllReadinessGrid({
  projectId,
  onOpenLens,
}: {
  projectId: string;
  onOpenLens: (lens: Lens) => void;
}) {
  const teams = useReadinessTeams();
  const projectGates = useProjectGates();
  const userTeams = useAuthStore((s) => s.user?.teams);
  const [activities, setActivities] = useState<Activity[] | null>(null);
  const [gates, setGates] = useState<Map<string, Values>>(new Map());
  const [teamData, setTeamData] = useState<TeamReadiness[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set([defaultLens(teams, userTeams)]),
  );
  const [search, setSearch] = useState("");
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(25);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [acts, projectRows, ...perTeam] = await Promise.all([
        listActivities(projectId),
        listReadiness(projectId),
        ...teams
          .filter((t) => t.code !== PROJECTS_TEAM)
          .map((t) => getTeamReadiness(projectId, t.code)),
      ]);
      setActivities(acts);
      setGates(new Map(projectRows.map((r) => [r.well_project, r.checks])));
      setTeamData(perTeam);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load readiness data");
    } finally {
      setLoading(false);
    }
  }, [projectId, teams]);

  useEffect(() => {
    load();
  }, [load]);
  const [months, setMonths] = useReadinessWindow();
  useEffect(() => setPageIndex(0), [search, months]);

  // One row per well activity (project + well + activity type) with readiness
  // work left (spec §3.7): opt-outs carry no readiness from any team, and
  // completed work has nothing left to be ready for. A row's date is its focus
  // start (`focusStartOf`, the backend's rule) — what the page's window uses.
  const rows = useMemo<WellRow[]>(() => {
    const byKey = new Map<string, { row: Omit<WellRow, "start_date">; acts: Activity[] }>();
    for (const a of activities ?? []) {
      if (!a.well_name) continue;
      const key = `${a.well_project ?? ""}\u0001${a.well_name}\u0001${a.activity_type}`;
      const group = byKey.get(key) ?? {
        row: {
          key,
          well_project: a.well_project ?? "",
          well_name: a.well_name,
          activity_type: a.activity_type,
        },
        acts: [],
      };
      group.acts.push(a);
      byKey.set(key, group);
    }
    const out: WellRow[] = [];
    for (const { row, acts } of byKey.values()) {
      const start = focusStartOf(acts);
      if (start) out.push({ ...row, start_date: start });
    }
    return out.sort((x, y) => x.start_date.localeCompare(y.start_date));
  }, [activities]);

  const q = search.trim().toLowerCase();
  const filtered = rows.filter(
    (r) =>
      inWindow({ focus_start: r.start_date }, months) &&
      (!q ||
        r.well_name.toLowerCase().includes(q) ||
        r.well_project.toLowerCase().includes(q) ||
        r.activity_type.toLowerCase().includes(q)),
  );
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safeIndex = Math.min(pageIndex, pageCount - 1);
  const visible = filtered.slice(safeIndex * pageSize, (safeIndex + 1) * pageSize);

  // Each team's checks (columns) and how a row reads its values.
  const groups = teams.map((team) => {
    if (team.code === PROJECTS_TEAM) {
      return {
        team,
        checks: projectGates as CatalogCheck[],
        values: (r: WellRow): Values | undefined =>
          r.well_project ? gates.get(r.well_project) : undefined,
      };
    }
    const data = teamData.find((d) => d.team.code === team.code);
    return {
      team,
      checks: data?.checks ?? [],
      values: (r: WellRow): Values | undefined =>
        data
          ? (teamValuesFor(data, {
              well_project: r.well_project || null,
              well_name: r.well_name,
              activity_type: r.activity_type,
            }) as Values | undefined)
          : undefined,
    };
  });

  const toggle = (code: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });

  if (error) {
    return (
      <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600" role="alert">
        {error}
      </p>
    );
  }
  if (!activities) {
    return (
      <div className="flex h-48 items-center justify-center text-muted-foreground">
        <RefreshCw className="mr-2 h-5 w-5 animate-spin" />
        Loading readiness…
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-xs text-muted-foreground">
          Every team at once. Each group shows its worst status when folded — open a team to make
          changes.
        </p>
        <div className="ml-auto flex items-center gap-2">
          <ReadinessWindowSelect value={months} onChange={setMonths} allLabel="All wells" />
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search well or project…"
            ariaLabel="Search wells"
          />
          <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </Button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="flex h-32 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
          {q ? (
            <>No wells match &ldquo;{search}&rdquo;.</>
          ) : months ? (
            `No wells have readiness-required work starting in the next ${months} months.`
          ) : (
            "No wells with readiness work left in this campaign."
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border/70 bg-card shadow-soft-sm">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border/70 bg-muted/30">
                <th
                  rowSpan={2}
                  className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  Well
                </th>
                {groups.map(({ team, checks }) => {
                  const open = expanded.has(team.code) && checks.length > 0;
                  const TeamIcon = checkIcon(team.icon_key);
                  return (
                    <th
                      key={team.code}
                      colSpan={open ? checks.length : 1}
                      className="border-l border-border/60 px-2 py-1.5 text-center"
                    >
                      <div className="flex items-center justify-center gap-1">
                        <button
                          type="button"
                          aria-expanded={open}
                          aria-label={`${open ? "Fold" : "Unfold"} ${lensLabel(team)}`}
                          onClick={() => toggle(team.code)}
                          disabled={checks.length === 0}
                          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold text-foreground hover:bg-accent/50 disabled:opacity-50"
                        >
                          {open ? <ChevronLeft className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                          <TeamIcon className="h-3.5 w-3.5 text-muted-foreground" />
                          {lensLabel(team)}
                        </button>
                        <button
                          type="button"
                          onClick={() => onOpenLens(team.code)}
                          className="rounded px-1 text-[10px] text-primary hover:underline"
                        >
                          Open
                        </button>
                      </div>
                    </th>
                  );
                })}
              </tr>
              <tr className="border-b border-border/70 bg-muted/20">
                {groups.map(({ team, checks }) => {
                  const open = expanded.has(team.code) && checks.length > 0;
                  if (!open) {
                    return (
                      <th
                        key={team.code}
                        className="border-l border-border/60 px-2 py-1 text-[10px] font-medium text-muted-foreground"
                      >
                        Worst
                      </th>
                    );
                  }
                  return (
                    <Fragment key={team.code}>
                      {checks.map((c, i) => (
                        <th
                          key={c.code}
                          title={c.label}
                          className={cn(
                            "px-1 py-1 text-[10px] font-semibold text-muted-foreground",
                            i === 0 && "border-l border-border/60",
                          )}
                        >
                          {c.code}
                        </th>
                      ))}
                    </Fragment>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.key} className="border-b border-border/40">
                  <td className="px-3 py-2">
                    <div className="font-medium">{row.well_name}</div>
                    <div className="text-xs text-muted-foreground">
                      {row.well_project || "No field project"} · {row.activity_type} ·{" "}
                      {formatDate(row.start_date)}
                    </div>
                  </td>
                  {groups.map(({ team, checks, values }) => {
                    const v = values(row);
                    const open = expanded.has(team.code) && checks.length > 0;
                    if (!open) {
                      return (
                        <td key={team.code} className="border-l border-border/60 px-2 py-2 text-center">
                          <TeamWorst team={team} checks={checks} values={v} />
                        </td>
                      );
                    }
                    return (
                      <Fragment key={team.code}>
                        {checks.map((c, i) => {
                          const state = v?.[c.code];
                          return (
                            <td
                              key={c.code}
                              className={cn("px-1 py-2 text-center", i === 0 && "border-l border-border/60")}
                            >
                              {state && applies(state, c) ? (
                                <div className="flex justify-center">
                                  <ReadinessDot
                                    code={c.code}
                                    status={state.status}
                                    inherited={state.source === "project" && c.applies_well}
                                  />
                                </div>
                              ) : (
                                // Unticked keeps its status underneath — never shown here.
                                <span
                                  className="text-xs text-muted-foreground/50"
                                  title={state ? `${c.label}: ${NOT_APPLICABLE}` : undefined}
                                >
                                  —
                                </span>
                              )}
                            </td>
                          );
                        })}
                      </Fragment>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {filtered.length > 0 && (
        <PaginationFooter
          pageIndex={safeIndex}
          pageCount={pageCount}
          pageSize={pageSize}
          onPageChange={setPageIndex}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPageIndex(0);
          }}
        />
      )}
    </div>
  );
}

/** A folded team: its icon, coloured by the worst of its checks that apply on
 *  this well ("—" when none does); its hover text is the same summary the
 *  chart's All tooltip gives. */
function TeamWorst({
  team,
  checks,
  values,
}: {
  team: CatalogTeam;
  checks: CatalogCheck[];
  values: Values | undefined;
}) {
  const details = teamDetails(checks, values);
  const summary = summariseTeam(details);
  if (!summary) {
    // No cell here at all, or none of the team's checks applies: no badge.
    const label = details.length > 0 ? `${lensLabel(team)}: ${NOTHING_APPLIES}` : undefined;
    return (
      <span className="text-xs text-muted-foreground/50" title={label}>
        —
      </span>
    );
  }
  const worst = summary.worst;
  const Icon = checkIcon(team.icon_key);
  const label = `${lensLabel(team)}: ${summaryLine(summary)}`;
  return (
    <span title={label} aria-label={label} className="inline-flex justify-center">
      <Icon className={cn("h-[18px] w-[18px]", STATUS_ICON_COLOR[worst])} strokeWidth={2} />
    </span>
  );
}
