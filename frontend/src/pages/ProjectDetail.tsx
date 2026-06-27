import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, NavLink, Outlet, Navigate } from "react-router-dom";
import { AlertTriangle, BarChart2, ChevronDown, ChevronUp, Table2, CheckSquare, PenSquare, ArrowLeft, RefreshCw, History, GitCompare, LayoutDashboard, Lock } from "lucide-react";
import { projectsApi } from "@/api/projects";
import type { Project, ProjectLock } from "@/types";
import { reopenPlan } from "@/api/revisions";
import { toast } from "@/components/ui/toaster";
// PenSquare kept for the tab icon
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useProjectsStore } from "@/store/projects";
import { listActivities, type Activity } from "@/api/activities";
import { listReadiness, type CheckCode, type CheckStatus } from "@/api/readiness";
import { listContracts, type RigContract } from "@/api/contracts";
import { listHwuContracts, type HwuContract } from "@/api/hwu-contracts";
import type { ReadinessMap } from "@/lib/chart-utils";
import { ActivityGrid } from "@/components/data-grid/ActivityGrid";
import { DrillChart } from "@/components/chart/DrillChart";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ImportDialog } from "@/components/chart/ImportDialog";
import { ActivityChartEditDialog } from "@/components/chart/ActivityChartEditDialog";
import { ActivityFormDialog } from "@/components/data-grid/ActivityFormDialog";
import { detectResourceConflicts, type ResourceConflict } from "@/lib/conflicts";
import { ReadinessGrid } from "@/components/readiness/ReadinessGrid";
import { ProjectDashboard } from "@/components/dashboard/ProjectDashboard";
import { ApproverSettings } from "@/components/revisions/ApproverSettings";
import { ReviewSettings } from "@/components/revisions/ReviewSettings";
import { ComparePanel } from "@/components/revisions/ComparePanel";
import { RevisionList } from "@/components/revisions/RevisionList";
import { ProjectAuditLog } from "@/components/activity/ProjectAuditLog";
import { ViewerStrip } from "@/components/viewers/ViewerStrip";

const tabs = [
  { to: "overview", label: "Overview", icon: LayoutDashboard },
  { to: "chart", label: "Sequence", icon: BarChart2 },
  { to: "data", label: "Activities", icon: Table2 },
  { to: "readiness", label: "Readiness", icon: CheckSquare },
  { to: "compare", label: "Compare", icon: GitCompare },
  { to: "signatures", label: "Approvals", icon: PenSquare },
  { to: "activity", label: "Activity Log", icon: History },
];

