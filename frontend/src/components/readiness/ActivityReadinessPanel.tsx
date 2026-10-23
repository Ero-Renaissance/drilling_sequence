import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Lock, Pencil, RefreshCw } from "lucide-react";
import type { Activity } from "@/api/activities";
import {
  getTeamReadiness,
  listReadiness,
  resetWellReadiness,
  setReadiness,
  type CatalogCheck,
  type CatalogTeam,
  type CheckSource,
  type CheckState,
  type CheckStatus,
  type ProjectReadiness,
  type ReadinessTarget,
  type TeamCheckState,
  type TeamReadiness,
} from "@/api/readiness";
import { Button } from "@/components/ui/button";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/toaster";
import { useAuthStore } from "@/store/auth";
import { formatDate } from "@/lib/utils";
import { ApplicabilityPicker } from "./ApplicabilityPicker";
import { ReadinessDot } from "./ReadinessDot";
import { PROJECTS_TEAM, lensLabel, useProjectGates, useReadinessTeams } from "./catalog";
import {
  NOTHING_APPLIES,
  NOT_APPLICABLE,
  applies,
  defaultStatusOf,
  pickableStatuses,
} from "./check-meta";
import { checkIcon } from "./icon-registry";

/** A cell as this panel holds it: a Project gate's (status only) or a team's
 *  (with `applies`, and `source` on a well). */
type Cell = CheckState & { applies?: boolean; applies_source?: CheckSource; source?: CheckSource };

interface TeamView {
  team: CatalogTeam;
  checks: CatalogCheck[];
  well?: Record<string, Cell>;
  project?: Record<string, Cell>;
}

/**
 * Every team's readiness for ONE activity — opened from its bar on the Sequence
 * chart (through a team lens) or its row in the Activities grid. One section per
 * team (Project gates, Wells, Logistics…); everyone sees every section, each is
 * editable only by that team's editors (planners for the project gates, grant
 * holders for their team, admins for all) — the API stays the authority.
 *
 * Two columns make inheritance visible: "This well" (faded while it follows the
 * project; "Reset to project" drops an override) and "Field project" (applies to
 * every well in it). Project gates freeze with the plan; team checks stay live.
 *
 * Checks that apply (spec §3.8, §8.7): each team section other than the
 * Project gates has a **Checks…** control — it edits this well for a team with
 * well-level checks (project-level ticks read-only), else the field project.
 * The checks that don't apply here are listed under a folded "Not applicable
 * (N)". The Project gates section is unchanged: N/A stays in their menus.
 */
