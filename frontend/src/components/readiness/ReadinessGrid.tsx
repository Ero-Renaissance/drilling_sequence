import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Lock } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { checksReady } from "@/lib/watchlist";
import {
  CHECK_CODES,
  type ProjectReadiness,
  type CheckCode,
  type CheckStatus,
  listReadiness,
  upsertCheck,
} from "@/api/readiness";
import { PaginationFooter } from "@/components/ui/pagination-footer";
import { SearchInput } from "@/components/ui/search-input";
import { toast } from "@/components/ui/toaster";
import { ReadinessDot } from "./ReadinessDot";
import { CHECK_META, STATUS_DOT } from "./check-meta";

const STATUSES: CheckStatus[] = ["On Track", "Behind", "Completed", "N/A"];

// Focus-window day counts — identical to the dashboard's HORIZON_DAYS so the
// page's "next N months" matches the Overview readiness KPI's window exactly
// (6mo≈183d, 12mo=365d, 24mo=730d), rather than drifting on calendar months.
const HORIZON_DAYS: Record<number, number> = { 6: 183, 12: 365, 24: 730 };

/** True when a field project falls inside the N-month focus window: it has
 *  pending readiness work (`focus_start` set) that starts on/before today + N.
 *  Mirrors the backend focus filter the readiness KPI uses. */
function inHorizon(focusStart: string | null | undefined, months: number): boolean {
  if (!focusStart) return false;
  const days = HORIZON_DAYS[months];
  if (!days) return true;
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() + days);
  return new Date(`${focusStart}T00:00:00`).getTime() <= cutoff.getTime();
}

// ── Legend ───────────────────────────────────────────────────────────────────