export function PlanLockBanner({ projectId, lock }: { projectId: string; lock: ProjectLock }) {
  const [reopening, setReopening] = useState(false);
  if (!lock.locked || !lock.reason) return null;

  const rev = lock.rev_label ? `Rev ${lock.rev_number} · ${lock.rev_label}` : `Rev ${lock.rev_number}`;

  async function handleRevise() {
    setReopening(true);
    try {
      await reopenPlan(projectId);
      toast.success("Plan reopened for editing.");
      // Reload so every tab reflects the now-unlocked plan, not just the banner.
      window.location.reload();
    } catch (err) {
      setReopening(false);
      toast.error(err instanceof Error ? err.message : "Failed to reopen the plan");
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm print:hidden">
      <Lock className="h-4 w-4 shrink-0 text-amber-700" />
      {lock.reason === "approved" ? (
        <>
          <span className="text-amber-800">
            <span className="font-semibold">{rev} approved.</span> The plan is locked — revise
            it to make changes, which will go through approval again.
          </span>
          <Button size="sm" onClick={handleRevise} disabled={reopening} className="ml-auto">
            {reopening ? "Reopening…" : "Revise Plan"}
          </Button>
        </>
      ) : (
        <span className="text-amber-800">
          <span className="font-semibold">{rev} is awaiting approval.</span> The plan is locked
          until the revision is resolved.
        </span>
      )}
    </div>
  );
}

export function ProjectDetail() {
  const { projectId } = useParams<{ projectId: string }>();
  const storeProject = useProjectsStore((s) => s.projects.find((p) => p.id === projectId));
  const [fetchedProject, setFetchedProject] = useState<Project | null>(null);
  const project = storeProject ?? fetchedProject ?? null;

  // Always fetch the detail — it carries the fresh plan-lock summary (the store
  // copy from the list doesn't), which drives the Revise Plan banner.
  useEffect(() => {
    if (projectId) {
      projectsApi.get(projectId).then(setFetchedProject).catch(() => {});
    }
  }, [projectId]);

  if (!projectId) return <Navigate to="/projects" replace />;

  return (
    <div className="space-y-4 h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 print:hidden">
        <Button variant="ghost" size="icon" asChild className="text-muted-foreground">
          <NavLink to="/projects">
            <ArrowLeft className="h-4 w-4" />
          </NavLink>
        </Button>
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold tracking-tight">
            {project?.name ?? "Loading…"}
          </h1>
          {project && (project.field || project.region) && (
            <p className="truncate text-sm text-muted-foreground">
              {[project.field, project.region].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>
      </div>

      {fetchedProject?.lock?.locked && (
        <PlanLockBanner projectId={projectId} lock={fetchedProject.lock} />
      )}

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-border/70 print:hidden">
        {tabs.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                "relative flex items-center gap-2 px-3.5 py-2.5 text-sm font-medium transition-colors -mb-px",
                isActive
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )
            }
          >
            {({ isActive }) => (
              <>
                <Icon
                  className={cn(
                    "h-4 w-4 transition-colors",
                    isActive ? "text-primary" : "text-muted-foreground/80",
                  )}
                  strokeWidth={isActive ? 2.25 : 2}
                />
                {label}
                <span
                  className={cn(
                    "absolute inset-x-3 -bottom-px h-[2px] rounded-full transition-all",
                    isActive ? "bg-primary opacity-100" : "bg-transparent opacity-0",
                  )}
                />
              </>
            )}
          </NavLink>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto">
        <Outlet />
      </div>
    </div>
  );
}

function ResourceConflictBanner({ conflicts }: { conflicts: ResourceConflict[] }) {
  // A rig or HWU can't be in two places at once — this is a hard error that
  // blocks submitting the plan for approval, so it's red and open by default.
  const [expanded, setExpanded] = useState(true);
  if (conflicts.length === 0) return null;

  return (
    <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm dark:border-red-500/40 dark:bg-red-500/10">
      <button
        type="button"
        className="flex w-full items-center gap-2 text-red-800 dark:text-red-300"
        onClick={() => setExpanded((v) => !v)}
      >
        <AlertTriangle className="h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
        <span className="font-semibold">
          {conflicts.length} scheduling {conflicts.length === 1 ? "conflict" : "conflicts"} — resolve before submitting for approval
        </span>
        <span className="ml-auto">
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </span>
      </button>

      {expanded && (
        <ul className="mt-3 space-y-2 border-t border-red-200 pt-3 dark:border-red-500/30">
          {conflicts.map((c, i) => (
            <li key={i} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs text-red-900 dark:text-red-200">
              <span className="font-semibold">{c.resource}</span>
              <span className="text-red-500/70">·</span>
              <span>{c.a.well_name ?? c.a.activity_type}</span>
              <span className="text-red-500/60">({c.a.start_date} – {c.a.end_date})</span>
              <span className="text-red-600/80">overlaps</span>
              <span>{c.b.well_name ?? c.b.activity_type}</span>
              <span className="text-red-500/60">({c.b.start_date} – {c.b.end_date})</span>
              <span className="rounded-full bg-red-100 px-1.5 py-0.5 font-medium text-red-700 ring-1 ring-red-200 dark:bg-red-500/20 dark:text-red-300 dark:ring-red-500/30">
                {c.overlapDays}d overlap
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ChartTab() {
  const { projectId } = useParams<{ projectId: string }>();
  const [activities, setActivities] = useState<Activity[] | null>(null);
  const [readinessMap, setReadinessMap] = useState<ReadinessMap | undefined>(undefined);
  const [contractsByRig, setContractsByRig] = useState<Map<string, RigContract> | undefined>(
    undefined,
  );
  const [contractsByHwu, setContractsByHwu] = useState<Map<string, HwuContract> | undefined>(
    undefined,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editActivityId, setEditActivityId] = useState<string | null>(null);

  const conflicts = useMemo(
    () => (activities ? detectResourceConflicts(activities) : []),
    [activities],
  );

  const conflictIds = useMemo(
    () => new Set(conflicts.flatMap((c) => [c.a.id, c.b.id])),
    [conflicts],
  );

  // The plan is frozen while a revision is awaiting approval — the backend bars
  // adds/edits/imports with a 423 (assert_project_not_locked checks exactly this:
  // any activity carrying a lock). Reflect it so the plan-changing actions are
  // disabled up front, rather than letting the user hit the wall on submit.
  const isLocked = (activities ?? []).some((a) => a.locked_by_revision_id != null);

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const [acts, readiness, contracts, hwuContracts] = await Promise.all([
        listActivities(projectId),
        listReadiness(projectId).catch(() => []), // readiness is best-effort
        listContracts(projectId).catch(() => []), // contracts are best-effort
        listHwuContracts(projectId).catch(() => []), // HWU contracts are best-effort
      ]);
      setActivities(acts);
      const map: ReadinessMap = new Map(
        readiness.map((r) => [r.activity_id, r.checks as Record<CheckCode, { status: CheckStatus }>]),
      );
      setReadinessMap(map);
      setContractsByRig(new Map(contracts.map((c) => [c.rig_name, c])));
      setContractsByHwu(new Map(hwuContracts.map((c) => [c.hwu_name, c])));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load activities");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  function handleImported(_count: number) { load(); }

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-card px-3 py-2 shadow-soft-sm">
        {projectId && (
          <ActivityFormDialog
            projectId={projectId}
            onCreated={() => load()}
            locked={isLocked}
            existingActivityTypes={(activities ?? []).map((a) => a.activity_type)}
            existingRigNames={(activities ?? [])
              .map((a) => a.rig_name)
              .filter((n): n is string => !!n)}
          />
        )}
        <div className="mx-1 h-4 w-px bg-border" />
        {projectId && (
          <ImportDialog projectId={projectId} onImported={handleImported} locked={isLocked} />
        )}
        <div className="mx-1 h-4 w-px bg-border" />
        <Button variant="ghost" size="sm" onClick={load} disabled={loading} className="text-muted-foreground">
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          <span className="ml-1.5">Refresh</span>
        </Button>
        {activities !== null && (
          <span className="text-xs tabular-nums text-muted-foreground">
            {activities.length} {activities.length === 1 ? "activity" : "activities"}
          </span>
        )}
        {isLocked && (
          <span
            className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700"
            title="The campaign's plan is locked."
          >
            <Lock className="h-3 w-3" />
            Plan locked
          </span>
        )}
        <div className="ml-auto">
          {projectId && <ViewerStrip projectId={projectId} />}
        </div>
      </div>

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600" role="alert">{error}</p>
      )}

      <ResourceConflictBanner conflicts={conflicts} />

      {loading && !activities && (
        <div className="flex h-64 items-center justify-center text-muted-foreground">
          <RefreshCw className="mr-2 h-5 w-5 animate-spin" />
          Loading chart…
        </div>
      )}

      {activities && activities.length === 0 && !loading && (
        <div className="flex h-64 items-center justify-center rounded-lg border border-dashed text-muted-foreground">
          <div className="text-center">
            <BarChart2 className="mx-auto mb-2 h-8 w-8" />
            <p className="font-medium">No activities yet</p>
            <p className="text-sm">Import a CSV or Excel file to get started.</p>
          </div>
        </div>
      )}

      {activities && activities.length > 0 && (
        <ErrorBoundary label="chart">
          <DrillChart
            activities={activities}
            readinessMap={readinessMap}
            contractsByRig={contractsByRig}
            contractsByHwu={contractsByHwu}
            conflictIds={conflictIds}
            onActivityClick={setEditActivityId}
            enableFilters
          />
        </ErrorBoundary>
      )}

      {editActivityId && activities && (
        (() => {
          const activity = activities.find((a) => a.id === editActivityId);
          if (!activity) return null;
          const readiness = readinessMap?.get(editActivityId) ?? null;
          return (
            <ActivityChartEditDialog
              projectId={projectId!}
              activity={activity}
              readiness={readiness}
              allActivities={activities}
              contractsByRig={contractsByRig}
              contractsByHwu={contractsByHwu}
              open={!!editActivityId}
              onOpenChange={(open) => { if (!open) setEditActivityId(null); }}
              onSaved={load}
            />
          );
        })()
      )}
    </div>
  );
}

export function OverviewTab() {
  const { projectId } = useParams<{ projectId: string }>();
  if (!projectId) return null;
  return <ProjectDashboard projectId={projectId} />;
}

export function DataTab() {
  const { projectId } = useParams<{ projectId: string }>();
  if (!projectId) return null;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end">
        <ViewerStrip projectId={projectId} />
      </div>
      <ErrorBoundary label="activity table">
        <ActivityGrid projectId={projectId} />
      </ErrorBoundary>
    </div>
  );
}

export function ReadinessTab() {
  const { projectId } = useParams<{ projectId: string }>();
  if (!projectId) return null;
  return (
    <ErrorBoundary label="readiness table">
      <ReadinessGrid projectId={projectId} />
    </ErrorBoundary>
  );
}

export function CompareTab() {
  const { projectId } = useParams<{ projectId: string }>();
  if (!projectId) return null;
  return <ComparePanel projectId={projectId} />;
}

export function SignaturesTab() {
  const { projectId } = useParams<{ projectId: string }>();
  if (!projectId) return null;
  return (
    <div className="space-y-6">
      <ReviewSettings projectId={projectId} />
      <ApproverSettings projectId={projectId} />
      <RevisionList projectId={projectId} />
    </div>
  );
}

export function ActivityLogTab() {
  const { projectId } = useParams<{ projectId: string }>();
  if (!projectId) return null;
  return <ProjectAuditLog projectId={projectId} />;
}
