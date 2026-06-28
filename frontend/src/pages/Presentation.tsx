import { useCallback, useEffect, useState } from "react";
import { useParams, NavLink, useSearchParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

import { listActivities, type Activity } from "@/api/activities";
import { listReadiness, type CheckCode, type CheckStatus } from "@/api/readiness";
import { listContracts, type RigContract } from "@/api/contracts";
import { listHwuContracts, type HwuContract } from "@/api/hwu-contracts";
import { listChangeNotes, type ChangeNote } from "@/api/change-notes";
import { projectsApi } from "@/api/projects";
import type { Project } from "@/types";
import type { ReadinessMap } from "@/lib/chart-utils";
import { DrillChart } from "@/components/chart/DrillChart";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ChangeNotesPanel } from "@/components/revisions/ChangeNotesPanel";
import { Button } from "@/components/ui/button";

/**
 * Distraction-free view for a planning meeting / projector: the sequence chart
 * with its legend, then the planner's per-resource change notes. No toolbar,
 * filters or tab chrome — just the three things that matter (the Excel one-sheet).
 */
export function Presentation() {
  const { projectId } = useParams<{ projectId: string }>();
  const [searchParams] = useSearchParams();
  const [project, setProject] = useState<Project | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [readinessMap, setReadinessMap] = useState<ReadinessMap | undefined>(undefined);
  const [contractsByRig, setContractsByRig] = useState<Map<string, RigContract> | undefined>(undefined);
  const [contractsByHwu, setContractsByHwu] = useState<Map<string, HwuContract> | undefined>(undefined);
  const [notes, setNotes] = useState<ChangeNote[]>([]);

  const load = useCallback(async () => {
    if (!projectId) return;
    const [proj, acts, readiness, contracts, hwuContracts, changeNotes] = await Promise.all([
      projectsApi.get(projectId).catch(() => null),
      listActivities(projectId),
      listReadiness(projectId).catch(() => []),
      listContracts(projectId).catch(() => []),
      listHwuContracts(projectId).catch(() => []),
      listChangeNotes(projectId).catch(() => []),
    ]);
    if (proj) setProject(proj);
    setActivities(acts);
    setReadinessMap(
      new Map(
        readiness.map((r) => [r.activity_id, r.checks as Record<CheckCode, { status: CheckStatus }>]),
      ),
    );
    setContractsByRig(new Map(contracts.map((c) => [c.rig_name, c])));
    setContractsByHwu(new Map(hwuContracts.map((c) => [c.hwu_name, c])));
    setNotes(changeNotes);
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  if (!projectId) return null;

  return (
    <div className="fixed inset-0 z-20 overflow-auto bg-background">
      <div className="mx-auto max-w-[1600px] space-y-4 p-6">
        <header className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild className="text-muted-foreground">
            <NavLink to={`/projects/${projectId}/chart`} aria-label="Exit presentation">
              <ArrowLeft className="h-4 w-4" />
            </NavLink>
          </Button>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold tracking-tight">
              {project?.name ?? "Drilling Sequence"}
            </h1>
            <p className="text-xs text-muted-foreground">Rig Sequence — presentation</p>
          </div>
        </header>

        {activities.length > 0 ? (
          <ErrorBoundary label="chart">
            <DrillChart
              activities={activities}
              readinessMap={readinessMap}
              contractsByRig={contractsByRig}
              contractsByHwu={contractsByHwu}
              enableFilters
              legendPosition="right"
              initialProjects={searchParams.getAll("projects")}
              initialLocations={searchParams.getAll("locations")}
            />
          </ErrorBoundary>
        ) : (
          <p className="text-sm text-muted-foreground">No activities to present.</p>
        )}

        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-foreground">Change notes</h2>
          <ChangeNotesPanel notes={notes} emptyText="No change notes recorded for this sequence." />
        </section>
      </div>
    </div>
  );
}
