import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { isNearTerm, checksReady } from "@/lib/watchlist";
import {
  CHECK_CODES,
  type ActivityReadiness,
  type CheckCode,
  type CheckStatus,
  listReadiness,
  upsertCheck,
} from "@/api/readiness";
import { PaginationFooter } from "@/components/ui/pagination-footer";
import { SearchInput } from "@/components/ui/search-input";
import { ReadinessDot } from "./ReadinessDot";
import { CHECK_META, STATUS_DOT } from "./check-meta";
import { ContractEditorDialog } from "./ContractEditorDialog";

const STATUSES: CheckStatus[] = ["Not Started", "In Progress", "Completed", "Behind", "N/A"];

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
            Checks
          </span>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3 md:grid-cols-4">
            {CHECK_CODES.map((code) => {
              const meta = CHECK_META[code];
              const Icon = meta.icon;
              return (
                <span
                  key={code}
                  className="flex items-center gap-2 text-xs text-foreground"
                  title={meta.label}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={2} />
                  <span className="font-medium">{code}</span>
                  <span className="truncate text-muted-foreground">{meta.label}</span>
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

function ProgressBar({ rows }: { rows: ActivityReadiness[] }) {
  let total = 0,
    completed = 0,
    inProgress = 0,
    na = 0;
  for (const row of rows) {
    for (const code of CHECK_CODES) {
      total++;
      const s = row.checks[code].status;
      if (s === "Completed") completed++;
      else if (s === "In Progress") inProgress++;
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
        <Stat label="In Progress" value={inProgress} dot={STATUS_DOT["In Progress"]} />
        <Stat
          label="Not Started"
          value={total - completed - inProgress - na}
          dot={STATUS_DOT["Not Started"]}
        />
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
  const [rows, setRows] = useState<ActivityReadiness[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null); // "activityId:checkCode"
  const [editingContractRig, setEditingContractRig] = useState<string | null>(null);
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
    async (activityId: string, code: CheckCode, next: CheckStatus) => {
      const key = `${activityId}:${code}`;
      const previous = rows.find((r) => r.activity_id === activityId)?.checks[code].status;

      // Optimistic update
      setRows((prev) =>
        prev.map((r) =>
          r.activity_id !== activityId
            ? r
            : { ...r, checks: { ...r.checks, [code]: { ...r.checks[code], status: next } } },
        ),
      );

      setSaving(key);
      try {
        await upsertCheck(projectId, activityId, code, next);
      } catch {
        if (previous) {
          setRows((prev) =>
            prev.map((r) =>
              r.activity_id !== activityId
                ? r
                : {
                    ...r,
                    checks: { ...r.checks, [code]: { ...r.checks[code], status: previous } },
                  },
            ),
          );
        }
        setError(`Failed to save ${code} status.`);
      } finally {
        setSaving(null);
      }
    },
    [projectId, rows],
  );

  const q = search.trim().toLowerCase();
  const textRows = q
    ? rows.filter((r) =>
        [r.activity_type, r.well_name, r.rig_name]
          .filter(Boolean)
          .some((v) => v!.toLowerCase().includes(q)),
      )
    : rows;
  // Watchlist drill-through: ?focus=not-ready narrows to the near-term, not-ready set.
  const notReadyFocus = searchParams.get("focus") === "not-ready";
  const filteredRows = notReadyFocus
    ? textRows.filter((r) => isNearTerm(r.start_date) && !checksReady(r.checks))
    : textRows;
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const safeIndex = Math.min(pageIndex, pageCount - 1);
  const visibleRows = filteredRows.slice(safeIndex * pageSize, safeIndex * pageSize + pageSize);

  function clearFocus() {
    searchParams.delete("focus");
    setSearchParams(searchParams, { replace: true });
  }

  return (
    <div className="space-y-3">
      {notReadyFocus && (
        <div className="flex items-center justify-between rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-sm">
          <span>
            <span className="font-semibold">{filteredRows.length}</span> shown — starting
            within the next 90 days and not yet ready
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

        <div className="ml-auto flex items-center gap-3">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search well, rig, type…"
            ariaLabel="Search readiness"
            testId="readiness-search"
          />
          <span className="text-xs tabular-nums text-muted-foreground">
            {q
              ? `${filteredRows.length} of ${rows.length}`
              : `${rows.length} ${rows.length === 1 ? "activity" : "activities"}`}
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
            <p className="font-medium">No activities</p>
            <p className="text-sm">Add activities in the Data tab first.</p>
          </div>
        </div>
      ) : filteredRows.length === 0 ? (
        <div className="flex h-48 items-center justify-center rounded-lg border border-dashed text-muted-foreground">
          <p className="text-sm">No activities match &ldquo;{search}&rdquo;.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border/70 bg-card shadow-soft-sm">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border/70 bg-muted/30">
                <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Activity
                </th>
                <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Well
                </th>
                <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Rig
                </th>
                <th className="px-3 py-2.5 text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Done
                </th>
                {CHECK_CODES.map((code) => {
                  const Icon = CHECK_META[code].icon;
                  return (
                    <th
                      key={code}
                      className="w-[72px] px-1 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                      title={CHECK_META[code].label}
                    >
                      <div className="flex items-center justify-center gap-1.5 text-foreground/80">
                        <Icon className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={2} />
                        <span>{code}</span>
                      </div>
                      <div className="mt-0.5 truncate text-[9px] font-normal normal-case text-muted-foreground/70">
                        {CHECK_META[code].label}
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
                    key={row.activity_id}
                    className={cn(
                      "border-b border-border/40 transition-colors hover:bg-accent/30",
                      i % 2 === 1 && "bg-muted/15",
                    )}
                  >
                    <td className="px-3 py-2 font-medium text-foreground">
                      {row.activity_type}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {row.well_name ?? <span className="text-muted-foreground/40">—</span>}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {row.rig_name ?? <span className="text-muted-foreground/40">—</span>}
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
                      const key = `${row.activity_id}:${code}`;
                      const isCon = code === "CON";
                      return (
                        <td key={code} className="px-1 py-2 text-center">
                          <div className="flex justify-center">
                            {isCon ? (
                              <ReadinessDot
                                code={code}
                                status={row.checks[code].status}
                                onClick={() => setEditingContractRig(row.rig_name ?? null)}
                                disabled={!row.rig_name}
                              />
                            ) : (
                              <ReadinessDot
                                code={code}
                                status={row.checks[code].status}
                                onChange={(next) => handleChange(row.activity_id, code, next)}
                                disabled={saving === key}
                              />
                            )}
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

      <ContractEditorDialog
        projectId={projectId}
        rigName={editingContractRig}
        open={editingContractRig !== null}
        onOpenChange={(open) => {
          if (!open) setEditingContractRig(null);
        }}
        onSaved={load}
      />
    </div>
  );
}
