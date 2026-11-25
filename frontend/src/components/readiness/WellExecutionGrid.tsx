import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Lock, MessageSquareText, RefreshCw, RotateCcw } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import {
  getTeamReadiness,
  resetWellReadiness,
  setReadiness,
  type CatalogCheck,
  type CheckStatus,
  type EffectiveCheckState,
  type ReadinessTarget,
  type TeamReadiness,
  type TeamWellRow,
} from "@/api/readiness";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PaginationFooter } from "@/components/ui/pagination-footer";
import { toast } from "@/components/ui/toaster";
import { inYears, rangePhrase, yearsOf } from "@/lib/readiness-window";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/store/auth";
import { FrozenCatalogProvider, PROJECTS_TEAM } from "./catalog";
import { STATUS_DOT, defaultStatusOf, pickableStatuses } from "./check-meta";
import { ReadinessDot } from "./ReadinessDot";
import { ReadinessSummary } from "./ReadinessSummary";
import { ReadinessToolbar } from "./ReadinessToolbar";
import { OutsideYears, useReadinessYears } from "./ReadinessWindow";
import { PROJECT_PARAM } from "./team-view";

/** The longest note a cell takes (backend `CheckUpsert.notes`). */
export const NOTE_MAX_LENGTH = 512;

/** A well with no Market set — its own group, listed last. */
const NO_STREAM = "No value stream";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** How each status is worded on this page — the sheet's legend. Stored statuses
 *  are unchanged (`STATUS_LABEL`); only this page's key spells them out. */
const SHEET_LABEL: Partial<Record<CheckStatus, string>> = {
  Completed: "Completed / In place",
  "On Track": "On track / Progressing",
  Behind: "Behind schedule",
  "Not started": "Not started",
  "N/A": "Not applicable",
};
const LEGEND_ORDER: CheckStatus[] = ["Completed", "On Track", "Behind", "Not started", "N/A"];

/** A cell's fill, as on the sheet: solid green / amber / red, a red ✕ on a plain
 *  cell for Not started, grey for N/A. Colour is never the only signal — each
 *  cell also carries a mark and its status in the label. */
const CELL_FILL: Partial<Record<CheckStatus, string>> = {
  Completed: "bg-emerald-600 text-white",
  "On Track": "bg-amber-400 text-amber-950",
  Behind: "bg-red-600 text-white",
  "Not started": "bg-background text-red-500",
  "N/A": "bg-muted text-muted-foreground",
};
const CELL_MARK: Partial<Record<CheckStatus, string>> = {
  Completed: "✓",
  "On Track": "•",
  Behind: "!",
  "Not started": "✕",
  "N/A": "—",
};

const wellTarget = (row: TeamWellRow): Extract<ReadinessTarget, { scope: "well" }> => ({
  scope: "well",
  well_project: row.well_project,
  well_name: row.well_name,
  activity_type: row.activity_type,
});

const wellKey = (row: TeamWellRow) =>
  `${row.well_project}\u0001${row.well_name}\u0001${row.activity_type}`;

const streamOf = (row: TeamWellRow) => row.market?.trim() || NO_STREAM;
/** The spud date a row is listed and filtered by: when its work left starts
 *  (its earliest activity may be completed, and in a year not shown). */
const spudOf = (row: TeamWellRow) => row.focus_start ?? row.start_date;

/** How many rows from `index` share `keyOf` with it — the cell's row span — or
 *  0 when the row above already opened that group. */
function spans<T>(rows: readonly T[], keyOf: (row: T) => string): number[] {
  const out = new Array<number>(rows.length).fill(0);
  let start = 0;
  for (let i = 1; i <= rows.length; i++) {
    if (i === rows.length || keyOf(rows[i]) !== keyOf(rows[start])) {
      out[start] = i - start;
      start = i;
    }
  }
  return out;
}

