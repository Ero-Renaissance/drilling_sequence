import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, NavLink, Outlet, Navigate } from "react-router-dom";
import { AlertTriangle, BarChart2, ChevronDown, ChevronUp, Table2, CheckSquare, PenSquare, ArrowLeft, RefreshCw, History, GitCompare } from "lucide-react";
import { projectsApi } from "@/api/projects";
import type { Project } from "@/types";
// PenSquare kept for the tab icon
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useProjectsStore } from "@/store/projects";
import { listActivities, type Activity } from "@/api/activities";
import { listReadiness, type CheckCode, type CheckStatus } from "@/api/readiness";
import { listContracts, type RigContract } from "@/api/contracts";
import type { ReadinessMap } from "@/lib/chart-utils";
import { ActivityGrid } from "@/components/data-grid/ActivityGrid";
import { DrillChart } from "@/components/chart/DrillChart";
import { ImportDialog } from "@/components/chart/ImportDialog";
import { ActivityChartEditDialog } from "@/components/chart/ActivityChartEditDialog";
import { ActivityFormDialog } from "@/components/data-grid/ActivityFormDialog";
import { detectRigConflicts, type RigConflict } from "@/lib/conflicts";
import { ReadinessGrid } from "@/components/readiness/ReadinessGrid";
import { ApproverSettings } from "@/components/revisions/ApproverSettings";
import { ComparePanel } from "@/components/revisions/ComparePanel";
import { RevisionList } from "@/components/revisions/RevisionList";
import { ProjectAuditLog } from "@/components/activity/ProjectAuditLog";
import { ViewerStrip } from "@/components/viewers/ViewerStrip";

const tabs = [
  { to: "chart", label: "Sequence", icon: BarChart2 },
  { to: "data", label: "Activities", icon: Table2 },
  { to: "readiness", label: "Readiness", icon: CheckSquare },
  { to: "compare", label: "Compare", icon: GitCompare },
  { to: "signatures", label: "Approvals", icon: PenSquare },
  { to: "activity", label: "Activity Log", icon: History },
];

export function ProjectDetail() {
  const { projectId } = useParams<{ projectId: string }>();
  const storeProject = useProjectsStore((s) => s.projects.find((p) => p.id === projectId));
  const [fetchedProject, setFetchedProject] = useState<Project | null>(null);
  const project = storeProject ?? fetchedProject ?? null;

  useEffect(() => {
    if (!storeProject && projectId) {
      projectsApi.get(projectId).then(setFetchedProject).catch(() => {});
    }
  }, [storeProject, projectId]);

  if (!projectId) return <Navigate to="/projects" replace />;

  return (
    <div className="space-y-4 h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3">
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

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-border/70">
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

function RigConflictBanner({ conflicts }: { conflicts: RigConflict[] }) {
  const [expanded, setExpanded] = useState(false);
  if (conflicts.length === 0) return null;

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm">
      <button
        type="button"
        className="flex w-full items-center gap-2 text-amber-800"
        onClick={() => setExpanded((v) => !v)}
      >
        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
        <span className="font-medium">
          {conflicts.length} rig scheduling {conflicts.length === 1 ? "conflict" : "conflicts"} detected
        </span>
        <span className="ml-auto">
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </span>
      </button>

      {expanded && (
        <ul className="mt-3 space-y-2 border-t border-amber-200 pt-3">
          {conflicts.map((c, i) => (
            <li key={i} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs text-amber-900">
              <span className="font-semibold">{c.rig}</span>
              <span className="text-amber-600">·</span>
              <span>{c.a.well_name ?? c.a.activity_type}</span>
              <span className="text-amber-400">({c.a.start_date} – {c.a.end_date})</span>
              <span className="text-amber-600">overlaps</span>
              <span>{c.b.well_name ?? c.b.activity_type}</span>
              <span className="text-amber-400">({c.b.start_date} – {c.b.end_date})</span>
              <span className="rounded-full bg-amber-100 px-1.5 py-0.5 font-medium text-amber-700 ring-1 ring-amber-200">
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editActivityId, setEditActivityId] = useState<string | null>(null);

  const conflicts = useMemo(
    () => (activities ? detectRigConflicts(activities) : []),
    [activities],
  );

  const conflictIds = useMemo(
    () => new Set(conflicts.flatMap((c) => [c.a.id, c.b.id])),
    [conflicts],
  );

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const [acts, readiness, contracts] = await Promise.all([
        listActivities(projectId),
        listReadiness(projectId).catch(() => []), // readiness is best-effort
        listContracts(projectId).catch(() => []), // contracts are best-effort
      ]);
      setActivities(acts);
      const map: ReadinessMap = new Map(
        readiness.map((r) => [r.activity_id, r.checks as Record<CheckCode, { status: CheckStatus }>]),
      );
      setReadinessMap(map);
      setContractsByRig(new Map(contracts.map((c) => [c.rig_name, c])));
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
            existingActivityTypes={(activities ?? []).map((a) => a.activity_type)}
            existingRigNames={(activities ?? [])
              .map((a) => a.rig_name)
              .filter((n): n is string => !!n)}
          />
        )}
        <div className="mx-1 h-4 w-px bg-border" />
        {projectId && (
          <ImportDialog projectId={projectId} onImported={handleImported} />
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
        <div className="ml-auto">
          {projectId && <ViewerStrip projectId={projectId} />}
        </div>
      </div>

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600" role="alert">{error}</p>
      )}

      <RigConflictBanner conflicts={conflicts} />

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
        <DrillChart
          activities={activities}
          readinessMap={readinessMap}
          contractsByRig={contractsByRig}
          conflictIds={conflictIds}
          onActivityClick={setEditActivityId}
        />
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

export function DataTab() {
  const { projectId } = useParams<{ projectId: string }>();
  if (!projectId) return null;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end">
        <ViewerStrip projectId={projectId} />
      </div>
      <ActivityGrid projectId={projectId} />
    </div>
  );
}

export function ReadinessTab() {
  const { projectId } = useParams<{ projectId: string }>();
  if (!projectId) return null;
  return <ReadinessGrid projectId={projectId} />;
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
