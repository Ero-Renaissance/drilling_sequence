import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, Lock, RefreshCw } from "lucide-react";
import {
  getTeamReadiness,
  resetWellReadiness,
  setReadiness,
  type ApplicabilityResult,
  type CatalogCheck,
  type ReadinessTarget,
  type RowFigures,
  type TeamCheckState,
  type TeamReadiness,
  type TeamWellRow,
} from "@/api/readiness";
import { PaginationFooter } from "@/components/ui/pagination-footer";
import { toast } from "@/components/ui/toaster";
import { useAuthStore } from "@/store/auth";
import { cn, formatDate } from "@/lib/utils";
import { inWindow } from "@/lib/readiness-window";
import { mergeApplicability, wellsWithOwnChoice } from "@/lib/readiness-applicability";
import { lookAlikeCodes } from "@/lib/readiness-categories";
import { ApplicabilityPicker } from "./ApplicabilityPicker";
import { ReadinessDot } from "./ReadinessDot";
import { FrozenCatalogProvider } from "./catalog";
import {
  CategoryCellIcon,
  CategoryToggle,
  NotSelectedCell,
  categoryIcons,
  columnSpan,
  gridColumns,
  type GridColumn,
} from "./category-columns";
import { useOpenCategories } from "./category-folds";
import {
  NOTHING_APPLIES,
  NOT_APPLICABLE,
  applies,
  defaultStatusOf,
  legendStatuses,
  notSelected,
  pickableStatuses,
} from "./check-meta";
import { checkIcon } from "./icon-registry";
import { ReadinessLegend } from "./ReadinessLegend";
import { DoneFigure, ReadinessSummary } from "./ReadinessSummary";
import { ReadinessToolbar } from "./ReadinessToolbar";
import { useReadinessWindow } from "./ReadinessWindow";


function wellKey(r: TeamWellRow): string {
  return `${r.well_project}\u0001${r.well_name}\u0001${r.activity_type}`;
}

/** A cell whose check doesn't apply to the target (unticked, spec §3.8) — or
 *  carries nothing there, like a project-only check on a well with no field
 *  project (§7.12): a muted "—", so the columns keep their place. */
function NotApplicableCell({ ownChoice = false }: { ownChoice?: boolean }) {
  const title = ownChoice ? `${NOT_APPLICABLE} — set on this well` : NOT_APPLICABLE;
  return (
    <span className="relative inline-flex h-7 w-7 items-center justify-center" title={title}>
      <span aria-hidden className="text-xs text-muted-foreground/50">
        —
      </span>
      <span className="sr-only">{title}</span>
      {ownChoice && <OwnChoiceMark />}
    </span>
  );
}

/** Marks a well's own choice about whether a two-level check applies — it
 *  differs from (or once differed from) its field project's tick (spec §3.8:
 *  "set on this well" wherever one exists). */
function OwnChoiceMark() {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute right-0 top-0 h-1.5 w-1.5 rounded-full bg-sky-500"
    />
  );
}

function CheckHeader({ check, rowSpan }: { check: CatalogCheck; rowSpan?: number }) {
  const Icon = checkIcon(check.icon_key);
  return (
    <th
      rowSpan={rowSpan}
      className="whitespace-nowrap px-1 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
      title={check.label}
    >
      <div className="flex items-center justify-center gap-1.5 text-foreground/80">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={2} />
        <span>{check.code}</span>
      </div>
    </th>
  );
}

/** The first column (field project / well) stays put while the grid scrolls
 *  sideways (spec §8.8) — opaque, so the columns slide under it. */
const PINNED_CELL = "sticky left-0 z-10 bg-card shadow-[1px_0_0_0_hsl(var(--border))]";
/** The pinned cell's content: the name shares its line with Checks…; the
 *  sub-line below takes the column's full width. The column is fixed-width, so
 *  a long unbroken name (up to 256 characters) wraps inside it rather than
 *  running into Checks… or the Done column. `overflow-wrap` is inherited by the
 *  name and the sub-line; `anywhere` (not `break-word`) also lowers the text's
 *  min-content width, so it wraps even as a flex item (the well name shares a
 *  flex row with its "N share" badge). */
