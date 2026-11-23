import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Info, RefreshCw } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { cn, formatDate } from "@/lib/utils";
import { focusStartOf, inWindow } from "@/lib/readiness-window";
import { checksReady } from "@/lib/watchlist";
import { listActivities, type Activity } from "@/api/activities";
import {
  type ProjectReadiness,
  type CheckCode,
  type CheckStatus,
  listReadiness,
  upsertCheck,
} from "@/api/readiness";
import { PaginationFooter } from "@/components/ui/pagination-footer";
import { toast } from "@/components/ui/toaster";
import { ReadinessDot } from "./ReadinessDot";
import { PROJECTS_TEAM, statusOf, useProjectGates } from "./catalog";
import { checkIcon } from "./icon-registry";
import { ReadinessLegend } from "./ReadinessLegend";
import { DoneFigure, ReadinessSummary } from "./ReadinessSummary";
import { ReadinessToolbar } from "./ReadinessToolbar";
import { useReadinessWindow } from "./ReadinessWindow";
import { PROJECT_PARAM, TeamViewSwitch, useTeamView } from "./team-view";

/** One row of the Wells view: a well activity (field project + well + activity
 *  type) reading its field project's gates. */
interface GateWellRow {
  key: string;
  well_project: string;
  well_name: string;
  activity_type: string;
  start_date: string;
  /** Earliest start of its work left (`focusStartOf`) — the window's signal. */
  focus_start: string | null;
  /** Its field project's row: the gates and the server's figures. */
  project: ProjectReadiness;
}

/** The wells that carry Project gates, each with its field project's row. As
 *  everywhere (spec §3.7): an activity with no well name, no field project or
 *  readiness switched off carries none; activities sharing project + well +
 *  activity type are one well. Sorted by start date, like the team Wells views. */
function gateWellRows(activities: readonly Activity[], rows: readonly ProjectReadiness[]): GateWellRow[] {
  const projectOf = new Map(rows.map((r) => [r.well_project, r]));
  const groups = new Map<string, Activity[]>();
  for (const a of activities) {
    if (!a.well_name || !a.well_project || a.readiness_required === false) continue;
    if (!projectOf.has(a.well_project)) continue;
    const key = `${a.well_project}\u0001${a.well_name}\u0001${a.activity_type}`;
    groups.set(key, [...(groups.get(key) ?? []), a]);
  }
  const out: GateWellRow[] = [];
  for (const [key, acts] of groups) {
    const first = acts.reduce((x, y) => (y.start_date < x.start_date ? y : x));
    out.push({
      key,
      well_project: first.well_project!,
      well_name: first.well_name!,
      activity_type: first.activity_type,
      start_date: first.start_date,
      focus_start: focusStartOf(acts),
      project: projectOf.get(first.well_project!)!,
    });
  }
  return out.sort(
    (x, y) =>
      x.start_date.localeCompare(y.start_date) ||
      x.well_project.localeCompare(y.well_project) ||
      x.well_name.localeCompare(y.well_name),
  );
}

const STATUSES: CheckStatus[] = ["On Track", "Behind", "Completed", "N/A"];

// ── Main component ────────────────────────────────────────────────────────────

interface ReadinessGridProps {
  projectId: string;
}

