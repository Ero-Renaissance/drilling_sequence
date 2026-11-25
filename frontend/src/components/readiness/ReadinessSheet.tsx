import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  Hash,
  Lock,
  MessageSquareText,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import { useSearchParams } from "react-router-dom";
import {
  getTeamReadiness,
  resetWellReadiness,
  setQuantity,
  setReadiness,
  type ApplicabilityResult,
  type CatalogCheck,
  type CheckStatus,
  type ReadinessTarget,
  type Severity,
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
import { categoryCell } from "@/lib/chart-layout";
import { mergeApplicability, wellsWithOwnChoice } from "@/lib/readiness-applicability";
import { codeWithLabel, lookAlikeCodes } from "@/lib/readiness-categories";
import {
  MAX_QUANTITY,
  MIN_QUANTITY,
  categoryQuantity,
  ownQuantity,
  parseQuantity,
  quantityLabel,
  quantityOf,
} from "@/lib/readiness-quantity";
import { inYears, rangePhrase, yearsOf } from "@/lib/readiness-window";
import { categoryLine } from "@/lib/team-summary";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/store/auth";
import { ApplicabilityPicker } from "./ApplicabilityPicker";
import { FrozenCatalogProvider, PROJECTS_TEAM } from "./catalog";
import { categoryTitle, columnSpan, gridColumns, type GridColumn } from "./category-columns";
import { useOpenCategories } from "./category-folds";
import {
  NOT_APPLICABLE,
  STATUS_DOT,
  STATUS_SEVERITY,
  applies,
  defaultStatusOf,
  legendStatuses,
  notSelected,
  pickableStatuses,
} from "./check-meta";
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
const sheetLabel = (status: CheckStatus) => SHEET_LABEL[status] ?? status;

/** A cell's fill, as on the sheet, by the status's shared SEVERITY: solid green
 *  / amber / red, a red ✕ on a plain cell for Not started, grey for N/A. Colour
 *  is never the only signal — each cell also carries a mark and its status in
 *  the label. */
const CELL_FILL: Record<Severity, string> = {
  done: "bg-emerald-600 text-white",
  in_progress: "bg-amber-400 text-amber-950",
  blocked: "bg-red-600 text-white",
  not_started: "bg-background text-red-500",
  not_counted: "bg-muted text-muted-foreground",
};
const CELL_MARK: Record<Severity, string> = {
  done: "✓",
  in_progress: "•",
  blocked: "!",
  not_started: "✕",
  not_counted: "—",
};
const fillOf = (status: CheckStatus) => CELL_FILL[STATUS_SEVERITY[status] ?? "in_progress"];
const markOf = (status: CheckStatus) => CELL_MARK[STATUS_SEVERITY[status] ?? "in_progress"];

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

/** A check column's narrowest width; below the table's floor its wrapper
 *  scrolls sideways rather than squeezing the cells. */
const COLUMN_PX = 64;
const CHECK_TH = "min-w-[64px] normal-case tracking-normal";
/** The Wells column stays put while the sheet scrolls sideways — opaque, so
 *  the check columns slide under it. */
const PINNED = "sticky left-0 z-10 shadow-[1px_0_0_0_hsl(var(--border))]";

/** The cell whose quantity is being edited: a well's, or a field project's. */
interface QuantityTarget {
  target: ReadinessTarget;
  /** Names the target in the dialog. */
  name: string;
  check: CatalogCheck;
  /** The target's own number (a number a well only follows isn't). */
  own: number | null;
  /** The number a well repeats from its field project, if it follows one. */
  followed: number | null;
  writeKey: string;
}

/** The cell whose note is being edited: a well's, or a field project's. */
interface NoteTarget {
  target: ReadinessTarget;
  /** Names the target in the dialog ("OGBO ADTU-1", "Bonga (field project)"). */
  name: string;
  check: CatalogCheck;
  status: CheckStatus;
  /** The note that is the target's own (a note a well only follows isn't). */
  note: string;
  writeKey: string;
}

/**
 * One team's readiness in a campaign, laid out as the "Well Execution Readiness"
 * sheet — the ONE page design for every team (docs/well-execution-readiness-spec.md
 * Part B, docs/equipment-quantity-spec.md §2): one row per well, grouped by value
 * stream (the activity's Market) and field project, the spud month under its
 * year, and one solid coloured cell per check. The user shows 1 to 3 years at a
 * time; wells that spud outside them are hidden (and counted, so the list never
 * reads as everything).
 *
 * - A check enabled at well level: a cell per well. Each well follows its field
 *   project until it is given its own value (marked with a dot); a cell's menu
 *   sets the status, edits its note or resets the well to its project.
 * - A check enabled at project level only: ONE cell merged across the field
 *   project's wells — it is the project's value; a well with no field project
 *   shows it blank.
 * - Checks without a category are ordinary columns. Each category is ONE column
 *   — the worst of its selected types, read-only — that a click on its header
 *   unfolds into one column per type (remembered per browser).
 * - Checks that apply (spec §3.8): a team with a tick list has **Checks…** on
 *   each well and each field project. A check that is NOT SELECTED is a blank
 *   cell; one a row unticked is a dashed "Not applicable" cell. The well
 *   execution readiness checks have no tick list — they use N/A.
 * - The project cell's "Set for all wells" sets the field project's values,
 *   which every well without its own value follows.
 *
 * The API decides who may write; the page only mirrors it: campaign planners for
 * a planner-edited team (the well execution readiness checks), holders of the
 * team's grant for every other, admins for all.
 *
 * Rows and the summary follow spec §3.7: wells with readiness-required work
 * left, starting within the years shown; the summary adds up the server's
 * per-row figures of exactly the wells shown.
 */
export function ReadinessSheet({
  projectId,
  teamCode,
  canEditPlan = false,
}: {
  projectId: string;
  teamCode: string;
  /** Planner on this campaign (or admin): may edit a planner-edited team's
   *  checks. The API stays the authority. */
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
  // Which categories are unfolded — every one starts folded; remembered per
  // browser (spec §8.8).
  const [openCategories, toggleCategory] = useOpenCategories(teamCode);
  const [searchParams, setSearchParams] = useSearchParams();
  // The cell whose note is being edited, and the field project being set.
  const [noteFor, setNoteFor] = useState<NoteTarget | null>(null);
  const [quantityFor, setQuantityFor] = useState<QuantityTarget | null>(null);
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

  // Only the newest load may apply its data — a slow response from before a
  // later write can't overwrite the rows that write reloaded. `loadPending`:
  // the newest load hasn't settled yet.
  const loadSeq = useRef(0);
  const loadPending = useRef(false);
  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    loadPending.current = true;
    setLoading(true);
    setError(null);
    try {
      const next = await getTeamReadiness(projectId, teamCode, range);
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
  }, [projectId, teamCode, range]);

  // A write that settles after the years changed must reload the years shown
  // NOW, not the ones it started under — it calls the newest `load`.
  const latestLoad = useRef(load);
  latestLoad.current = load;
  useEffect(() => {
    load();
  }, [load]);

  const plannerEdited = data?.team.editor_source === "planner";
  const canEdit =
    !!user &&
    !!data &&
    (user.is_admin ||
      (data.team.editor_source === "team_grant" && (user.teams ?? []).includes(data.team.code)) ||
      (plannerEdited && canEditPlan));
  // The checks that lock with the plan — the well execution readiness checks —
  // have no tick list: one that doesn't apply is marked N/A (decision 31).
  const hasTickList = !!data?.checks.some((c) => !c.locks_with_plan);
  // A well has ticks of its own only for a check enabled at well level; a team
  // whose checks are all project-level ticks them on the field project.
  const hasWellTicks = !!data?.checks.some((c) => !c.locks_with_plan && c.applies_well);

  // A tick save answers with the target's new rows (a field project's plus its
  // wells', built as the read builds them): fold them in rather than reload.
  // A load still in flight may predate the save, so it can't land as it is —
  // but it can't just be dropped either: it may be the reload of a status
  // write, carrying that status. Supersede it with a fresh read, which has both.
  const applyTicks = useCallback((result: ApplicabilityResult) => {
    setData((prev) => (prev ? mergeApplicability(prev, result) : prev));
    if (loadPending.current) void latestLoad.current();
  }, []);

  // Write, then reload: a field project's value reaches every well following it.
  const write = useCallback(async (key: string, action: () => Promise<void>) => {
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
  }, []);

  const checks = useMemo(() => data?.checks ?? [], [data]);
  // Checks without a category are columns of their own; each category is one
  // folded column until its header unfolds it.
  const columns = useMemo(() => gridColumns(checks, openCategories), [checks, openCategories]);
  // Codes a folded cell's title words with their label ("PC (Personnel Carrier)").
  const lookAlikes = useMemo(() => lookAlikeCodes(checks.map((c) => c.code)), [checks]);
  const projectChecks = useMemo(() => checks.filter((c) => c.applies_project), [checks]);
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
  useEffect(
    () => setPageIndex(0),
    [search, stream, range, behindFocus, projectFilter, teamCode],
  );

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

  const teamName = data.team.name;
  // "Well Execution Readiness" for the built-in team, "<Team> Execution
  // Readiness" for every other (the lens label, `catalog.tsx::lensLabel`).
  const sheetName = `${data.team.code === PROJECTS_TEAM ? "Well" : teamName} Execution Readiness`;
  const filtering = Boolean(q) || Boolean(stream) || behindFocus || projectFilter !== null;
  const anyOpen = columns.some((c) => c.kind === "category" && c.open);
  const headRows = anyOpen ? 3 : 2;
  const th =
    "border border-border/70 bg-muted/40 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground";
  const td = "relative h-9 border border-border/70 p-0";

  /** One check's cell on a well row. A project-only check is drawn once per
   *  field project — merged across its wells — so only the group's first row
   *  returns a cell for it. */
  const checkCell = (row: TeamWellRow, i: number, c: CatalogCheck): ReactNode => {
    const wk = wellKey(row);
    if (!c.applies_well) {
      if (projectSpans[i] === 0) return null;
      const cell = row.well_project ? projectCells.get(row.well_project)?.[c.code] : undefined;
      const span = projectSpans[i];
      // No field project (or nothing selected there): nothing to show.
      if (!cell || notSelected(cell)) {
        return (
          <td key={c.code} rowSpan={span} className={td}>
            <BlankCell />
          </td>
        );
      }
      if (!applies(cell, c)) {
        return (
          <td key={c.code} rowSpan={span} className={td}>
            <NotApplicableCell />
          </td>
        );
      }
      const key = `p:${row.well_project}:${c.code}`;
      const target: ReadinessTarget = { scope: "project", well_project: row.well_project };
      const name = `${row.well_project} (field project)`;
      const note = cell.notes?.trim() || "";
      return (
        <td key={c.code} rowSpan={span} className={td}>
          <StatusCell
            check={c}
            subject={name}
            status={cell.status}
            note={note}
            origin="set on the field project — one value for its wells"
            quantity={quantityOf(cell, c)}
            editable={canEdit}
            busy={saving === key}
            onQuantity={
              c.takes_quantity
                ? () =>
                    setQuantityFor({
                      target,
                      name,
                      check: c,
                      own: ownQuantity(cell, "project"),
                      followed: null,
                      writeKey: key,
                    })
                : undefined
            }
            onStatus={(next) => {
              if (next !== cell.status) void write(key, () => setReadiness(projectId, c.code, target, next));
            }}
            onNote={() =>
              setNoteFor({ target, name, check: c, status: cell.status, note, writeKey: key })
            }
          />
        </td>
      );
    }

    const state = row.checks[c.code];
    // Not selected (starts unticked; neither this well nor its field project
    // nominated it): blank (spec §3.9).
    if (notSelected(state)) {
      return (
        <td key={c.code} className={td}>
          <BlankCell />
        </td>
      );
    }
    // A tick inherits like a status (§3.8): only a two-level check under a
    // field project has one to follow.
    const ownTick =
      c.applies_project && !!row.well_project && !c.locks_with_plan && state?.applies_source === "well";
    if (!applies(state, c)) {
      return (
        <td key={c.code} className={td}>
          <NotApplicableCell ownChoice={ownTick} />
        </td>
      );
    }
    const key = `${wk}:${c.code}`;
    const status = state?.status ?? defaultStatusOf(c.status_set);
    const own = state?.source === "well";
    return (
      <td key={c.code} className={td}>
        <StatusCell
          check={c}
          subject={row.well_name}
          status={status}
          note={state?.notes?.trim() || ""}
          own={own}
          ownTick={ownTick}
          origin={
            own ? "set on this well" : state?.source === "project" ? "from its field project" : "not set yet"
          }
          quantity={quantityOf(state, c)}
          quantityOwn={state?.quantity_source === "well"}
          onQuantity={
            c.takes_quantity
              ? () =>
                  setQuantityFor({
                    target: wellTarget(row),
                    name: row.well_name,
                    check: c,
                    own: ownQuantity(state, "well"),
                    followed: state?.quantity_source === "project" ? (state.quantity ?? null) : null,
                    writeKey: key,
                  })
              : undefined
          }
          editable={canEdit}
          busy={saving === key}
          onStatus={(next) => {
            // Picking the status already shown still makes it the well's own.
            if (next !== status || !own) {
              void write(key, () => setReadiness(projectId, c.code, wellTarget(row), next));
            }
          }}
          onReset={
            own && c.applies_project && !!row.well_project
              ? () => void write(key, () => resetWellReadiness(projectId, c.code, wellTarget(row)))
              : undefined
          }
          onNote={() =>
            setNoteFor({
              target: wellTarget(row),
              name: row.well_name,
              check: c,
              status,
              // A note the well follows from its field project isn't the
              // well's to edit: start empty, so saving gives the well its own.
              note: own ? (state?.notes ?? "") : "",
              writeKey: key,
            })
          }
        />
      </td>
    );
  };

  /** A row's cells for each column: a check's own cell, a folded category's
   *  read-only cell, or an unfolded category's type cells. */
  const rowCells = (row: TeamWellRow, i: number): ReactNode[] =>
    columns.flatMap((col): ReactNode[] => {
      if (col.kind === "check") return [checkCell(row, i, col.check)];
      if (col.open) return col.items.map((c) => checkCell(row, i, c));
      return [
        <td key={`category:${col.name}`} className={td}>
          <CategoryCell column={col} row={row} lookAlikes={lookAlikes} />
        </td>,
      ];
    });

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
          locked={plannerEdited && data.locked}
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
            {plannerEdited
              ? "View only — updating these checks needs planner rights on this campaign."
              : `View only — updating ${teamName} readiness needs the ${teamName} grant (Admin page).`}
          </p>
        )}

        {checks.length === 0 ? (
          <div className="flex h-40 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
            No {teamName} checks defined yet — an admin can add them on the Admin page.
          </div>
        ) : (
          <>
            {scoped.length > 0 && (
              <ReadinessSummary
                rows={rows.map((r) => r.figures)}
                unit={["well", "wells"]}
                scope={rangePhrase(range)}
                projectGates={!hasTickList}
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
                  className="w-full border-collapse text-sm"
                  style={{ minWidth: `${400 + years.length * 44 + columnSpan(columns) * COLUMN_PX}px` }}
                  aria-label={`${data.team.code === PROJECTS_TEAM ? "Well" : teamName} execution readiness`}
                  data-sheet=""
                >
                  <thead>
                    <tr>
                      <th rowSpan={headRows} className={cn(th, "w-[90px] min-w-[90px] text-left")}>
                        Value Stream
                      </th>
                      <th rowSpan={headRows} className={cn(th, "w-[130px] min-w-[130px] text-left")}>
                        Project
                      </th>
                      <th
                        rowSpan={headRows}
                        className={cn(th, "w-[180px] min-w-[180px] text-left", PINNED, "z-20 bg-muted")}
                        data-pinned=""
                      >
                        Wells
                      </th>
                      <th colSpan={years.length} className={th}>
                        Spud date
                      </th>
                      <th colSpan={columnSpan(columns)} className={th}>
                        {sheetName}
                      </th>
                    </tr>
                    <tr>
                      {years.map((y) => (
                        <th
                          key={y}
                          rowSpan={anyOpen ? 2 : undefined}
                          className={cn(th, "w-11 tabular-nums")}
                        >
                          {y}
                        </th>
                      ))}
                      {columns.map((col) =>
                        col.kind === "check" ? (
                          <th
                            key={col.check.code}
                            rowSpan={anyOpen ? 2 : undefined}
                            className={cn(th, CHECK_TH, "leading-tight")}
                            title={`${col.check.code} — ${col.check.label}`}
                          >
                            {col.check.label}
                          </th>
                        ) : (
                          <th
                            key={`category:${col.name}`}
                            rowSpan={anyOpen && !col.open ? 2 : undefined}
                            colSpan={col.open ? col.items.length : undefined}
                            className={cn(th, CHECK_TH)}
                          >
                            <CategoryHeader column={col} onToggle={() => toggleCategory(col.name)} />
                          </th>
                        ),
                      )}
                    </tr>
                    {anyOpen && (
                      <tr>
                        {columns.flatMap((col) =>
                          col.kind === "category" && col.open
                            ? col.items.map((c) => (
                                <th
                                  key={c.code}
                                  title={c.label}
                                  className={cn(th, CHECK_TH)}
                                >
                                  {c.code}
                                </th>
                              ))
                            : [],
                        )}
                      </tr>
                    )}
                  </thead>
                  <tbody>
                    {visible.map((row, i) => {
                      const wk = wellKey(row);
                      // The spud date shown is the one the row is listed by: when
                      // its work left starts, not an earlier completed activity's.
                      const spud = spudOf(row);
                      const month = MONTHS[Number(spud.slice(5, 7)) - 1];
                      const year = spud.slice(0, 4);
                      const project = row.well_project;
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
                                {project || <span className="text-muted-foreground">No field project</span>}
                              </div>
                              {canEdit && project && projectChecks.length > 0 && (
                                <button
                                  type="button"
                                  onClick={() => setProjectFor(project)}
                                  aria-label={`Set checks for all wells of ${project}`}
                                  className="mt-0.5 block text-[11px] font-medium text-primary hover:underline"
                                >
                                  Set for all wells
                                </button>
                              )}
                              {hasTickList && project && projectChecks.length > 0 && (
                                <ApplicabilityPicker
                                  range={range}
                                  projectId={projectId}
                                  team={data.team}
                                  checks={data.checks}
                                  target={{ scope: "project", well_project: project }}
                                  targetLabel={`${project} (field project)`}
                                  cells={projectCells.get(project)}
                                  canEdit={canEdit}
                                  wellsWithOwnChoice={wellsWithOwnChoice(
                                    data.well_rows,
                                    project,
                                    data.checks,
                                  )}
                                  onSaved={applyTicks}
                                  onQuantitySaved={() => latestLoad.current()}
                                  className="-ml-1.5 mt-0.5"
                                />
                              )}
                            </td>
                          )}
                          <td
                            className={cn(
                              "border border-border/70 px-2 py-1.5 [overflow-wrap:anywhere]",
                              PINNED,
                              "bg-card",
                            )}
                            data-pinned=""
                          >
                            <div className="flex items-center gap-1.5">
                              <span className="font-medium" data-testid="well-name">
                                {row.well_name}
                              </span>
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
                            <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                              <span>{row.activity_type}</span>
                            {hasWellTicks && (
                              <ApplicabilityPicker
                                range={range}
                                projectId={projectId}
                                team={data.team}
                                checks={data.checks}
                                target={wellTarget(row)}
                                targetLabel={`${row.well_name} · ${project || "No field project"} · ${row.activity_type}`}
                                cells={row.checks}
                                projectCells={projectCells.get(project)}
                                canEdit={canEdit}
                                onSaved={applyTicks}
                                onQuantitySaved={() => latestLoad.current()}
                                className="-ml-1.5"
                              />
                            )}
                            </div>
                          </td>
                          {years.map((y) => (
                            <td
                              key={y}
                              className="border border-border/70 px-1 py-1.5 text-center text-xs font-semibold tabular-nums"
                            >
                              {y === year ? month : ""}
                            </td>
                          ))}
                          {rowCells(row, i)}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {rows.length > 0 && (
              <>
                <Legend
                  statuses={legendStatuses(checks)}
                  tickList={hasTickList}
                  categories={columns.some((c) => c.kind === "category")}
                  projectOnly={checks.some((c) => !c.applies_well)}
                  quantity={checks.some((c) => c.takes_quantity)}
                />
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
          </>
        )}

        {noteFor && (
          <NoteDialog
            note={noteFor}
            onClose={() => setNoteFor(null)}
            onSave={async (text) => {
              const { target, check, status, writeKey } = noteFor;
              const ok = await write(writeKey, () =>
                setReadiness(projectId, check.code, target, status, text),
              );
              if (ok) setNoteFor(null);
            }}
          />
        )}

        {quantityFor && (
          <QuantityDialog
            quantity={quantityFor}
            onClose={() => setQuantityFor(null)}
            onSave={async (value) => {
              const { target, check, writeKey } = quantityFor;
              const ok = await write(writeKey, () => setQuantity(projectId, check.code, target, value));
              if (ok) setQuantityFor(null);
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
                  {hasTickList && " A check that isn't selected for this field project isn't listed — select it with Checks…."}
                </DialogDescription>
              </DialogHeader>
              <ul
                className="max-h-[60vh] divide-y divide-border/60 overflow-y-auto"
                aria-label={`Checks of ${projectFor}`}
              >
                {projectChecks.map((c) => {
                  const cell = projectCells.get(projectFor)?.[c.code];
                  if (notSelected(cell)) return null;
                  const key = `p:${projectFor}:${c.code}`;
                  const status = cell?.status ?? defaultStatusOf(c.status_set);
                  const counted = applies(cell, c);
                  return (
                    <li key={c.code} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                      <span>
                        <span className="font-mono text-xs font-semibold">{c.code}</span>{" "}
                        <span className="text-muted-foreground">{c.label}</span>
                        {c.category && (
                          <span className="text-xs text-muted-foreground/70"> · {c.category}</span>
                        )}
                      </span>
                      {counted ? (
                        <span className="flex items-center gap-2 text-xs text-muted-foreground">
                          {c.takes_quantity && (
                            <QuantityField
                              key={`${c.code}:${ownQuantity(cell, "project") ?? ""}`}
                              label={`How many ${c.code} for ${projectFor}`}
                              value={ownQuantity(cell, "project")}
                              disabled={saving === key}
                              onCommit={(value) =>
                                write(key, () =>
                                  setQuantity(
                                    projectId,
                                    c.code,
                                    { scope: "project", well_project: projectFor },
                                    value,
                                  ),
                                )
                              }
                            />
                          )}
                          {sheetLabel(status)}
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
                      ) : (
                        <span className="text-xs text-muted-foreground">{NOT_APPLICABLE}</span>
                      )}
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
  children: ReactNode;
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

/** A category's header: its name and how many types it holds; a click unfolds
 *  it into one column per type, or folds it back. */
function CategoryHeader({
  column,
  onToggle,
}: {
  column: Extract<GridColumn, { kind: "category" }>;
  onToggle: () => void;
}) {
  const { name, items, open } = column;
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-label={`${open ? "Fold" : "Unfold"} ${name}`}
      title={categoryTitle(name, items)}
      onClick={onToggle}
      className="inline-flex max-w-full items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-semibold leading-tight text-muted-foreground hover:bg-accent/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {open ? <ChevronLeft className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
      <span>{name}</span>
      {!open && <span className="font-normal tabular-nums">({items.length})</span>}
    </button>
  );
}

/** A check that is NOT SELECTED for a target (spec §3.9), or one the target
 *  doesn't carry at all: an empty cell. */
function BlankCell() {
  return <span aria-hidden className="absolute inset-0" data-not-selected="" />;
}

/** A check a row unticked for the target (spec §3.8): a dashed cell, no status
 *  to set — the status kept underneath is never shown. */
function NotApplicableCell({ ownChoice = false }: { ownChoice?: boolean }) {
  const title = ownChoice ? `${NOT_APPLICABLE} — set on this well` : NOT_APPLICABLE;
  return (
    <span
      className="absolute inset-1 flex items-center justify-center rounded-sm border border-dashed border-muted-foreground/40 text-xs text-muted-foreground/60"
      title={title}
      data-not-applicable=""
    >
      <span aria-hidden>—</span>
      <span className="sr-only">{title}</span>
      {ownChoice && <OwnTickMark />}
    </span>
  );
}

/** Marks a well's own choice about whether a two-level check applies (spec
 *  §3.8: "set on this well" wherever one exists). */
function OwnTickMark() {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute right-1 top-1 h-1.5 w-1.5 rounded-full ring-1 ring-current"
      data-own-tick=""
    />
  );
}

/** A folded category on one well: the worst status of its types that apply,
 *  its title naming them worst first ("Vessels (2): PSV Behind · DSV On
 *  Track"); blank when none applies. Read-only — it opens nothing. */
function CategoryCell({
  column,
  row,
  lookAlikes,
}: {
  column: Extract<GridColumn, { kind: "category" }>;
  row: TeamWellRow;
  lookAlikes: ReadonlySet<string>;
}) {
  const cell = categoryCell(column.items, row.checks);
  if (!cell) return <BlankCell />;
  // How many are needed across the types selected here ("Vessels · 3") — this
  // row's types added up, never wells.
  const total = categoryQuantity(column.items, row.checks);
  const title =
    categoryLine(column.name, cell.types, (t) => codeWithLabel(t, lookAlikes)) +
    (total !== null ? ` — ${total} needed` : "");
  return (
    <div
      className={cn("absolute inset-0 flex items-center justify-center", fillOf(cell.status))}
      role="img"
      title={title}
      aria-label={title}
      data-category={column.name}
      data-status={cell.status}
    >
      <span aria-hidden className="text-sm font-bold leading-none">
        {markOf(cell.status)}
      </span>
      {total !== null && <QuantityMark quantity={total} />}
    </div>
  );
}

/** One check for one target: a solid cell in its status's colour with a mark,
 *  its note, and a dot when the value is the well's own. Editable → a menu. */
function StatusCell({
  check,
  subject,
  status,
  note,
  own = false,
  ownTick = false,
  origin,
  quantity = null,
  quantityOwn = false,
  editable,
  busy,
  onStatus,
  onReset,
  onNote,
  onQuantity,
}: {
  check: CatalogCheck;
  /** Who the cell is for: a well's name, or "<project> (field project)". */
  subject: string;
  status: CheckStatus;
  note: string;
  /** The value is the well's own (not followed from its field project). */
  own?: boolean;
  /** Whether the check applies is the well's own choice. */
  ownTick?: boolean;
  /** Where the value comes from, for the title. */
  origin: string;
  /** How many are needed, where stated (a check that takes a quantity). */
  quantity?: number | null;
  /** The number is the well's own (not its field project's). */
  quantityOwn?: boolean;
  editable: boolean;
  busy: boolean;
  onStatus: (next: CheckStatus) => void;
  /** Reset the well to its field project — only where there is one to follow. */
  onReset?: () => void;
  onNote: () => void;
  /** Open the quantity editor — only for a check that takes a quantity. */
  onQuantity?: () => void;
}) {
  const label = sheetLabel(status);
  const title = [
    `${check.label} for ${subject}: ${label}`,
    origin,
    ownTick ? "applies — set on this well" : "",
    quantity !== null ? `${quantity} needed${quantityOwn ? " (set on this well)" : ""}` : "",
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
      {ownTick && <OwnTickMark />}
      {note ? (
        <span className="block max-w-full truncate px-1.5 text-[11px] font-medium leading-none">
          {note}
        </span>
      ) : (
        <span aria-hidden className="text-sm font-bold leading-none">
          {markOf(status)}
        </span>
      )}
      {quantity !== null && <QuantityMark quantity={quantity} />}
    </>
  );
  const cellClass = cn("absolute inset-0 flex items-center justify-center", fillOf(status));
  const statuses = pickableStatuses(check);
  // A history-only set offers nothing to pick: the cell is read-only.
  if (!editable || statuses.length === 0) {
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
          {check.label} · {subject}
        </div>
        <DropdownMenuSeparator />
        {statuses.map((s) => (
          <DropdownMenuItem
            key={s}
            onClick={() => onStatus(s)}
            className={cn("gap-2.5 py-2", s === status && "bg-accent/50")}
          >
            <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", STATUS_DOT[s])} />
            <span className="flex-1">{sheetLabel(s)}</span>
            {s === status && <Check className="h-3.5 w-3.5 text-muted-foreground" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onNote} className="gap-2.5 py-2">
          <MessageSquareText className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="flex-1">{note ? "Edit note…" : "Add note…"}</span>
        </DropdownMenuItem>
        {onQuantity && (
          <DropdownMenuItem onClick={onQuantity} className="gap-2.5 py-2">
            <Hash className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="flex-1">
              {quantity !== null ? `Quantity (${quantityLabel(quantity)})…` : "Set quantity…"}
            </span>
          </DropdownMenuItem>
        )}
        {onReset && (
          <DropdownMenuItem onClick={onReset} className="gap-2.5 py-2">
            <RotateCcw className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="flex-1">Reset to project</span>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** "×2" in a cell's corner: how many are needed. */
function QuantityMark({ quantity }: { quantity: number }) {
  return (
    <span
      aria-hidden
      className="absolute bottom-0.5 right-1 text-[10px] font-semibold leading-none tabular-nums"
      data-quantity={quantity}
    >
      {quantityLabel(quantity)}
    </span>
  );
}

/** A small number field that saves when left (or on Enter): a whole number
 *  1–999, or empty for none stated. Used where a field project's values are
 *  set. Remount it (``key``) when the stored value changes. */
function QuantityField({
  label,
  value,
  disabled,
  onCommit,
}: {
  label: string;
  value: number | null;
  disabled: boolean;
  onCommit: (value: number | null) => void;
}) {
  const [text, setText] = useState(String(value ?? ""));
  const parsed = parseQuantity(text);
  const commit = () => {
    if (parsed === "invalid") {
      toast.error(`A quantity is a whole number from ${MIN_QUANTITY} to ${MAX_QUANTITY}.`);
      setText(String(value ?? ""));
    } else if (parsed !== value) {
      onCommit(parsed);
    }
  };
  return (
    <input
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      maxLength={3}
      aria-label={label}
      title="How many are needed for the whole field project — leave empty for none stated"
      placeholder="Qty"
      value={text}
      disabled={disabled}
      aria-invalid={parsed === "invalid"}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
      className="h-6 w-12 rounded border border-input bg-background px-1 text-center text-xs tabular-nums text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
    />
  );
}

/** How many of one type a target needs: a whole number, or none. */
function QuantityDialog({
  quantity,
  onClose,
  onSave,
}: {
  quantity: QuantityTarget;
  onClose: () => void;
  onSave: (value: number | null) => Promise<void>;
}) {
  const { check, name, own, followed, target } = quantity;
  const [text, setText] = useState(String(own ?? ""));
  const [busy, setBusy] = useState(false);
  const parsed = parseQuantity(text);
  const forWell = target.scope === "well";
  const follows = forWell && !!target.well_project;
  const save = async (value: number | null) => {
    setBusy(true);
    await onSave(value);
    setBusy(false);
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>
            Quantity — {check.label} · {name}
          </DialogTitle>
          <DialogDescription>
            {forWell
              ? follows
                ? `How many ${name} needs. Leave it empty to follow its field project${followed !== null ? ` (${quantityLabel(followed)})` : ""}.`
                : `How many ${name} needs. Leave it empty for none stated.`
              : "How many the whole field project needs. Its wells show this number unless a well has its own; wells are not added together."}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (parsed !== "invalid") void save(parsed);
          }}
          className="space-y-3"
        >
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={3}
            autoFocus
            aria-label="Quantity"
            aria-invalid={parsed === "invalid"}
            placeholder={followed !== null ? String(followed) : "None stated"}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="h-9 w-28 rounded-md border border-input bg-background/60 px-3 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-ring"
          />
          {parsed === "invalid" && (
            <p className="text-xs text-red-500" role="alert">
              A whole number from {MIN_QUANTITY} to {MAX_QUANTITY} — or leave it empty.
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || parsed === "invalid" || parsed === own}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The short text a cell carries ("10k"), saved with the target's own value. */
function NoteDialog({
  note,
  onClose,
  onSave,
}: {
  note: NoteTarget;
  onClose: () => void;
  onSave: (note: string | null) => Promise<void>;
}) {
  const [text, setText] = useState(note.note);
  const [busy, setBusy] = useState(false);
  const forWell = note.target.scope === "well";
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Note — {note.check.label} · {note.name}
          </DialogTitle>
          <DialogDescription>
            {forWell
              ? `Shown in the cell. Saving makes this check ${note.name}'s own value.`
              : "Shown in the cell, for every well of this field project."}
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

/** The key under the table, as on the sheet: the statuses the team's checks can
 *  show, and what the other cells mean. */
function Legend({
  statuses,
  tickList,
  categories,
  projectOnly,
  quantity,
}: {
  statuses: readonly CheckStatus[];
  /** The team has a tick list: blank and dashed cells exist. */
  tickList: boolean;
  /** The team has categories: a folded column shows the worst of its types. */
  categories: boolean;
  /** The team has checks set on the field project only: merged cells. */
  projectOnly: boolean;
  /** The team has checks that take a quantity: "×2" in a cell. */
  quantity: boolean;
}) {
  const shown = [
    ...LEGEND_ORDER.filter((s) => statuses.includes(s)),
    ...statuses.filter((s) => !LEGEND_ORDER.includes(s)),
  ];
  const swatch = "flex h-4 w-7 items-center justify-center rounded-sm border border-border/70 text-[10px] font-bold";
  return (
    <div
      className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-border/70 bg-card px-3 py-2 text-xs"
      aria-label="Key"
    >
      {shown.map((s) => (
        <span key={s} className="flex items-center gap-1.5">
          <span aria-hidden className={cn(swatch, fillOf(s))}>
            {markOf(s)}
          </span>
          {sheetLabel(s)}
        </span>
      ))}
      {tickList && (
        <>
          <span className="flex items-center gap-1.5">
            <span
              aria-hidden
              className={cn(swatch, "border-dashed border-muted-foreground/40 font-normal text-muted-foreground/60")}
            >
              —
            </span>
            {NOT_APPLICABLE}
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden className={swatch} />
            Not selected
          </span>
        </>
      )}
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-foreground/70" />
        set on this well (otherwise it follows its field project)
      </span>
      {quantity && (
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <span aria-hidden className="text-[10px] font-semibold tabular-nums text-foreground/80">
            ×2
          </span>
          how many are needed (a group shows its total)
        </span>
      )}
      {categories && (
        <span className="text-muted-foreground">
          A group shows the worst of its selected types — click its heading to see each one.
        </span>
      )}
      {projectOnly && (
        <span className="text-muted-foreground">
          A cell spanning a field project&apos;s wells is set once, for the field project.
        </span>
      )}
    </div>
  );
}