const PINNED_CONTENT = "min-w-0 [overflow-wrap:anywhere]";
const PINNED_TOP = "flex items-start justify-between gap-2";

// Column widths, as on the Project gates page (fixed layout): the first column
// and Done keep theirs, and the check and category columns share the rest
// evenly — down to MIN_COLUMN_REM each, below which the table stops shrinking
// and its wrapper scrolls sideways (a category unfolded on a narrow screen).
const PINNED_REM = 20;
const DONE_REM = 4.5;
const MIN_COLUMN_REM = 3.75;

/** A team grid's table: the scrolling wrapper, the width floor and the columns. */
function GridTable({ columns, children }: { columns: readonly GridColumn[]; children: ReactNode }) {
  const n = columnSpan(columns);
  return (
    <div className="overflow-x-auto rounded-xl border border-border/70 bg-card shadow-soft-sm">
      <div style={{ minWidth: `${PINNED_REM + DONE_REM + n * MIN_COLUMN_REM}rem` }} data-grid-floor="">
        <table className="w-full table-fixed border-collapse text-sm">
          <colgroup>
            <col style={{ width: `${PINNED_REM}rem` }} />
            <col style={{ width: `${DONE_REM}rem` }} />
            {Array.from({ length: n }, (_, i) => (
              <col key={i} />
            ))}
          </colgroup>
          {children}
        </table>
      </div>
    </div>
  );
}

/** A row's Done figure (the server's per-row rollup, spec §3.7). */
function DoneCell({ row }: { row: { figures?: RowFigures } }) {
  return (
    <td className="px-2 py-2 text-center" data-done="">
      <DoneFigure figures={row.figures} nothingTitle={NOTHING_APPLIES} />
    </td>
  );
}
// The header row is tinted (`bg-muted/30` over the card): an inset shadow
// paints the same tint on the pinned header cell's opaque background.
const PINNED_HEAD =
  "sticky left-0 z-20 bg-card shadow-[inset_0_0_0_9999px_hsl(var(--muted)/0.3),1px_0_0_0_hsl(var(--border))]";

/**
 * A team grid's header: the pinned first column, each core check, and each
 * category — one folded column, or (unfolded) one column per type under the
 * category's name, on a second header row.
 */
function GridHead({
  first,
  columns,
  onToggle,
}: {
  first: string;
  columns: readonly GridColumn[];
  onToggle: (name: string) => void;
}) {
  const twoRows = columns.some((c) => c.kind === "category" && c.open);
  const span = twoRows ? 2 : undefined;
  return (
    <thead>
      <tr className="border-b border-border/70 bg-muted/30">
        <th
          rowSpan={span}
          className={cn(
            "whitespace-nowrap px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground",
            PINNED_HEAD,
          )}
          data-pinned=""
        >
          {first}
        </th>
        <th
          rowSpan={span}
          className="whitespace-nowrap px-2 py-2.5 text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
        >
          Done
        </th>
        {columns.map((col) =>
          col.kind === "check" ? (
            <CheckHeader key={col.check.code} check={col.check} rowSpan={span} />
          ) : (
            <th
              key={`category:${col.name}`}
              rowSpan={col.open ? undefined : span}
              colSpan={col.open ? col.items.length : undefined}
              className="whitespace-nowrap border-l border-border/60 px-1 py-1.5 text-center"
            >
              <CategoryToggle
                name={col.name}
                items={col.items}
                iconKey={col.icon_key}
                open={col.open}
                onToggle={() => onToggle(col.name)}
              />
            </th>
          ),
        )}
      </tr>
      {twoRows && (
        <tr className="border-b border-border/70 bg-muted/20">
          {columns.flatMap((col) =>
            col.kind === "category" && col.open
              ? col.items.map((c, i) => (
                  <th
                    key={c.code}
                    title={c.label}
                    className={cn(
                      "whitespace-nowrap px-1 py-1 text-center text-[10px] font-semibold text-muted-foreground",
                      i === 0 && "border-l border-border/60",
                    )}
                  >
                    {c.code}
                  </th>
                ))
              : [],
          )}
        </tr>
      )}
    </thead>
  );
}

