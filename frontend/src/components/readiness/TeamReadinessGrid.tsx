import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, Lock, RefreshCw } from "lucide-react";
import {
  getTeamReadiness,
  resetWellReadiness,
  setReadiness,
  type ApplicabilityResult,
  type CatalogCheck,
  type ReadinessTarget,
  type TeamCheckState,
  type TeamReadiness,
  type TeamWellRow,
} from "@/api/readiness";
import { Button } from "@/components/ui/button";
import { PaginationFooter } from "@/components/ui/pagination-footer";
import { SearchInput } from "@/components/ui/search-input";
import { toast } from "@/components/ui/toaster";
import { useAuthStore } from "@/store/auth";
import { cn, formatDate } from "@/lib/utils";
import { inWindow } from "@/lib/readiness-window";
import { mergeApplicability, wellsWithOwnChoice } from "@/lib/readiness-applicability";
import { ApplicabilityPicker } from "./ApplicabilityPicker";
import { ReadinessDot } from "./ReadinessDot";
import { FrozenCatalogProvider } from "./catalog";
import {
  NOT_APPLICABLE,
  STATUS_DOT,
  applies,
  defaultStatusOf,
  legendStatuses,
  pickableStatuses,
} from "./check-meta";
import { checkIcon } from "./icon-registry";
import { ReadinessSummary } from "./ReadinessSummary";
import { ReadinessWindowSelect, useReadinessWindow } from "./ReadinessWindow";


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

