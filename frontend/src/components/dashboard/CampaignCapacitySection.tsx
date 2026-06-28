import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, SlidersHorizontal } from "lucide-react";

import { listActivities, type Activity } from "@/api/activities";
import { projectsApi } from "@/api/projects";
import type { Project } from "@/types";
import { aggregateCapacity } from "@/lib/campaign-capacity";
import { loadSpudMap, saveSpudMap, type SpudMap } from "@/lib/spud-classification";
import { CapacityChart } from "./CapacityChart";
import { SpudTypeEditor } from "./SpudTypeEditor";

/**
 * Overview section comparing rigs (stacked by location) and oil/gas well spuds
 * between this campaign and an optional second one — the Excel one-sheet, one combo
 * chart per campaign. Data + the campaign list load lazily on first open so the
 * overview's first paint stays cheap.
 */
export function CampaignCapacitySection({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [campaigns, setCampaigns] = useState<Project[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [compareId, setCompareId] = useState("");
  const [compareActivities, setCompareActivities] = useState<Activity[]>([]);
  const [spudMap, setSpudMap] = useState<SpudMap>(() => loadSpudMap());

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // Load failures are non-fatal here — the chart simply shows "no data".
    listActivities(projectId)
      .then((a) => !cancelled && setActivities(a))
      .catch(() => undefined);
    projectsApi
      .list()
      .then((p) => !cancelled && setCampaigns(p))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open, projectId]);

  useEffect(() => {
    if (!compareId) {
      setCompareActivities([]);
      return;
    }
    let cancelled = false;
    listActivities(compareId)
      .then((a) => !cancelled && setCompareActivities(a))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [compareId]);

  function updateSpudMap(next: SpudMap) {
    setSpudMap(next);
    saveSpudMap(next);
  }

  const currentName = campaigns.find((c) => c.id === projectId)?.name ?? "This campaign";
  const compareName = campaigns.find((c) => c.id === compareId)?.name ?? "";

  const currentData = useMemo(() => aggregateCapacity(activities, spudMap), [activities, spudMap]);
  const compareData = useMemo(
    () => aggregateCapacity(compareActivities, spudMap),
    [compareActivities, spudMap],
  );

  // Activity types present across both campaigns — the set the editor classifies.
  const types = useMemo(() => {
    const set = new Set<string>();
    for (const a of activities) set.add(a.activity_type);
    for (const a of compareActivities) set.add(a.activity_type);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [activities, compareActivities]);

  return (
    <div className="rounded-lg border border-border/70 bg-card shadow-soft-sm print:hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium text-foreground"
      >
        <span>Rigs &amp; well spuds</span>
        {open ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </button>

      {open && (
        <div className="space-y-3 border-t border-border/60 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="capacity-compare" className="text-xs text-muted-foreground">
              Compare with
            </label>
            <select
              id="capacity-compare"
              value={compareId}
              onChange={(e) => setCompareId(e.target.value)}
              className="rounded-md border border-border bg-background px-2 py-1 text-sm"
            >
              <option value="">— none —</option>
              {campaigns
                .filter((c) => c.id !== projectId)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
            <button
              type="button"
              onClick={() => setEditorOpen((v) => !v)}
              className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-muted"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Configure spud types
            </button>
          </div>

          {editorOpen && <SpudTypeEditor types={types} value={spudMap} onChange={updateSpudMap} />}

          <CapacityChart title={currentName} data={currentData} />
          {compareId && <CapacityChart title={compareName} data={compareData} />}
        </div>
      )}
    </div>
  );
}