/** One check's cell in a team grid. */
function gridCell(key: string, className: string | undefined, child: ReactNode): ReactNode {
  return (
    <td key={key} className={cn("px-1 py-2 text-center", className)}>
      <div className="flex justify-center">{child}</div>
    </td>
  );
}

/** A row's cells for each column group: a check's own cell, a folded category's
 *  read-only icon, or an unfolded category's type cells. */
function rowCells(
  columns: readonly GridColumn[],
  cells: Record<string, TeamCheckState> | undefined,
  lookAlikes: ReadonlySet<string>,
  checkCell: (c: CatalogCheck, className?: string) => ReactNode,
): ReactNode[] {
  return columns.flatMap((col): ReactNode[] => {
    if (col.kind === "check") return [checkCell(col.check)];
    if (col.open) {
      return col.items.map((c, i) => checkCell(c, i === 0 ? "border-l border-border/60" : undefined));
    }
    return [
      <td key={`category:${col.name}`} className="border-l border-border/60 px-1 py-2 text-center">
        <div className="flex justify-center">
          <CategoryCellIcon
            name={col.name}
            items={col.items}
            iconKey={col.icon_key}
            cells={cells}
            lookAlikes={lookAlikes}
          />
        </div>
      </td>,
    ];
  });
}

/**
 * One team's readiness in a campaign (the Wells / Logistics… lens):
 * - "Field projects": the team's project-level checks, one row per field project.
 * - "Wells": one row per well activity (project + well + activity type) with
 *   every team check. A check enabled at both levels shows the project's value
 *   faded ("from field project") until the well sets its own; "Reset to
 *   project" drops the well's value. Project-only checks are shown read-only on
 *   wells — they're set on the field-project row.
 * - Checks that apply (spec §3.8): each row's **Checks…** opens the team's tick
 *   list for that target. A check that doesn't apply shows a muted "—" ("Not
 *   applicable") and takes no status; its status menu never offers N/A. A
 *   well's own choice is marked "set on this well".
 * - Categories (phase 7, spec §8.8): core checks are columns of their own; each
 *   category is ONE folded column — its icon in the worst status of its types
 *   that apply, blank when none does — read-only, opening nothing. A click on
 *   its header unfolds its types (remembered per browser). A check that is NOT
 *   SELECTED (starts unticked; nothing nominated it) is a blank cell, never
 *   "—". The field-project / well column stays pinned while the grid scrolls.
 * The API decides who may write; the grid only mirrors it (team grant or admin).
 *
 * Rows and the summary follow spec §3.7: only targets with readiness-required
 * work left, starting within the page's window (shared `?horizon=`), are listed —
 * completed or opted-out ones drop out — and the summary adds up the server's
 * per-row figures of exactly the targets shown (wells, or field projects for a
 * team with only project-level checks), as the team's Overview tile does.
 */