/**
 * Well Execution Readiness — the Projects team's checks, laid out as the "Well
 * Execution Readiness" sheet (docs/well-execution-readiness-spec.md Part B): one
 * row per well, grouped by value stream (the activity's Market) and field
 * project, the spud month under its year, and one solid coloured cell per check.
 * The user shows 1 to 3 years at a time; wells that spud outside them are
 * hidden (and counted, so the list never reads as everything).
 *
 * Each well follows its field project until it is given its own value (marked
 * with a dot); a cell's menu sets the status, edits its note or resets the well
 * to its project; the project cell sets a check for every well that follows it.
 * Campaign planners (and admins) edit — the API stays the authority.
 *
 * Rows and the summary follow spec §3.7: wells with readiness-required work
 * left, starting within the years shown; the summary adds up the server's
 * per-row figures of exactly the wells shown.
 */
export function WellExecutionGrid({
  projectId,
  canEditPlan = false,
}: {
  projectId: string;
  canEditPlan?: boolean;
}) {
  const user = useAuthStore((s) => s.user);
  const [data, setData] = useState<TeamReadiness | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [stream, setStream] = useState("");
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  // The years shown — 1 to 3 at a time: the spud columns, and which wells are
  // listed (those that spud within them).
  const [range, setRange] = useReadinessYears();
  const [searchParams, setSearchParams] = useSearchParams();
  // The cell whose note is being edited, and the field project being set.
  const [noteFor, setNoteFor] = useState<{ row: TeamWellRow; check: CatalogCheck } | null>(null);
  const [projectFor, setProjectFor] = useState<string | null>(null);

  const behindFocus = searchParams.get("focus") === "behind";
  const projectFilter = searchParams.get(PROJECT_PARAM);
  const clearParam = (name: string) =>
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        params.delete(name);
        return params;
      },
      { replace: true },
    );

  // Only the newest load may apply its data.
  const loadSeq = useRef(0);
  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    setLoading(true);
    setError(null);
    try {
      const next = await getTeamReadiness(projectId, PROJECTS_TEAM, range);
      if (seq === loadSeq.current) setData(next);
    } catch (err: unknown) {
      if (seq === loadSeq.current) {
        setError(err instanceof Error ? err.message : "Failed to load readiness data");
      }
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [projectId, range]);

  // A write that settles after the years changed must reload the years shown
  // NOW, not the ones it started under — it calls the newest `load`.
  const latestLoad = useRef(load);
  latestLoad.current = load;
  useEffect(() => {
    load();
  }, [load]);

  const canEdit = !!user && (user.is_admin || canEditPlan);

  // Write, then reload: a field project's value reaches every well following it.
  const write = useCallback(
    async (key: string, action: () => Promise<void>) => {
      setSaving(key);
      try {
        await action();
        await latestLoad.current();
        return true;
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : "Failed to save readiness");
        return false;
      } finally {
        setSaving(null);
      }
    },
    [],
  );

  const checks = useMemo(() => data?.checks ?? [], [data]);
  const streams = useMemo(
    () => [...new Set((data?.well_rows ?? []).map(streamOf))].sort(byStream),
    [data],
  );
  const q = search.trim().toLowerCase();
  const scoped = useMemo(
    () => (data?.well_rows ?? []).filter((r) => inYears(r, range)),
    [data, range],
  );
  const rows = useMemo(
    () =>
      scoped
        .filter(
          (r) =>
            (!stream || streamOf(r) === stream) &&
            (!behindFocus || (r.figures?.behind ?? 0) > 0) &&
            (projectFilter === null || r.well_project === projectFilter) &&
            (!q ||
              r.well_name.toLowerCase().includes(q) ||
              r.well_project.toLowerCase().includes(q) ||
              r.activity_type.toLowerCase().includes(q)),
        )
        // Grouped as the sheet: value stream, then field project, then spud date.
        .sort(
          (x, y) =>
            byStream(streamOf(x), streamOf(y)) ||
            byProject(x.well_project, y.well_project) ||
            spudOf(x).localeCompare(spudOf(y)) ||
            x.well_name.localeCompare(y.well_name),
        ),
    [scoped, stream, behindFocus, projectFilter, q],
  );
  useEffect(() => setPageIndex(0), [search, stream, range, behindFocus, projectFilter]);

  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const safeIndex = Math.min(pageIndex, pageCount - 1);
  const visible = rows.slice(safeIndex * pageSize, (safeIndex + 1) * pageSize);
  const streamSpans = spans(visible, streamOf);
  const projectSpans = spans(visible, (r) => `${streamOf(r)}\u0001${r.well_project}`);
  // One column per year shown, whether or not a well spuds in it.
  const years = useMemo(() => yearsOf(range).map(String), [range]);
  // Wells with work left that the years shown leave out.
  const outside = (data?.well_rows ?? []).filter((r) => !!r.focus_start).length - scoped.length;
  const projectCells = useMemo(
    () => new Map((data?.project_rows ?? []).map((r) => [r.well_project, r.checks])),
    [data],
  );

  if (error) {
    return (
      <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600" role="alert">
        {error}
      </p>
    );
  }
  if (!data) {
    return (
      <div className="flex h-48 items-center justify-center text-muted-foreground">
        <RefreshCw className="mr-2 h-5 w-5 animate-spin" />
        Loading readiness…
      </div>
    );
  }

  const filtering = Boolean(q) || Boolean(stream) || behindFocus || projectFilter !== null;
  const th =
    "border border-border/70 bg-muted/40 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground";

  return (
    <FrozenCatalogProvider checks={data.checks}>
      <div className="space-y-3">
        {behindFocus && (
          <FilterBanner tone="bad" onClear={() => clearParam("focus")}>
            <span className="font-semibold">{rows.length}</span> shown — wells with a check behind
          </FilterBanner>
        )}
        {projectFilter !== null && (
          <FilterBanner onClear={() => clearParam(PROJECT_PARAM)}>
            <span className="font-semibold">{rows.length}</span> shown — wells of{" "}
            {projectFilter || "no field project"}
          </FilterBanner>
        )}

        <ReadinessToolbar
          loading={loading}
          onRefresh={load}
          locked={data.locked}
          viewSwitch={
            streams.length > 1 ? (
              <select
                aria-label="Value stream"
                value={stream}
                onChange={(e) => setStream(e.target.value)}
                className="rounded-md border border-border bg-background px-2 py-1 text-xs"
              >
                <option value="">All value streams</option>
                {streams.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            ) : undefined
          }
          years={{ value: range, onChange: setRange }}
          search={{
            value: search,
            onChange: setSearch,
            placeholder: "Search well or project…",
            ariaLabel: "Search wells and field projects",
            testId: "readiness-search",
          }}
          count={
            filtering
              ? `${rows.length} of ${scoped.length}`
              : `${scoped.length} ${scoped.length === 1 ? "well" : "wells"}`
          }
        />

        <OutsideYears count={outside} unit="well" />

        {!canEdit && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Lock className="h-3.5 w-3.5" />
            View only — updating these checks needs planner rights on this campaign.
          </p>
        )}

        {scoped.length > 0 && (
          <ReadinessSummary
            rows={rows.map((r) => r.figures)}
            unit={["well", "wells"]}
            scope={rangePhrase(range)}
          />
        )}

        {rows.length === 0 ? (
          <div className="flex h-40 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
            {q ? (
              <>No wells match &ldquo;{search}&rdquo;.</>
            ) : filtering ? (
              "No wells match the current filter."
            ) : (
              `No wells with readiness work left spud in ${rangePhrase(range)}.`
            )}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border/70 bg-card shadow-soft-sm">
            <table
              className="w-full min-w-[1040px] border-collapse text-sm"
              aria-label="Well execution readiness"
            >
              <thead>
                <tr>
                  <th rowSpan={2} className={cn(th, "w-[9%] text-left")}>
                    Value Stream
                  </th>
                  <th rowSpan={2} className={cn(th, "w-[13%] text-left")}>
                    Project
                  </th>
                  <th rowSpan={2} className={cn(th, "w-[14%] text-left")}>
                    Wells
                  </th>
                  <th colSpan={years.length} className={th}>
                    Spud date
                  </th>
                  <th colSpan={checks.length} className={th}>
                    Well Execution Readiness
                  </th>
                </tr>
                <tr>
                  {years.map((y) => (
                    <th key={y} className={cn(th, "w-12 tabular-nums")}>
                      {y}
                    </th>
                  ))}
                  {checks.map((c) => (
                    <th
                      key={c.code}
                      className={cn(th, "min-w-[76px] normal-case leading-tight tracking-normal")}
                      title={`${c.code} — ${c.label}`}
                    >
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((row, i) => {
                  const wk = wellKey(row);
                  // The spud date shown is the one the row is listed by: when
                  // its work left starts, not an earlier completed activity's.
                  const spud = spudOf(row);
                  const month = MONTHS[Number(spud.slice(5, 7)) - 1];
                  const year = spud.slice(0, 4);
                  return (
                    <tr key={wk}>
                      {streamSpans[i] > 0 && (
                        <td
                          rowSpan={streamSpans[i]}
                          className="border border-border/70 px-2 py-1.5 align-middle text-xs font-medium"
                        >
                          {streamOf(row)}
                        </td>
                      )}
                      {projectSpans[i] > 0 && (
                        <td
                          rowSpan={projectSpans[i]}
                          className="border border-border/70 px-2 py-1.5 align-middle [overflow-wrap:anywhere]"
                        >
                          <div className="text-xs font-medium">
                            {row.well_project || (
                              <span className="text-muted-foreground">No field project</span>
                            )}
                          </div>
                          {canEdit && row.well_project && (
                            <button
                              type="button"
                              onClick={() => setProjectFor(row.well_project)}
                              aria-label={`Set checks for all wells of ${row.well_project}`}
                              className="mt-0.5 text-[11px] font-medium text-primary hover:underline"
                            >
                              Set for all wells
                            </button>
                          )}
                        </td>
                      )}
                      <td className="border border-border/70 px-2 py-1.5 [overflow-wrap:anywhere]">
                        <div className="font-medium" data-testid="well-name">
                          {row.well_name}
                        </div>
                        <div className="text-[11px] text-muted-foreground">{row.activity_type}</div>
                      </td>
                      {years.map((y) => (
                        <td
                          key={y}
                          className="border border-border/70 px-1 py-1.5 text-center text-xs font-semibold tabular-nums"
                        >
                          {y === year ? month : ""}
                        </td>
                      ))}
                      {checks.map((c) => {
                        const state = row.checks[c.code];
                        const key = `${wk}:${c.code}`;
                        const status = state?.status ?? defaultStatusOf(c.status_set);
                        return (
                          <td key={c.code} className="border border-border/70 p-0">
                            <StatusCell
                              check={c}
                              well={row.well_name}
                              state={state}
                              status={status}
                              editable={canEdit}
                              busy={saving === key}
                              canReset={state?.source === "well" && !!row.well_project}
                              onStatus={(next) =>
                                write(key, () => setReadiness(projectId, c.code, wellTarget(row), next))
                              }
                              onReset={() =>
                                write(key, () => resetWellReadiness(projectId, c.code, wellTarget(row)))
                              }
                              onNote={() => setNoteFor({ row, check: c })}
                            />
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

        {rows.length > 0 && (
          <>
            <Legend />
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
          </>
        )}

        {noteFor && (
          <NoteDialog
            row={noteFor.row}
            check={noteFor.check}
            onClose={() => setNoteFor(null)}
            onSave={async (note) => {
              const { row, check } = noteFor;
              const state = row.checks[check.code];
              const ok = await write(`${wellKey(row)}:${check.code}`, () =>
                setReadiness(
                  projectId,
                  check.code,
                  wellTarget(row),
                  state?.status ?? defaultStatusOf(check.status_set),
                  note,
                ),
              );
              if (ok) setNoteFor(null);
            }}
          />
        )}

        {projectFor !== null && (
          <Dialog open onOpenChange={(open) => !open && setProjectFor(null)}>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Set for all wells of {projectFor}</DialogTitle>
                <DialogDescription>
                  Every well of this field project follows these values. A well that has been
                  given its own value keeps it.
                </DialogDescription>
              </DialogHeader>
              <ul className="divide-y divide-border/60" aria-label={`Checks of ${projectFor}`}>
                {checks.map((c) => {
                  const cell = projectCells.get(projectFor)?.[c.code];
                  const key = `p:${projectFor}:${c.code}`;
                  const status = cell?.status ?? defaultStatusOf(c.status_set);
                  return (
                    <li key={c.code} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                      <span>
                        <span className="font-mono text-xs font-semibold">{c.code}</span>{" "}
                        <span className="text-muted-foreground">{c.label}</span>
                      </span>
                      <span className="flex items-center gap-2 text-xs text-muted-foreground">
                        {SHEET_LABEL[status] ?? status}
                        <ReadinessDot
                          code={c.code}
                          status={status}
                          disabled={saving === key}
                          statuses={pickableStatuses(c)}
                          onChange={(next) =>
                            write(key, () =>
                              setReadiness(
                                projectId,
                                c.code,
                                { scope: "project", well_project: projectFor },
                                next,
                              ),
                            )
                          }
                        />
                      </span>
                    </li>
                  );
                })}
              </ul>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setProjectFor(null)}>
                  Done
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>
    </FrozenCatalogProvider>
  );
}

/** Value streams by name; wells with none last. */
function byStream(a: string, b: string): number {
  if (a === b) return 0;
  if (a === NO_STREAM) return 1;
  if (b === NO_STREAM) return -1;
  return a.localeCompare(b);
}

/** Field projects by name; wells with none last. */
function byProject(a: string, b: string): number {
  if (a === b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a.localeCompare(b);
}

function FilterBanner({
  children,
  onClear,
  tone,
}: {
  children: React.ReactNode;
  onClear: () => void;
  tone?: "bad";
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between rounded-lg border px-3 py-2 text-sm",
        tone === "bad" ? "border-destructive/40 bg-destructive/5" : "border-primary/40 bg-primary/5",
      )}
    >
      <span>{children}</span>
      <button
        type="button"
        onClick={onClear}
        className="text-xs font-medium text-primary hover:underline"
      >
        Clear filter
      </button>
    </div>
  );
}

/** One check for one well: a solid cell in its status's colour with a mark, its
 *  note, and a dot when the value is the well's own. Editable → a menu. */
function StatusCell({
  check,
  well,
  state,
  status,
  editable,
  busy,
  canReset,
  onStatus,
  onReset,
  onNote,
}: {
  check: CatalogCheck;
  well: string;
  state: EffectiveCheckState | undefined;
  status: CheckStatus;
  editable: boolean;
  busy: boolean;
  canReset: boolean;
  onStatus: (next: CheckStatus) => void;
  onReset: () => void;
  onNote: () => void;
}) {
  const own = state?.source === "well";
  const note = state?.notes?.trim() || "";
  const label = SHEET_LABEL[status] ?? status;
  const title = [
    `${check.label} for ${well}: ${label}`,
    own ? "set on this well" : state?.source === "project" ? "from its field project" : "not set yet",
    note ? `Note: ${note}` : "",
  ]
    .filter(Boolean)
    .join(" — ");
  const body = (
    <>
      {own && (
        <span
          aria-hidden
          className="absolute left-1 top-1 h-1.5 w-1.5 rounded-full bg-current opacity-80"
        />
      )}
      {note ? (
        <span className="block max-w-full truncate px-1.5 text-[11px] font-medium leading-none">
          {note}
        </span>
      ) : (
        <span aria-hidden className="text-sm font-bold leading-none">
          {CELL_MARK[status] ?? ""}
        </span>
      )}
    </>
  );
  const cellClass = cn(
    "relative flex h-9 w-full items-center justify-center",
    CELL_FILL[status] ?? "bg-muted text-muted-foreground",
  );
  if (!editable) {
    return (
      <div className={cellClass} title={title} role="img" aria-label={title} data-status={status}>
        {body}
      </div>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            cellClass,
            "transition-[filter] hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-wait disabled:opacity-60",
          )}
          title={title}
          aria-label={`${title}. Click to change.`}
          data-status={status}
          disabled={busy}
        >
          {body}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" sideOffset={4} className="w-56">
        <div className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {check.label} · {well}
        </div>
        <DropdownMenuSeparator />
        {pickableStatuses(check).map((s) => (
          <DropdownMenuItem
            key={s}
            onClick={() => {
              // Picking the status already shown still makes it the well's own.
              if (s !== status || !own) onStatus(s);
            }}
            className={cn("gap-2.5 py-2", s === status && "bg-accent/50")}
          >
            <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", STATUS_DOT[s])} />
            <span className="flex-1">{SHEET_LABEL[s] ?? s}</span>
            {s === status && <Check className="h-3.5 w-3.5 text-muted-foreground" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onNote} className="gap-2.5 py-2">
          <MessageSquareText className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="flex-1">{note ? "Edit note…" : "Add note…"}</span>
        </DropdownMenuItem>
        {canReset && (
          <DropdownMenuItem onClick={onReset} className="gap-2.5 py-2">
            <RotateCcw className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="flex-1">Reset to project</span>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The short text a cell carries ("10k"), saved with the well's own value. */
function NoteDialog({
  row,
  check,
  onClose,
  onSave,
}: {
  row: TeamWellRow;
  check: CatalogCheck;
  onClose: () => void;
  onSave: (note: string | null) => Promise<void>;
}) {
  const state = row.checks[check.code];
  // A note the well follows from its field project isn't the well's to edit:
  // start empty, so saving gives the well its own.
  const [text, setText] = useState(state?.source === "well" ? (state.notes ?? "") : "");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Note — {check.label} · {row.well_name}
          </DialogTitle>
          <DialogDescription>
            Shown in the cell. Saving makes this check {row.well_name}&apos;s own value.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            await onSave(text.trim() || null);
            setBusy(false);
          }}
          className="space-y-3"
        >
          <textarea
            aria-label="Note"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={NOTE_MAX_LENGTH}
            rows={3}
            autoFocus
            spellCheck
            className="w-full rounded-md border border-input bg-background/60 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="e.g. 10k, awaiting partner sign-off…"
          />
          <p className="text-right text-[11px] tabular-nums text-muted-foreground">
            {text.length}/{NOTE_MAX_LENGTH}
          </p>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save note"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The key under the table, as on the sheet. */
function Legend() {
  return (
    <div
      className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-border/70 bg-card px-3 py-2 text-xs"
      aria-label="Key"
    >
      {LEGEND_ORDER.map((s) => (
        <span key={s} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className={cn(
              "flex h-4 w-7 items-center justify-center rounded-sm border border-border/70 text-[10px] font-bold",
              CELL_FILL[s],
            )}
          >
            {CELL_MARK[s]}
          </span>
          {SHEET_LABEL[s]}
        </span>
      ))}
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-foreground/70" />
        set on this well (otherwise it follows its field project)
      </span>
    </div>
  );
}