export function ActivityReadinessPanel({
  projectId,
  activity,
  canEditProjectGates,
  focusTeam = null,
  open,
  onOpenChange,
  onChanged,
  onEditActivity,
}: {
  projectId: string;
  activity: Activity;
  /** Planner on this campaign (or admin) — may edit the project gates. */
  canEditProjectGates: boolean;
  /** Open with only this team's section unfolded; null → all unfolded. */
  focusTeam?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** After any change, so the chart / grid can refresh their readiness. */
  onChanged?: () => void;
  /** Jump to the activity's details dialog. */
  onEditActivity?: () => void;
}) {
  const user = useAuthStore((s) => s.user);
  const teams = useReadinessTeams();
  const projectGates = useProjectGates();
  const [views, setViews] = useState<TeamView[] | null>(null);
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const wp = activity.well_project ?? "";
  const wellKey = activity.well_name
    ? { well_project: wp, well_name: activity.well_name, activity_type: activity.activity_type }
    : null;

  const load = useCallback(async () => {
    setError(null);
    try {
      const others = teams.filter((t) => t.code !== PROJECTS_TEAM);
      const [gates, ...perTeam] = await Promise.all([
        listReadiness(projectId),
        ...others.map((t) => getTeamReadiness(projectId, t.code)),
      ]);
      const gateRow: ProjectReadiness | undefined = gates.find((r) => r.well_project === wp);
      const next: TeamView[] = teams.map((team) => {
        if (team.code === PROJECTS_TEAM) {
          return { team, checks: projectGates, project: gateRow?.checks };
        }
        const data: TeamReadiness | undefined = perTeam.find((d) => d.team.code === team.code);
        return {
          team,
          checks: data?.checks ?? [],
          well: wellKey
            ? data?.well_rows.find(
                (r) =>
                  r.well_project === wellKey.well_project &&
                  r.well_name === wellKey.well_name &&
                  r.activity_type === wellKey.activity_type,
              )?.checks
            : undefined,
          project: wp ? data?.project_rows.find((r) => r.well_project === wp)?.checks : undefined,
        };
      });
      setViews(next);
      setLocked(!!gateRow?.locked || perTeam.some((d) => d.locked));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load readiness");
    }
    // wellKey is rebuilt from these activity fields, so they key the callback.
  }, [projectId, teams, projectGates, wp, activity.well_name, activity.activity_type]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const canEdit = (team: CatalogTeam) =>
    !!user &&
    (user.is_admin ||
      (team.editor_source === "planner"
        ? canEditProjectGates
        : (user.teams ?? []).includes(team.code)));

  async function write(key: string, action: () => Promise<void>) {
    setSaving(key);
    try {
      await action();
      await load();
      onChanged?.();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to save readiness");
    } finally {
      setSaving(null);
    }
  }

  const optedOut = activity.readiness_required === false;
  const subtitle = [
    activity.activity_type,
    activity.well_project || "No field project",
    `${formatDate(activity.start_date)} – ${formatDate(activity.end_date)}`,
  ].join(" · ");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{activity.well_name ?? activity.activity_type} — Readiness</DialogTitle>
          <DialogDescription>{subtitle}</DialogDescription>
        </DialogHeader>

        {optedOut ? (
          <p className="rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
            Readiness is switched off for this activity, so no team tracks it. A planner can switch
            it back on in the activity&apos;s details.
          </p>
        ) : error ? (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600" role="alert">
            {error}
          </p>
        ) : !views ? (
          <div className="flex h-32 items-center justify-center text-muted-foreground">
            <RefreshCw className="mr-2 h-5 w-5 animate-spin" />
            Loading readiness…
          </div>
        ) : (
          <div className="space-y-3">
            {views.map(({ team, checks, well, project }) => {
              const editable = canEdit(team);
              const showWell = !!wellKey && checks.some((c) => c.applies_well);
              const showProject = !!wp && checks.some((c) => c.applies_project);
              const gates = team.code === PROJECTS_TEAM;
              // What Checks… edits: this well for a team with well-level checks,
              // else the field project; nothing without either.
              const tickTarget: ReadinessTarget | null = gates
                ? null
                : showWell && wellKey
                  ? { scope: "well", ...wellKey }
                  : showProject
                    ? { scope: "project", well_project: wp }
                    : null;
              // The cells that say whether a check applies to THIS activity.
              const decider = tickTarget?.scope === "well" ? well : project;
              const notApplicable = gates
                ? []
                : checks.filter((c) => {
                    const cell = decider?.[c.code];
                    return cell !== undefined && !applies(cell, c);
                  });
              const shown = checks.filter((c) => !notApplicable.includes(c));
              return (
                <CollapsibleSection
                  key={team.code}
                  title={lensLabel(team)}
                  icon={checkIcon(team.icon_key)}
                  defaultOpen={focusTeam === null || focusTeam === team.code}
                  count={editable ? "You can edit" : "View only"}
                  actions={
                    tickTarget && (
                      <ApplicabilityPicker
                        projectId={projectId}
                        team={team}
                        checks={checks}
                        target={tickTarget}
                        targetLabel={
                          tickTarget.scope === "well"
                            ? `${tickTarget.well_name} · ${wp || "No field project"} · ${tickTarget.activity_type}`
                            : `${wp} (field project)`
                        }
                        cells={(tickTarget.scope === "well" ? well : project) as Record<string, TeamCheckState> | undefined}
                        projectCells={project as Record<string, TeamCheckState> | undefined}
                        canEdit={editable}
                        onSaved={async () => {
                          await load();
                          onChanged?.();
                        }}
                      />
                    )
                  }
                >
                  {checks.length === 0 ? (
                    <p className="px-4 py-3 text-xs text-muted-foreground">No checks defined yet.</p>
                  ) : !showWell && !showProject ? (
                    <p className="px-4 py-3 text-xs text-muted-foreground">
                      {wp
                        ? "These checks are set per well — this activity has no well name."
                        : "Set a Project for this well to track these checks."}
                    </p>
                  ) : shown.length === 0 ? (
                    <p className="px-4 py-3 text-xs text-muted-foreground">
                      {NOTHING_APPLIES} — none of the {team.name} checks applies here.
                    </p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                          <th className="px-4 py-1.5 font-semibold">Check</th>
                          {showWell && <th className="px-2 py-1.5 text-center font-semibold">This well</th>}
                          {showProject && (
                            <th className="px-2 py-1.5 text-center font-semibold">Field project</th>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {shown.map((c) => {
                          const Icon = checkIcon(c.icon_key);
                          const frozen = locked && c.locks_with_plan;
                          // Team views offer the check's pickable statuses — never
                          // N/A (untick it instead); the Project gates keep N/A.
                          const statuses = pickableStatuses(c);
                          return (
                            <tr key={c.code} className="border-t border-border/40">
                              <td className="px-4 py-1.5">
                                <div className="flex items-center gap-2">
                                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                                  <span className="font-mono text-xs font-semibold">{c.code}</span>
                                  <span className="truncate text-muted-foreground">{c.label}</span>
                                  {frozen && (
                                    <span title="Frozen with the plan while a revision is pending or approved">
                                      <Lock className="h-3 w-3 text-muted-foreground" />
                                    </span>
                                  )}
                                </div>
                              </td>
                              {showWell && (
                                <td className="px-2 py-1.5 text-center">
                                  {c.applies_well && wellKey ? (
                                    <CheckCell
                                      check={c}
                                      state={well?.[c.code]}
                                      statuses={statuses}
                                      disabled={!editable || frozen || saving === `w:${c.code}`}
                                      inherited={
                                        // Faded only while it reads the field project's
                                        // status — a well ticked under an unticked
                                        // project reads the default (§3.8).
                                        well?.[c.code]?.source !== "well" &&
                                        c.applies_project &&
                                        !!wp &&
                                        project?.[c.code]?.applies !== false
                                      }
                                      onSave={(status) =>
                                        write(`w:${c.code}`, () =>
                                          setReadiness(projectId, c.code, { scope: "well", ...wellKey }, status),
                                        )
                                      }
                                      onReset={
                                        c.applies_project && well?.[c.code]?.source === "well"
                                          ? () =>
                                              write(`w:${c.code}`, () =>
                                                resetWellReadiness(projectId, c.code, { scope: "well", ...wellKey }),
                                              )
                                          : undefined
                                      }
                                    />
                                  ) : (
                                    <span className="text-xs text-muted-foreground/50">—</span>
                                  )}
                                </td>
                              )}
                              {showProject && (
                                <td className="px-2 py-1.5 text-center">
                                  {c.applies_project && wp && !gates && project?.[c.code] && !applies(project[c.code], c) ? (
                                    // This well applies, its field project doesn't.
                                    <span className="text-xs text-muted-foreground/50" title={NOT_APPLICABLE}>
                                      —
                                    </span>
                                  ) : c.applies_project && wp ? (
                                    <CheckCell
                                      check={c}
                                      state={project?.[c.code]}
                                      statuses={statuses}
                                      disabled={!editable || frozen || saving === `p:${c.code}`}
                                      inherited={false}
                                      onSave={(status) =>
                                        write(`p:${c.code}`, () =>
                                          setReadiness(projectId, c.code, { scope: "project", well_project: wp }, status),
                                        )
                                      }
                                    />
                                  ) : (
                                    <span className="text-xs text-muted-foreground/50">—</span>
                                  )}
                                </td>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                  {notApplicable.length > 0 && (
                    <NotApplicableList
                      checks={notApplicable}
                      cells={decider}
                      inheritsFromProject={tickTarget?.scope === "well" && !!wp}
                    />
                  )}
                  {!editable && checks.length > 0 && (
                    <p className="flex items-center gap-1.5 px-4 pb-3 text-xs text-muted-foreground">
                      <Lock className="h-3 w-3" />
                      {team.editor_source === "planner"
                        ? "View only — campaign planners update these."
                        : `View only — needs the ${team.name} grant (Admin page).`}
                    </p>
                  )}
                </CollapsibleSection>
              );
            })}
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          {onEditActivity ? (
            <Button type="button" variant="ghost" onClick={onEditActivity}>
              <Pencil className="h-3.5 w-3.5" />
              Activity details
            </Button>
          ) : (
            <span />
          )}
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The team checks that don't apply to this activity, folded away (spec §8.7):
 *  listed muted, with where the choice was made when the well inherits. */
function NotApplicableList({
  checks,
  cells,
  inheritsFromProject,
}: {
  checks: CatalogCheck[];
  cells: Record<string, Cell> | undefined;
  inheritsFromProject: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-border/40 px-4 py-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="-mx-1 inline-flex items-center gap-1 rounded px-1 text-xs font-medium text-muted-foreground hover:bg-accent/40"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {NOT_APPLICABLE} ({checks.length})
      </button>
      {open && (
        <ul className="mt-1.5 space-y-1" aria-label={NOT_APPLICABLE}>
          {checks.map((c) => {
            const Icon = checkIcon(c.icon_key);
            const own = cells?.[c.code]?.applies_source === "well";
            const where =
              inheritsFromProject && c.applies_project && c.applies_well
                ? own
                  ? "set on this well"
                  : "from project"
                : inheritsFromProject && !c.applies_well
                  ? "set on the field project"
                  : null;
            return (
              <li key={c.code} className="flex items-center gap-2 text-xs text-muted-foreground">
                <Icon className="h-3.5 w-3.5 shrink-0 opacity-60" />
                <span className="font-mono font-semibold">{c.code}</span>
                <span className="truncate">{c.label}</span>
                {where && <span className="ml-auto shrink-0 text-[11px] opacity-80">{where}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** One check's value cell: its status dot. */
function CheckCell({
  check,
  state,
  statuses,
  disabled,
  inherited,
  onSave,
  onReset,
}: {
  check: CatalogCheck;
  state: CheckState | undefined;
  /** The menu — `pickableStatuses` of the definition this section rendered from. */
  statuses: readonly CheckStatus[];
  disabled: boolean;
  inherited: boolean;
  onSave: (status: CheckStatus) => Promise<void>;
  onReset?: () => Promise<void>;
}) {
  const status = state?.status ?? defaultStatusOf(check.status_set);
  return (
    <div className="flex justify-center">
      {disabled ? (
        <ReadinessDot code={check.code} status={status} inherited={inherited} />
      ) : (
        <ReadinessDot
          code={check.code}
          status={status}
          inherited={inherited}
          statuses={statuses}
          onChange={(next) => onSave(next)}
          onReset={onReset}
        />
      )}
    </div>
  );
}