export function TeamReadinessGrid({ projectId, teamCode }: { projectId: string; teamCode: string }) {
  const user = useAuthStore((s) => s.user);
  const [data, setData] = useState<TeamReadiness | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [months, setMonths] = useReadinessWindow();
  // Which categories are unfolded — every one starts folded; remembered per
  // browser (spec §8.8).
  const [openCategories, toggleCategory] = useOpenCategories(teamCode);
  // ?focus=behind — only the targets with a check behind (an Overview card's
  // "N behind" opens this); cleared from the banner.
  const [searchParams, setSearchParams] = useSearchParams();
  const behindFocus = searchParams.get("focus") === "behind";
  const clearFocus = () =>
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        params.delete("focus");
        return params;
      },
      { replace: true },
    );

  // Only the newest load may apply its data — a slow response from before a
  // later write can't overwrite the rows (and the summary) that write reloaded.
  // `loadPending`: the newest load hasn't settled yet.
  const loadSeq = useRef(0);
  const loadPending = useRef(false);
  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    loadPending.current = true;
    setLoading(true);
    setError(null);
    try {
      const next = await getTeamReadiness(projectId, teamCode);
      if (seq === loadSeq.current) setData(next);
    } catch (err: unknown) {
      if (seq === loadSeq.current) {
        setError(err instanceof Error ? err.message : "Failed to load readiness data");
      }
    } finally {
      if (seq === loadSeq.current) {
        loadPending.current = false;
        setLoading(false);
      }
    }
  }, [projectId, teamCode]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => setPageIndex(0), [search, teamCode, months, behindFocus]);

  const canEdit =
    !!user &&
    !!data &&
    (user.is_admin ||
      (data.team.editor_source === "team_grant" && (user.teams ?? []).includes(data.team.code)));
  const frozen = (check: CatalogCheck) => !!data?.locked && check.locks_with_plan;

  // A tick save answers with the target's new rows (a field project's plus its
  // wells', built as the read builds them): fold them in rather than reload.
  // A load still in flight may predate the save, so it can't land as it is —
  // but it can't just be dropped either: it may be the reload of a status
  // write, carrying that status. Supersede it with a fresh read, which has both.
  const applyTicks = useCallback(
    (result: ApplicabilityResult) => {
      setData((prev) => (prev ? mergeApplicability(prev, result) : prev));
      if (loadPending.current) void load();
    },
    [load],
  );

  // Write, then reload: inheritance means one project write can change many wells.
  const write = useCallback(
    async (key: string, action: () => Promise<void>) => {
      setSaving(key);
      try {
        await action();
        await load();
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : "Failed to save readiness");
      } finally {
        setSaving(null);
      }
    },
    [load],
  );

  const projectChecks = useMemo(() => data?.checks.filter((c) => c.applies_project) ?? [], [data]);
  // Each category's icon, decided once from the team's FULL definitions (spec
  // §3.9) — the Field projects grid shows only the project-level types, yet a
  // category wears the same icon there as in the Wells grid, the key and the chart.
  const iconOfCategory = useMemo(() => categoryIcons(data?.checks ?? []), [data]);
  // Core checks are columns of their own; each category is one folded column
  // until its header unfolds it (spec §8.8).
  const projectColumns = useMemo(
    () => gridColumns(projectChecks, openCategories, iconOfCategory),
    [projectChecks, openCategories, iconOfCategory],
  );
  const wellColumns = useMemo(
    () => gridColumns(data?.checks ?? [], openCategories, iconOfCategory),
    [data, openCategories, iconOfCategory],
  );
  // Codes a folded cell's title words with their label ("PC (Personnel Carrier)").
  const lookAlikes = useMemo(() => lookAlikeCodes((data?.checks ?? []).map((c) => c.code)), [data]);
  const hasWellChecks = !!data?.checks.some((c) => c.applies_well);
  const projectCellsOf = useMemo(
    () => new Map((data?.project_rows ?? []).map((r) => [r.well_project, r.checks])),
    [data],
  );

  const q = search.trim().toLowerCase();
  const wells = useMemo(
    () =>
      (data?.well_rows ?? []).filter(
        (r) =>
          inWindow(r, months) &&
          (!behindFocus || (r.figures?.behind ?? 0) > 0) &&
          (!q ||
            r.well_name.toLowerCase().includes(q) ||
            r.well_project.toLowerCase().includes(q) ||
            r.activity_type.toLowerCase().includes(q)),
      ),
    [data, q, months, behindFocus],
  );
  const projects = useMemo(
    () =>
      (data?.project_rows ?? []).filter(
        (r) =>
          inWindow(r, months) &&
          (!behindFocus || (r.figures?.behind ?? 0) > 0) &&
          (!q || r.well_project.toLowerCase().includes(q)),
      ),
    [data, q, months, behindFocus],
  );
  // How many targets the window covers, before the search and any drill-through
  // — the toolbar's "2 of 6", as on the Project gates page.
  const scopedCount = useMemo(
    () =>
      (hasWellChecks ? (data?.well_rows ?? []) : (data?.project_rows ?? [])).filter((r) =>
        inWindow(r, months),
      ).length,
    [data, months, hasWellChecks],
  );
  const pageCount = Math.max(1, Math.ceil(wells.length / pageSize));
  const safeIndex = Math.min(pageIndex, pageCount - 1);
  const visibleWells = wells.slice(safeIndex * pageSize, (safeIndex + 1) * pageSize);

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

  const teamName = data.team.name;
  const shown = hasWellChecks ? wells.length : projects.length;
  const filtering = Boolean(q) || behindFocus;
  const [one, many] = hasWellChecks ? ["well", "wells"] : ["project", "projects"];
  const targets = hasWellChecks ? "wells" : "field projects";
  // The dots read labels/icons from the definitions this response carries — the
  // server's view of the team's checks, consistent with the rows.
  return (
    <FrozenCatalogProvider checks={data.checks}>
      <div className="space-y-4">
        {behindFocus && (
          <div className="flex items-center justify-between rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
            <span>
              <span className="font-semibold">{shown}</span> shown — {targets} with a check behind
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
        {months !== 0 && (
          <div className="flex items-center justify-between rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-sm">
            <span>
              <span className="font-semibold">{shown}</span> shown — {targets} with
              readiness-required work starting in the next {months} months
            </span>
            <button
              type="button"
              onClick={() => setMonths(0)}
              className="text-xs font-medium text-primary hover:underline"
            >
              Clear filter
            </button>
          </div>
        )}
        <ReadinessToolbar
          loading={loading}
          onRefresh={load}
          window={{
            value: months,
            onChange: setMonths,
            allLabel: hasWellChecks ? "All wells" : "All field projects",
          }}
          search={{
            value: search,
            onChange: setSearch,
            placeholder: "Search well or project…",
            ariaLabel: "Search wells and field projects",
          }}
          count={filtering ? `${shown} of ${scopedCount}` : `${scopedCount} ${scopedCount === 1 ? one : many}`}
        />

        {!canEdit && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Lock className="h-3.5 w-3.5" />
            View only — updating {teamName} readiness needs the {teamName} grant (Admin page).
          </p>
        )}

        {data.checks.length === 0 ? (
          <div className="flex h-40 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
            No {teamName} checks defined yet — an admin can add them on the Admin page.
          </div>
        ) : (
          <>
            <ReadinessLegend statuses={legendStatuses(data.checks)} notApplicable checks={data.checks} />
            {/* The three figures over exactly the targets shown (spec §3.7). */}
            <ReadinessSummary
              rows={(hasWellChecks ? wells : projects).map((r) => r.figures)}
              unit={hasWellChecks ? ["well", "wells"] : ["field project", "field projects"]}
              windowMonths={months}
              projectGates={false}
            />
            {projectChecks.length > 0 && (
              <section aria-label="Field projects" className="space-y-2">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <h3 className="text-sm font-semibold">Field projects</h3>
                  {hasWellChecks && (
                    <span className="text-xs text-muted-foreground">
                      A field project&apos;s ticks apply to its wells unless a well has its own choice.
                    </span>
                  )}
                </div>
                {projects.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {q
                      ? "No field projects match."
                      : behindFocus
                        ? "No field projects with a check behind."
                        : months
                        ? `No field projects have readiness-required work starting in the next ${months} months.`
                        : "No field projects have readiness work left."}
                  </p>
                ) : (
                  <GridTable columns={projectColumns}>
                    <GridHead first="Field Project" columns={projectColumns} onToggle={toggleCategory} />
                    <tbody>
                      {projects.map((row) => {
                        const target: ReadinessTarget = {
                          scope: "project",
                          well_project: row.well_project,
                        };
                        const cellOf = (c: CatalogCheck, className?: string) => {
                          const key = `p:${row.well_project}:${c.code}`;
                          const current: TeamCheckState | undefined = row.checks[c.code];
                          // Not selected (starts unticked, nothing nominated it):
                          // blank — not even "—" (spec §3.9).
                          if (notSelected(current)) {
                            return gridCell(c.code, className, <NotSelectedCell />);
                          }
                          // Unticked (or carried nowhere): "—", no status to set.
                          if (!applies(current, c)) {
                            return gridCell(c.code, className, <NotApplicableCell />);
                          }
                          const status = current?.status ?? defaultStatusOf(c.status_set);
                          const disabled = !canEdit || saving === key || frozen(c);
                          return gridCell(
                            c.code,
                            className,
                            <ReadinessDot
                              code={c.code}
                              status={status}
                              disabled={disabled}
                              statuses={pickableStatuses(c)}
                              onChange={(next) =>
                                write(key, () => setReadiness(projectId, c.code, target, next))
                              }
                            />,
                          );
                        };
                        return (
                          <tr key={row.well_project} className="border-b border-border/40">
                            <td className={cn("px-3 py-2", PINNED_CELL)} data-pinned="">
                              <div className={PINNED_CONTENT}>
                                <div className={PINNED_TOP}>
                                  <div className="min-w-0 font-medium">{row.well_project}</div>
                                  <ApplicabilityPicker
                                    projectId={projectId}
                                    team={data.team}
                                    checks={data.checks}
                                    target={target}
                                    targetLabel={`${row.well_project} (field project)`}
                                    cells={row.checks}
                                    canEdit={canEdit}
                                    wellsWithOwnChoice={wellsWithOwnChoice(
                                      data.well_rows,
                                      row.well_project,
                                      data.checks,
                                    )}
                                    onSaved={applyTicks}
                                  />
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {row.activity_count}{" "}
                                  {row.activity_count === 1 ? "activity" : "activities"}
                                </div>
                              </div>
                            </td>
                            <DoneCell row={row} />
                            {rowCells(projectColumns, row.checks, lookAlikes, cellOf)}
                          </tr>
                        );
                      })}
                    </tbody>
                  </GridTable>
                )}
              </section>
            )}

            {hasWellChecks && (
              <section aria-label="Wells" className="space-y-2">
                <h3 className="text-sm font-semibold">Wells</h3>
                {wells.length === 0 ? (
                  <div className="flex h-32 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
                    {q ? (
                      <>No wells match &ldquo;{search}&rdquo;.</>
                    ) : behindFocus ? (
                      "No wells with a check behind."
                    ) : months ? (
                      `No wells have readiness-required work starting in the next ${months} months.`
                    ) : (
                      "No wells with readiness work left in this campaign."
                    )}
                  </div>
                ) : (
                  <GridTable columns={wellColumns}>
                    <GridHead first="Well" columns={wellColumns} onToggle={toggleCategory} />
                    <tbody>
                      {visibleWells.map((row) => {
                        const wk = wellKey(row);
                        const target = {
                          scope: "well" as const,
                          well_project: row.well_project,
                          well_name: row.well_name,
                          activity_type: row.activity_type,
                        };
                        const label = `${row.well_name} · ${row.well_project || "No field project"} · ${row.activity_type}`;
                        const cellOf = (c: CatalogCheck, className?: string) => {
                          const state = row.checks[c.code];
                          const key = `w:${wk}:${c.code}`;
                          // Not selected (starts unticked; neither this well nor its
                          // field project nominated it): blank, not "—" (spec §3.9).
                          if (notSelected(state)) {
                            return gridCell(c.code, className, <NotSelectedCell />);
                          }
                          // A tick inherits like a status (§3.8): only a two-level
                          // check under a field project has one to follow.
                          const inheritsTick = c.applies_project && c.applies_well && !!row.well_project;
                          const ownTick = inheritsTick && state?.applies_source === "well";
                          // Unticked, or carried nowhere (a project-only check on a
                          // well with no field project): "—", no status to set.
                          if (!applies(state, c)) {
                            return gridCell(c.code, className, <NotApplicableCell ownChoice={ownTick} />);
                          }
                          const status = state?.status ?? defaultStatusOf(c.status_set);
                          // Project-only checks are set on the field-project row.
                          if (!c.applies_well) {
                            return gridCell(
                              c.code,
                              className,
                              <ReadinessDot code={c.code} status={status} inherited />,
                            );
                          }
                          // Faded "from field project" only while the well reads its
                          // field project's status — not where that project doesn't
                          // apply: a well ticked there reads the default (§3.8).
                          const projectTicked =
                            projectCellsOf.get(row.well_project)?.[c.code]?.applies !== false;
                          const inherited =
                            state?.source !== "well" &&
                            c.applies_project &&
                            !!row.well_project &&
                            projectTicked;
                          const canReset = c.applies_project && state?.source === "well";
                          return gridCell(
                            c.code,
                            className,
                            <div
                              className="relative inline-flex"
                              title={ownTick ? "Applies — set on this well" : undefined}
                            >
                              <ReadinessDot
                                code={c.code}
                                status={status}
                                inherited={inherited}
                                disabled={!canEdit || saving === key || frozen(c)}
                                statuses={pickableStatuses(c)}
                                onChange={(next) =>
                                  write(key, () => setReadiness(projectId, c.code, target, next))
                                }
                                onReset={
                                  canReset
                                    ? () => write(key, () => resetWellReadiness(projectId, c.code, target))
                                    : undefined
                                }
                              />
                              {ownTick && <OwnChoiceMark />}
                            </div>,
                          );
                        };
                        return (
                          <tr key={wk} className="border-b border-border/40">
                            <td className={cn("px-3 py-2", PINNED_CELL)} data-pinned="">
                              <div className={PINNED_CONTENT}>
                                <div className={PINNED_TOP}>
                                  <div className="flex min-w-0 items-center gap-1.5 font-medium">
                                    {row.well_name}
                                    {row.activity_count > 1 && (
                                      <span
                                        className="inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap rounded bg-amber-500/15 px-1 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400"
                                        title={`${row.activity_count} activities share this field project, well and activity type, so they share this readiness`}
                                      >
                                        <AlertTriangle className="h-3 w-3" />
                                        {row.activity_count} share
                                      </span>
                                    )}
                                  </div>
                                  <ApplicabilityPicker
                                    projectId={projectId}
                                    team={data.team}
                                    checks={data.checks}
                                    target={target}
                                    targetLabel={label}
                                    cells={row.checks}
                                    projectCells={projectCellsOf.get(row.well_project)}
                                    canEdit={canEdit}
                                    onSaved={applyTicks}
                                  />
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {row.well_project || "No field project"} · {row.activity_type} ·{" "}
                                  {formatDate(row.start_date)}
                                </div>
                              </div>
                            </td>
                            <DoneCell row={row} />
                            {rowCells(wellColumns, row.checks, lookAlikes, cellOf)}
                          </tr>
                        );
                      })}
                    </tbody>
                  </GridTable>
                )}
                {wells.length > 0 && (
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
              </section>
            )}
          </>
        )}
      </div>
    </FrozenCatalogProvider>
  );
}