function Legend() {
  return (
    <div className="rounded-lg border border-border/70 bg-card/60 px-4 py-3">
      <div className="flex flex-col gap-3 md:flex-row md:gap-8">
        {/* Status colors */}
        <div className="flex flex-col gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Status
          </span>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {STATUSES.map((s) => (
              <span key={s} className="flex items-center gap-1.5 text-xs text-foreground">
                <span className={cn("h-2.5 w-2.5 rounded-full", STATUS_DOT[s])} />
                {s}
              </span>
            ))}
          </div>
        </div>

        {/* Separator on md+ */}
        <div className="hidden w-px bg-border/70 md:block" />

        {/* Check icons */}
        <div className="flex flex-1 flex-col gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Readiness Checks
          </span>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {CHECK_CODES.map((code) => {
              const meta = CHECK_META[code];
              const Icon = meta.icon;
              return (
                <span
                  key={code}
                  className="flex items-center gap-1.5 whitespace-nowrap text-xs text-foreground"
                >
                  <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={2} />
                  <span className="font-medium">{code}</span>
                  <span className="text-muted-foreground">{meta.label}</span>
                </span>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Progress summary bar ──────────────────────────────────────────────────────

function ProgressBar({ rows }: { rows: ProjectReadiness[] }) {
  let total = 0,
    completed = 0,
    onTrack = 0,
    behind = 0,
    na = 0;
  for (const row of rows) {
    for (const code of CHECK_CODES) {
      total++;
      const s = row.checks[code].status;
      if (s === "Completed") completed++;
      else if (s === "On Track") onTrack++;
      else if (s === "Behind") behind++;
      else if (s === "N/A") na++;
    }
  }
  const effective = total - na;
  const pct = effective > 0 ? Math.round((completed / effective) * 100) : 0;

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-lg border border-border/70 bg-card px-4 py-3 shadow-soft-sm">
      <div className="min-w-[200px] flex-1">
        <div className="mb-1.5 flex items-center justify-between text-xs">
          <span className="font-medium text-muted-foreground">Overall Readiness</span>
          <span className="font-semibold tabular-nums text-foreground">{pct}%</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      <div className="flex gap-5 text-xs">
        <Stat label="Completed" value={completed} dot={STATUS_DOT["Completed"]} />
        <Stat label="On Track" value={onTrack} dot={STATUS_DOT["On Track"]} />
        <Stat label="Behind" value={behind} dot={STATUS_DOT["Behind"]} />
        {na > 0 && <Stat label="N/A" value={na} dot={STATUS_DOT["N/A"]} />}
      </div>
    </div>
  );
}

function Stat({ label, value, dot }: { label: string; value: number; dot: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={cn("h-2.5 w-2.5 rounded-full", dot)} />
      <div>
        <div className="text-sm font-semibold leading-none tabular-nums text-foreground">
          {value}
        </div>
        <div className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface ReadinessGridProps {
  projectId: string;
}

export function ReadinessGrid({ projectId }: ReadinessGridProps) {
  const [rows, setRows] = useState<ProjectReadiness[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null); // "wellProject:checkCode"
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [search, setSearch] = useState("");
  const [searchParams, setSearchParams] = useSearchParams();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await listReadiness(projectId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load readiness data");
    } finally {
      setLoading(false);
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
      const previous = rows.find((r) => r.well_project === wellProject)?.checks[code].status;

      // Optimistic update — a gate is set for the whole field project.
      setRows((prev) =>
        prev.map((r) =>
          r.well_project !== wellProject
            ? r
            : { ...r, checks: { ...r.checks, [code]: { ...r.checks[code], status: next } } },
        ),
      );

      setSaving(key);
      try {
        await upsertCheck(projectId, wellProject, code, next);
      } catch (err) {
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
        setSaving(null);
      }
    },
    [projectId, rows],
  );

  const q = search.trim().toLowerCase();
  // Drill-through filters, composed with the text search:
  //  • ?focus=not-ready → only field projects that aren't yet ready.
  //  • ?horizon=6|12|24 → only projects whose earliest not-done, readiness-
  //    required activity starts within N months (focus_start), matching the
  //    Overview readiness KPI's window so the page shows exactly what it counted.
  const notReadyFocus = searchParams.get("focus") === "not-ready";
  const horizonParam = searchParams.get("horizon");
  const horizon =
    horizonParam === "6" || horizonParam === "12" || horizonParam === "24"
      ? Number(horizonParam)
      : 0; // 0 = all field projects (no window)
  const filteredRows = rows.filter((r) => {
    if (q && !r.well_project.toLowerCase().includes(q)) return false;
    if (notReadyFocus && checksReady(r.checks)) return false;
    if (horizon !== 0 && !inHorizon(r.focus_start, horizon)) return false;
    return true;
  });
  const filtering = Boolean(q) || notReadyFocus || horizon !== 0;
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const safeIndex = Math.min(pageIndex, pageCount - 1);
  const visibleRows = filteredRows.slice(safeIndex * pageSize, safeIndex * pageSize + pageSize);

  function clearFocus() {
    searchParams.delete("focus");
    setSearchParams(searchParams, { replace: true });
  }

  function setHorizon(next: number) {
    if (next === 0) searchParams.delete("horizon");
    else searchParams.set("horizon", String(next));
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
      <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-card px-3 py-2 shadow-soft-sm">
        <span className="text-sm font-medium text-foreground">Readiness Tracker</span>
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

        {isLocked && (
          <span
            className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700"
            title="The campaign's plan is locked."
          >
            <Lock className="h-3 w-3" />
            Plan locked
          </span>
        )}

        <div className="ml-auto flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="whitespace-nowrap">Window</span>
            <select
              aria-label="Readiness time window"
              value={String(horizon)}
              onChange={(e) => setHorizon(Number(e.target.value))}
              className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
            >
              <option value="0">All field projects</option>
              <option value="6">Next 6 months</option>
              <option value="12">Next 12 months</option>
              <option value="24">Next 24 months</option>
            </select>
          </label>
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search field project…"
            ariaLabel="Search readiness"
            testId="readiness-search"
          />
          <span className="text-xs tabular-nums text-muted-foreground">
            {filtering
              ? `${filteredRows.length} of ${rows.length}`
              : `${rows.length} ${rows.length === 1 ? "project" : "projects"}`}
          </span>
        </div>
      </div>

      {error && (
        <p
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {error}
        </p>
      )}

      {/* Legend (always visible above the matrix) */}
      <Legend />

      {/* Progress summary */}
      {rows.length > 0 && <ProgressBar rows={rows} />}

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
            {q ? (
              <>No field projects match &ldquo;{search}&rdquo;.</>
            ) : horizon !== 0 ? (
              `No field projects have readiness-required work starting in the next ${horizon} months.`
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
              {CHECK_CODES.map((code) => (
                <col key={code} />
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
                {CHECK_CODES.map((code) => {
                  const Icon = CHECK_META[code].icon;
                  return (
                    <th
                      key={code}
                      className="px-1 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                      title={CHECK_META[code].label}
                    >
                      <div className="flex items-center justify-center gap-1.5 text-foreground/80">
                        <Icon className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={2} />
                        <span>{code}</span>
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row, i) => {
                const completed = CHECK_CODES.filter(
                  (c) => row.checks[c].status === "Completed",
                ).length;
                const na = CHECK_CODES.filter((c) => row.checks[c].status === "N/A").length;
                const effective = CHECK_CODES.length - na;
                const rowPct = effective > 0 ? Math.round((completed / effective) * 100) : 100;

                return (
                  <tr
                    key={row.well_project}
                    className={cn(
                      "border-b border-border/40 transition-colors hover:bg-accent/30",
                      i % 2 === 1 && "bg-muted/15",
                    )}
                  >
                    <td className="px-3 py-2">
                      <div className="font-medium text-foreground">{row.well_project}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {row.activity_count}{" "}
                        {row.activity_count === 1 ? "activity" : "activities"}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span
                        className={cn(
                          "text-xs font-semibold tabular-nums",
                          rowPct === 100 ? "text-emerald-500" : "text-muted-foreground",
                        )}
                      >
                        {completed}/{effective}
                      </span>
                    </td>
                    {CHECK_CODES.map((code) => {
                      const key = `${row.well_project}:${code}`;
                      return (
                        <td key={code} className="px-1 py-2 text-center">
                          <div className="flex justify-center">
                            <ReadinessDot
                              code={code}
                              status={row.checks[code].status}
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
