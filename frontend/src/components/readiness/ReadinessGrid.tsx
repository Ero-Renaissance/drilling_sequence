import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { cn } from "@/lib/utils";
import { inWindow } from "@/lib/readiness-window";
import { checksReady } from "@/lib/watchlist";
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
import { statusOf, useProjectGates } from "./catalog";
import { checkIcon } from "./icon-registry";
import { ReadinessLegend } from "./ReadinessLegend";
import { DoneFigure, ReadinessSummary } from "./ReadinessSummary";
import { ReadinessToolbar } from "./ReadinessToolbar";
import { useReadinessWindow } from "./ReadinessWindow";

const STATUSES: CheckStatus[] = ["On Track", "Behind", "Completed", "N/A"];

// ── Main component ────────────────────────────────────────────────────────────

interface ReadinessGridProps {
  projectId: string;
}

export function ReadinessGrid({ projectId }: ReadinessGridProps) {
  const gates = useProjectGates();
  const [rows, setRows] = useState<ProjectReadiness[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null); // "wellProject:checkCode"
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [search, setSearch] = useState("");
  const [searchParams, setSearchParams] = useSearchParams();

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
      const data = await listReadiness(projectId);
      if (seq === loadSeq.current && pendingEdits.current === 0) setRows(data);
    } catch (err: unknown) {
      if (seq === loadSeq.current) {
        setError(err instanceof Error ? err.message : "Failed to load readiness data");
      }
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  // Reset to the first page when the row set or the search changes, so we never
  // land on a now-empty page.
  useEffect(() => {
    setPageIndex(0);
  }, [rows.length, search, searchParams]);

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
  const filtering = Boolean(q) || notReadyFocus || behindFocus;
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const safeIndex = Math.min(pageIndex, pageCount - 1);
  const visibleRows = filteredRows.slice(safeIndex * pageSize, safeIndex * pageSize + pageSize);

  function clearFocus() {
    searchParams.delete("focus");
    setSearchParams(searchParams, { replace: true });
  }

  // A revision awaiting approval freezes readiness edits (the PUT 423s per
  // activity); disable the dots up front and flag it, matching the other tabs.
  const isLocked = rows.some((r) => r.locked);

  return (
    <div className="space-y-3">
      {notReadyFocus && (
        <div className="flex items-center justify-between rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-sm">
          <span>
            <span className="font-semibold">{filteredRows.length}</span> shown — field
            projects that are not yet ready
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
            <span className="font-semibold">{filteredRows.length}</span> shown — field
            projects with a gate behind
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
            <span className="font-semibold">{filteredRows.length}</span> shown — field
            projects with readiness-required work starting in the next {horizon} months
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
      {/* Toolbar */}
      <ReadinessToolbar
        loading={loading}
        onRefresh={load}
        locked={isLocked}
        window={{ value: horizon, onChange: setHorizon, allLabel: "All field projects" }}
        search={{
          value: search,
          onChange: setSearch,
          placeholder: "Search field project…",
          ariaLabel: "Search readiness",
          testId: "readiness-search",
        }}
        count={
          filtering
            ? `${filteredRows.length} of ${scopedRows.length}`
            : `${scopedRows.length} ${scopedRows.length === 1 ? "project" : "projects"}`
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
      {scopedRows.length > 0 && (
        <ReadinessSummary
          rows={filteredRows.map((r) => r.figures)}
          unit={["field project", "field projects"]}
          windowMonths={horizon}
        />
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
            <p className="text-sm">Give activities a Project in the Data tab first.</p>
          </div>
        </div>
      ) : filteredRows.length === 0 ? (
        <div className="flex h-48 items-center justify-center rounded-lg border border-dashed text-muted-foreground">
          <p className="text-sm">
            {scopedRows.length === 0 ? (
              horizon !== 0 ? (
                `No field projects have readiness-required work starting in the next ${horizon} months.`
              ) : (
                "No field projects have readiness work left — their activities are completed or opted out."
              )
            ) : q ? (
              <>No field projects match &ldquo;{search}&rdquo;.</>
            ) : (
              "No field projects match the current filter."
            )}
          </p>
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
                {gates.map((gate) => {
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
                })}
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
                        {row.activity_count}{" "}
                        {row.activity_count === 1 ? "activity" : "activities"}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <DoneFigure figures={f} nothingTitle="Every gate is N/A — nothing applies" />
                    </td>
                    {gates.map(({ code }) => {
                      const key = `${row.well_project}:${code}`;
                      return (
                        <td key={code} className="px-1 py-2 text-center">
                          <div className="flex justify-center">
                            <ReadinessDot
                              code={code}
                              status={statusOf(row.checks, code)}
                              onChange={(next) => handleChange(row.well_project, code, next)}
                              disabled={saving === key || !!row.locked}
                            />
                          </div>
                        </td>
                      );
                    })}
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