export function ReadinessGrid({ projectId }: ReadinessGridProps) {
  const gates = useProjectGates();
  const [rows, setRows] = useState<ProjectReadiness[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null); // "wellProject:checkCode"
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [search, setSearch] = useState("");
  const [searchParams, setSearchParams] = useSearchParams();
  // One view at a time, like the team grids (spec §8.8): the field projects
  // (default) or their wells. A gate is set per field project either way — the
  // Wells view lists each well with its field project's gates.
  const [view, setView] = useTeamView(PROJECTS_TEAM, { projects: true, wells: true });
  const wellsView = view === "wells";

  // Rows come from the server (with their figures). A response may only replace
  // them if it is the newest load AND no edit is still being saved — otherwise a
  // slow or early response (served before an edit committed) would overwrite
  // that edit. Each edit reloads once its save settles, so the last load wins.
  const loadSeq = useRef(0);
  const pendingEdits = useRef(0);
  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    setLoading(true);
    setError(null);
    try {
      // The Wells view also needs the campaign's activities (which wells sit
      // under which field project); the Projects view doesn't fetch them.
      const [data, acts] = await Promise.all([
        listReadiness(projectId),
        wellsView ? listActivities(projectId) : null,
      ]);
      if (seq === loadSeq.current && acts) setActivities(acts);
      if (seq === loadSeq.current && pendingEdits.current === 0) setRows(data);
    } catch (err: unknown) {
      if (seq === loadSeq.current) {
        setError(err instanceof Error ? err.message : "Failed to load readiness data");
      }
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [projectId, wellsView]);

  useEffect(() => {
    load();
  }, [load]);

  // Reset to the first page when the row set or the search changes, so we never
  // land on a now-empty page.
  useEffect(() => {
    setPageIndex(0);
  }, [rows.length, search, searchParams, view]);

  const handleChange = useCallback(
    async (wellProject: string, code: CheckCode, next: CheckStatus) => {
      const key = `${wellProject}:${code}`;
      const previous = rows.find((r) => r.well_project === wellProject)?.checks[code]?.status;

      // Optimistic update — a gate is set for the whole field project.
      setRows((prev) =>
        prev.map((r) =>
          r.well_project !== wellProject
            ? r
            : { ...r, checks: { ...r.checks, [code]: { ...r.checks[code], status: next } } },
        ),
      );

      setSaving(key);
      pendingEdits.current += 1;
      try {
        await upsertCheck(projectId, wellProject, code, next);
      } catch (err: unknown) {
        if (previous) {
          setRows((prev) =>
            prev.map((r) =>
              r.well_project !== wellProject
                ? r
                : {
                    ...r,
                    checks: { ...r.checks, [code]: { ...r.checks[code], status: previous } },
                  },
            ),
          );
        }
        toast.error(err instanceof Error ? err.message : `Failed to save ${code} status.`);
      } finally {
        pendingEdits.current -= 1;
        setSaving((current) => (current === key ? null : current));
      }
      // The row's figures (and the summary) are the server's — refresh them,
      // after a failed save too, so the grid shows what the server holds.
      await load();
    },
    [projectId, rows, load],
  );

  const q = search.trim().toLowerCase();
  // Which field projects the page covers (spec §3.7):
  //  • the window (?horizon=6|12|24, else All) — a project is in scope when it
  //    has readiness-required work that isn't completed (focus_start) starting
  //    within it. Completed or opted-out projects have none, so they drop out
  //    under every window — exactly the set the Overview tile counts;
  //  • ?focus=not-ready → only those that aren't ready (server-decided);
  //  • ?focus=behind → only those with a gate behind (an Overview card's
  //    "N behind" opens this);
  //  • the text search.
  // The summary adds up exactly the rows that pass, across every page.
  const [horizon, setHorizon] = useReadinessWindow();
  const notReadyFocus = searchParams.get("focus") === "not-ready";
  const behindFocus = searchParams.get("focus") === "behind";
  const scopedRows = rows.filter((r) => inWindow(r, horizon));
  const filteredRows = scopedRows.filter((r) => {
    if (q && !r.well_project.toLowerCase().includes(q)) return false;
    // Ready is the server's call; checksReady only covers a row without figures.
    if (notReadyFocus && (r.figures ? r.figures.ready : checksReady(r.checks))) return false;
    if (behindFocus && !(r.figures && r.figures.behind > 0)) return false;
    return true;
  });
  // The Wells view: the same filters, per well. A well reads its field
  // project's gates, so "not ready" / "behind" are its field project's; the
  // window is the well's own work left. `?project=` narrows to one field
  // project's wells ("Wells →" on a project row).
  const projectFilter = wellsView ? searchParams.get(PROJECT_PARAM) : null;
  const wellRows = useMemo(() => gateWellRows(activities, rows), [activities, rows]);
  const scopedWells = wellRows.filter((w) => inWindow(w, horizon));
  const filteredWells = scopedWells.filter((w) => {
    const f = w.project.figures;
    if (projectFilter !== null && w.well_project !== projectFilter) return false;
    if (
      q &&
      !w.well_name.toLowerCase().includes(q) &&
      !w.well_project.toLowerCase().includes(q) &&
      !w.activity_type.toLowerCase().includes(q)
    )
      return false;
    if (notReadyFocus && (f ? f.ready : checksReady(w.project.checks))) return false;
    if (behindFocus && !(f && f.behind > 0)) return false;
    return true;
  });
  // Each field project counts once (spec §3.7): the Wells view's summary adds
  // up the field projects of the wells shown, never one project per well.
  const wellProjects = [...new Map(filteredWells.map((w) => [w.well_project, w.project])).values()];

  const filtering = Boolean(q) || notReadyFocus || behindFocus || projectFilter !== null;
  const scopedCount = wellsView ? scopedWells.length : scopedRows.length;
  const shownCount = wellsView ? filteredWells.length : filteredRows.length;
  const pageCount = Math.max(1, Math.ceil(shownCount / pageSize));
  const safeIndex = Math.min(pageIndex, pageCount - 1);
  const visibleRows = filteredRows.slice(safeIndex * pageSize, safeIndex * pageSize + pageSize);
  const visibleWells = filteredWells.slice(safeIndex * pageSize, safeIndex * pageSize + pageSize);
  const targets = wellsView ? "wells of field projects" : "field projects";

  function setProjectFilter(wellProject: string | null) {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (wellProject === null) params.delete(PROJECT_PARAM);
        else {
          params.set("view", "wells");
          params.set(PROJECT_PARAM, wellProject);
        }
        return params;
      },
      { replace: true },
    );
  }

  const gateCell = (row: ProjectReadiness, code: CheckCode) => {
    const key = `${row.well_project}:${code}`;
    return (
      <td key={code} className="px-1 py-2 text-center">
        <div className="flex justify-center">
          <ReadinessDot
            code={code}
            status={statusOf(row.checks, code)}
            onChange={(next) => handleChange(row.well_project, code, next)}
            disabled={saving === key}
          />
        </div>
      </td>
    );
  };
  const gateHeaders = gates.map((gate) => {
    const Icon = checkIcon(gate.icon_key);
    return (
      <th
        key={gate.code}
        className="px-1 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
        title={gate.label}
      >
        <div className="flex items-center justify-center gap-1.5 text-foreground/80">
          <Icon className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={2} />
          <span>{gate.code}</span>
        </div>
      </th>
    );
  });

  function clearFocus() {
    searchParams.delete("focus");
    setSearchParams(searchParams, { replace: true });
  }

  // The plan lock (a revision pending or approved) doesn't freeze readiness:
  // the gates stay editable and the toolbar says so.
  const isLocked = rows.some((r) => r.locked);

  return (
    <div className="space-y-3">
      {notReadyFocus && (
        <div className="flex items-center justify-between rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-sm">
          <span>
            <span className="font-semibold">{shownCount}</span> shown — {targets} that are
            not yet ready
          </span>
          <button
            type="button"
            onClick={clearFocus}
            className="text-xs font-medium text-primary hover:underline"
          >
            Clear filter
          </button>
        </div>
      )}
      {behindFocus && (
        <div className="flex items-center justify-between rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
          <span>
            <span className="font-semibold">{shownCount}</span> shown — {targets} with a
            gate behind
          </span>
          <button
            type="button"
            onClick={clearFocus}
            className="text-xs font-medium text-primary hover:underline"
          >
            Clear filter
          </button>
        </div>
      )}
      {horizon !== 0 && (
        <div className="flex items-center justify-between rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-sm">
          <span>
            <span className="font-semibold">{shownCount}</span> shown —{" "}
            {wellsView ? "wells" : "field projects"} with readiness-required work starting in
            the next {horizon} months
          </span>
          <button
            type="button"
            onClick={() => setHorizon(0)}
            className="text-xs font-medium text-primary hover:underline"
          >
            Clear filter
          </button>
        </div>
      )}
      {projectFilter !== null && (
        <div className="flex items-center justify-between rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-sm">
          <span>
            <span className="font-semibold">{shownCount}</span> shown — wells of {projectFilter}
          </span>
          <button
            type="button"
            onClick={() => setProjectFilter(null)}
            className="text-xs font-medium text-primary hover:underline"
          >
            Clear filter
          </button>
        </div>
      )}
      {/* Toolbar */}
      <ReadinessToolbar
        loading={loading}
        onRefresh={load}
        locked={isLocked}
        viewSwitch={<TeamViewSwitch value={view} onChange={setView} />}
        window={{
          value: horizon,
          onChange: setHorizon,
          allLabel: wellsView ? "All wells" : "All field projects",
        }}
        search={{
          value: search,
          onChange: setSearch,
          placeholder: wellsView ? "Search well or project…" : "Search field project…",
          ariaLabel: "Search readiness",
          testId: "readiness-search",
        }}
        count={
          filtering
            ? `${shownCount} of ${scopedCount}`
            : wellsView
              ? `${scopedCount} ${scopedCount === 1 ? "well" : "wells"}`
              : `${scopedCount} ${scopedCount === 1 ? "project" : "projects"}`
        }
      />

      {error && (
        <p
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {error}
        </p>
      )}

      {/* Legend (always visible above the matrix) */}
      <ReadinessLegend statuses={STATUSES} checks={gates} />

      {/* The three figures over exactly the rows shown (spec §3.7) */}
      {scopedCount > 0 && (
        <ReadinessSummary
          rows={(wellsView ? wellProjects : filteredRows).map((r) => r.figures)}
          unit={["field project", "field projects"]}
          windowMonths={horizon}
        />
      )}
      {wellsView && scopedCount > 0 && (
        <p
          className="flex items-start gap-1.5 text-xs text-muted-foreground"
          data-testid="gates-wells-note"
        >
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Gates are set per field project. Changing one on a well changes it for every well
            in that field project, and the figures above count each field project once.
          </span>
        </p>
      )}

      {/* Matrix table */}
      {loading && rows.length === 0 ? (
        <div className="flex h-48 items-center justify-center text-muted-foreground">
          <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
          Loading…
        </div>
      ) : rows.length === 0 ? (
        <div className="flex h-48 items-center justify-center rounded-lg border border-dashed text-muted-foreground">
          <div className="text-center">
            <p className="font-medium">No field projects</p>
            <p className="text-sm">Give activities a Project in the Activities tab first.</p>
          </div>
        </div>
      ) : shownCount === 0 ? (
        <div className="flex h-48 items-center justify-center rounded-lg border border-dashed text-muted-foreground">
          <p className="text-sm">
            {wellsView && loading && activities.length === 0 ? (
              "Loading wells…"
            ) : scopedCount === 0 ? (
              horizon !== 0 ? (
                `No ${wellsView ? "wells" : "field projects"} have readiness-required work starting in the next ${horizon} months.`
              ) : wellsView ? (
                "No wells have readiness work left — they are completed, opted out, or have no field project."
              ) : (
                "No field projects have readiness work left — their activities are completed or opted out."
              )
            ) : q ? (
              <>
                No {wellsView ? "wells" : "field projects"} match &ldquo;{search}&rdquo;.
              </>
            ) : (
              `No ${wellsView ? "wells" : "field projects"} match the current filter.`
            )}
          </p>
        </div>
      ) : wellsView ? (
        <div className="overflow-x-auto rounded-xl border border-border/70 bg-card shadow-soft-sm">
          <table
            className="w-full min-w-[980px] table-fixed border-collapse text-sm"
            aria-label="Wells and their field project's gates"
          >
            <colgroup>
              <col className="w-[24%]" />
              <col className="w-[18%]" />
              <col className="w-[9%]" />
              <col className="w-[8%]" />
              {gates.map((gate) => (
                <col key={gate.code} />
              ))}
            </colgroup>
            <thead>
              <tr className="border-b border-border/70 bg-muted/30">
                <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Well
                </th>
                <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Field Project
                </th>
                <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Start
                </th>
                <th
                  className="px-3 py-2.5 text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                  title="The field project's gates done"
                >
                  Done
                </th>
                {gateHeaders}
              </tr>
            </thead>
            <tbody>
              {visibleWells.map((well, i) => (
                <tr
                  key={well.key}
                  className={cn(
                    "border-b border-border/40 transition-colors hover:bg-accent/30",
                    i % 2 === 1 && "bg-muted/15",
                  )}
                >
                  <td className="px-3 py-2 [overflow-wrap:anywhere]">
                    <div className="font-medium text-foreground">{well.well_name}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">{well.activity_type}</div>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground [overflow-wrap:anywhere]">
                    {well.well_project}
                  </td>
                  <td className="px-3 py-2 text-xs tabular-nums text-muted-foreground">
                    {formatDate(well.start_date)}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <DoneFigure
                      figures={well.project.figures}
                      nothingTitle="Every gate is N/A — nothing applies"
                    />
                  </td>
                  {gates.map(({ code }) => gateCell(well.project, code))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border/70 bg-card shadow-soft-sm">
          <table className="w-full min-w-[860px] table-fixed border-collapse text-sm">
            <colgroup>
              <col className="w-[34%]" />
              <col className="w-[8%]" />
              {gates.map((gate) => (
                <col key={gate.code} />
              ))}
            </colgroup>
            <thead>
              <tr className="border-b border-border/70 bg-muted/30">
                <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Field Project
                </th>
                <th className="px-3 py-2.5 text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Done
                </th>
                {gateHeaders}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row, i) => {
                // The row's figures are the server's rollup (spec §3.7).
                const f = row.figures;

                return (
                  <tr
                    key={row.well_project}
                    className={cn(
                      "border-b border-border/40 transition-colors hover:bg-accent/30",
                      i % 2 === 1 && "bg-muted/15",
                    )}
                  >
                    {/* Fixed-width column: a long unbroken name wraps inside it. */}
                    <td className="px-3 py-2 [overflow-wrap:anywhere]">
                      <div className="font-medium text-foreground">{row.well_project}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        <span>
                          {row.activity_count} {row.activity_count === 1 ? "activity" : "activities"}
                        </span>
                        {" · "}
                        <button
                          type="button"
                          onClick={() => setProjectFilter(row.well_project)}
                          aria-label={`Show the wells of ${row.well_project}`}
                          className="font-medium text-primary hover:underline"
                        >
                          Wells →
                        </button>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <DoneFigure figures={f} nothingTitle="Every gate is N/A — nothing applies" />
                    </td>
                    {gates.map(({ code }) => gateCell(row, code))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

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
    </div>
  );
}