function CheckHeader({ check }: { check: CatalogCheck }) {
  const Icon = checkIcon(check.icon_key);
  return (
    <th
      className="px-1 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
      title={check.label}
    >
      <div className="flex items-center justify-center gap-1.5 text-foreground/80">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={2} />
        <span>{check.code}</span>
      </div>
    </th>
  );
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
  // The dots read labels/icons from the definitions this response carries — the
  // server's view of the team's checks, consistent with the rows.
  return (
    <FrozenCatalogProvider checks={data.checks}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border/70 bg-card/60 px-4 py-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2" data-testid="team-status-key">
            {legendStatuses(data.checks).map((s) => (
              <span key={s} className="flex items-center gap-1.5 text-xs text-foreground">
                <span className={cn("h-2.5 w-2.5 rounded-full", STATUS_DOT[s])} />
                {s}
              </span>
            ))}
            <span className="flex items-center gap-1.5 text-xs text-foreground">
              <span className="text-muted-foreground/60">—</span>
              {NOT_APPLICABLE}
            </span>
          </div>
          <div className="hidden h-4 w-px bg-border/70 md:block" />
          <div className="flex flex-1 flex-wrap gap-x-5 gap-y-2">
            {data.checks.map((c) => {
              const Icon = checkIcon(c.icon_key);
              return (
                <span key={c.code} className="flex items-center gap-1.5 whitespace-nowrap text-xs">
                  <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={2} />
                  <span className="font-medium">{c.code}</span>
                  <span className="text-muted-foreground">{c.label}</span>
                </span>
              );
            })}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <ReadinessWindowSelect
              value={months}
              onChange={setMonths}
              allLabel={hasWellChecks ? "All wells" : "All field projects"}
            />
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Search well or project…"
              ariaLabel="Search wells and field projects"
            />
            <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </Button>
          </div>
        </div>

        {behindFocus && (
          <div className="flex items-center justify-between rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
            <span>
              Showing only {hasWellChecks ? "wells" : "field projects"} with a check behind
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
            {/* The three figures over exactly the targets shown (spec §3.7). */}
            <ReadinessSummary
              rows={(hasWellChecks ? wells : projects).map((r) => r.figures)}
              unit={hasWellChecks ? ["well", "wells"] : ["field project", "field projects"]}
              windowMonths={months}
              projectGates={false}
            />
            {projectChecks.length > 0 && (
              <section aria-label="Field projects" className="space-y-2">
                <h3 className="text-sm font-semibold">Field projects</h3>
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
                  <div className="overflow-x-auto rounded-xl border border-border/70 bg-card shadow-soft-sm">
                    <table className="w-full min-w-[640px] border-collapse text-sm">
                      <thead>
                        <tr className="border-b border-border/70 bg-muted/30">
                          <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                            Field Project
                          </th>
                          {projectChecks.map((c) => (
                            <CheckHeader key={c.code} check={c} />
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {projects.map((row) => (
                          <tr key={row.well_project} className="border-b border-border/40">
                            <td className="px-3 py-2">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="font-medium">{row.well_project}</div>
                                  <div className="text-xs text-muted-foreground">
                                    {row.activity_count}{" "}
                                    {row.activity_count === 1 ? "activity" : "activities"}
                                    {hasWellChecks &&
                                      " · applies to its wells unless a well has its own choice"}
                                  </div>
                                </div>
                                <ApplicabilityPicker
                                  projectId={projectId}
                                  team={data.team}
                                  checks={data.checks}
                                  target={{ scope: "project", well_project: row.well_project }}
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
                            </td>
                            {projectChecks.map((c) => {
                              const key = `p:${row.well_project}:${c.code}`;
                              const target: ReadinessTarget = {
                                scope: "project",
                                well_project: row.well_project,
                              };
                              const current: TeamCheckState | undefined = row.checks[c.code];
                              // Unticked (or carried nowhere): "—", no status to set.
                              if (!applies(current, c)) {
                                return (
                                  <td key={c.code} className="px-1 py-2 text-center">
                                    <div className="flex justify-center">
                                      <NotApplicableCell />
                                    </div>
                                  </td>
                                );
                              }
                              const status = current?.status ?? defaultStatusOf(c.status_set);
                              const disabled = !canEdit || saving === key || frozen(c);
                              return (
                                <td key={c.code} className="px-1 py-2 text-center">
                                  <div className="flex justify-center">
                                    <ReadinessDot
                                      code={c.code}
                                      status={status}
                                      disabled={disabled}
                                      statuses={pickableStatuses(c)}
                                      onChange={(next) =>
                                        write(key, () => setReadiness(projectId, c.code, target, next))
                                      }
                                    />
                                  </div>
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
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
                  <div className="overflow-x-auto rounded-xl border border-border/70 bg-card shadow-soft-sm">
                    <table className="w-full min-w-[640px] border-collapse text-sm">
                      <thead>
                        <tr className="border-b border-border/70 bg-muted/30">
                          <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                            Well
                          </th>
                          {data.checks.map((c) => (
                            <CheckHeader key={c.code} check={c} />
                          ))}
                        </tr>
                      </thead>
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
                          return (
                            <tr key={wk} className="border-b border-border/40">
                              <td className="px-3 py-2">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-1.5 font-medium">
                                      {row.well_name}
                                      {row.activity_count > 1 && (
                                        <span
                                          className="inline-flex items-center gap-0.5 rounded bg-amber-500/15 px-1 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400"
                                          title={`${row.activity_count} activities share this field project, well and activity type, so they share this readiness`}
                                        >
                                          <AlertTriangle className="h-3 w-3" />
                                          {row.activity_count} share
                                        </span>
                                      )}
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                      {row.well_project || "No field project"} · {row.activity_type} ·{" "}
                                      {formatDate(row.start_date)}
                                    </div>
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
                              </td>
                              {data.checks.map((c) => {
                                const state = row.checks[c.code];
                                const key = `w:${wk}:${c.code}`;
                                // A tick inherits like a status (§3.8): only a two-level
                                // check under a field project has one to follow.
                                const inheritsTick = c.applies_project && c.applies_well && !!row.well_project;
                                const ownTick = inheritsTick && state?.applies_source === "well";
                                // Unticked, or carried nowhere (a project-only check on a
                                // well with no field project): "—", no status to set.
                                if (!applies(state, c)) {
                                  return (
                                    <td key={c.code} className="px-1 py-2 text-center">
                                      <div className="flex justify-center">
                                        <NotApplicableCell ownChoice={ownTick} />
                                      </div>
                                    </td>
                                  );
                                }
                                const status = state?.status ?? defaultStatusOf(c.status_set);
                                // Project-only checks are set on the field-project row.
                                if (!c.applies_well) {
                                  return (
                                    <td key={c.code} className="px-1 py-2 text-center">
                                      <div className="flex justify-center">
                                        <ReadinessDot code={c.code} status={status} inherited />
                                      </div>
                                    </td>
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
                                return (
                                  <td key={c.code} className="px-1 py-2 text-center">
                                    <div className="flex justify-center">
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
                                              ? () =>
                                                  write(key, () =>
                                                    resetWellReadiness(projectId, c.code, target),
                                                  )
                                              : undefined
                                          }
                                        />
                                        {ownTick && <OwnChoiceMark />}
                                      </div>
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
