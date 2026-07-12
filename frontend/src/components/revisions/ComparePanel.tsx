import { useEffect, useMemo, useState } from "react";
import { ArrowRight, GitCompare } from "lucide-react";
import { crossCompareProjects, type RevisionDiff as RevisionDiffData } from "@/api/compare";
import { listRevisions, type Revision } from "@/api/revisions";
import { projectsApi } from "@/api/projects";
import type { Project } from "@/types";
import {
  LIVE_REF,
  matchesContractFilter,
  matchesDiffFilter,
  optionLabel,
  SummaryBar,
  type ChangeKindFilter,
} from "./diff-shared";
import { SearchInput } from "@/components/ui/search-input";
import { useOutletContext } from "react-router-dom";
import { listChangeNotes, type ChangeNote } from "@/api/change-notes";
import { ChangeNotesEditor } from "./ChangeNotesEditor";
import type { CampaignOutletContext } from "@/pages/ProjectDetail";

interface ComparePanelProps {
  /** This project = the "To" side (typically the new quarter, e.g. Q2). */
  projectId: string;
}

/**
 * Planner-facing cross-project comparison: pick another schedule (e.g. last
 * quarter Q1) on the "From" side and compare it against this one (Q2). Each
 * side can be the live working plan or any of that project's revisions.
 * Activities are matched by lineage carried across clones, so a rig moved to
 * another well reads as a change, not a remove + add.
 */
export function ComparePanel({ projectId }: ComparePanelProps) {
  const [others, setOthers] = useState<Project[]>([]);
  const [baseProjectId, setBaseProjectId] = useState<string>("");
  const [baseRevisions, setBaseRevisions] = useState<Revision[]>([]);
  const [targetRevisions, setTargetRevisions] = useState<Revision[]>([]);
  const [baseRef, setBaseRef] = useState<string>("");
  const [targetRef, setTargetRef] = useState<string>(LIVE_REF);
  const [diff, setDiff] = useState<RevisionDiffData | null>(null);
  // Triage controls (mirror RevisionDiff): narrow what's expanded, never the totals.
  const [changeFilter, setChangeFilter] = useState<ChangeKindFilter | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<ChangeNote[]>([]);
  const ctx = useOutletContext<CampaignOutletContext | null>();
  const canEditNotes = !!ctx?.canEditPlan && !ctx?.locked;

  const ordered = (revs: Revision[]) =>
    [...revs].sort((a, b) => b.rev_number - a.rev_number);

  // Other projects available as the comparison base, plus this project's own revisions.
  useEffect(() => {
    projectsApi
      .list()
      .then((all) => {
        const rest = all.filter((p) => p.id !== projectId);
        setOthers(rest);
        setBaseProjectId((prev) => prev || rest[0]?.id || "");
      })
      .catch(() => setOthers([]));
    listRevisions(projectId)
      .then(setTargetRevisions)
      .catch(() => setTargetRevisions([]));
    listChangeNotes(projectId)
      .then(setNotes)
      .catch(() => setNotes([]));
  }, [projectId]);

  // When the base project changes, load its revisions and default to its latest
  // approved version (the previous plan of record), else the live plan.
  useEffect(() => {
    if (!baseProjectId) {
      setBaseRevisions([]);
      return;
    }
    let cancelled = false;
    listRevisions(baseProjectId)
      .then((revs) => {
        if (cancelled) return;
        setBaseRevisions(revs);
        const sorted = ordered(revs);
        const approved = sorted.find((r) => r.status === "approved");
        setBaseRef((approved ?? sorted[0])?.id ?? LIVE_REF);
      })
      .catch(() => {
        if (cancelled) return;
        setBaseRevisions([]);
        setBaseRef(LIVE_REF);
      });
    return () => {
      cancelled = true;
    };
  }, [baseProjectId]);

  useEffect(() => {
    if (!baseProjectId || !baseRef || !targetRef) {
      setDiff(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    crossCompareProjects(projectId, baseProjectId, baseRef, targetRef)
      .then((d) => !cancelled && setDiff(d))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Failed to compare"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [projectId, baseProjectId, baseRef, targetRef]);

  // A different comparison is a different change set — stale filters would
  // silently empty it.
  useEffect(() => {
    setChangeFilter(null);
    setSearch("");
  }, [projectId, baseProjectId, baseRef, targetRef]);

  const filterActive = changeFilter !== null || search.trim() !== "";
  const filteredActivities = useMemo(
    () => (diff?.activities ?? []).filter((a) => matchesDiffFilter(a, changeFilter, search)),
    [diff, changeFilter, search],
  );
  const filteredContracts = useMemo(
    () => (diff?.contracts ?? []).filter((c) => matchesContractFilter(c, changeFilter, search)),
    [diff, changeFilter, search],
  );

  const baseOrdered = useMemo(() => ordered(baseRevisions), [baseRevisions]);
  const targetOrdered = useMemo(() => ordered(targetRevisions), [targetRevisions]);

  return (
    <div className="space-y-4 rounded-xl border border-border/70 bg-card p-4 shadow-soft-sm">
      <div className="flex items-center gap-2.5">
        <GitCompare className="h-4 w-4 text-muted-foreground" />
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">Compare schedules</h2>
          <p className="text-xs text-muted-foreground">
            See what changed between another drilling schedule (e.g. last quarter) and this one
          </p>
        </div>
      </div>

      {others.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border/70 px-3 py-6 text-center text-sm text-muted-foreground">
          No other campaigns to compare against. Clone this campaign to start the next quarter.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3 text-sm">
            <div className="space-y-1">
              <span className="block text-xs font-medium text-muted-foreground">From schedule</span>
              <div className="flex items-center gap-1.5">
                <select
                  value={baseProjectId}
                  onChange={(e) => setBaseProjectId(e.target.value)}
                  className="rounded-md border border-border bg-background px-2 py-1 text-sm"
                >
                  {others.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <VersionPicker value={baseRef} onChange={setBaseRef} revisions={baseOrdered} />
              </div>
            </div>

            <ArrowRight className="mb-1.5 h-4 w-4 text-muted-foreground/60" />

            <div className="space-y-1">
              <span className="block text-xs font-medium text-muted-foreground">To (this schedule)</span>
              <VersionPicker value={targetRef} onChange={setTargetRef} revisions={targetOrdered} />
            </div>
          </div>

          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          {loading && <p className="text-sm text-muted-foreground">Comparing…</p>}

          {diff && !loading && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <SearchInput
                  value={search}
                  onChange={setSearch}
                  placeholder="Filter by rig, well, project…"
                  ariaLabel="Filter changes"
                  testId="compare-search"
                />
              </div>
              <SummaryBar
                diff={diff}
                filter={changeFilter}
                onFilterChange={setChangeFilter}
                shownCount={filteredActivities.length}
                onClearFilters={() => {
                  setChangeFilter(null);
                  setSearch("");
                }}
              />
              {diff.activities.length === 0 &&
              diff.contracts.length === 0 &&
              notes.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border/70 px-3 py-4 text-center text-sm text-muted-foreground">
                  No activity changes between these schedules.
                </p>
              ) : filterActive &&
                filteredActivities.length === 0 &&
                filteredContracts.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border/70 px-3 py-4 text-center text-sm text-muted-foreground">
                  No changes match the current filter.
                </p>
              ) : (
                <ChangeNotesEditor
                  projectId={projectId}
                  activities={filteredActivities}
                  contracts={filteredContracts}
                  notes={notes}
                  canEdit={canEditNotes}
                  locked={!!ctx?.locked}
                  filterActive={filterActive}
                />
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

function VersionPicker({
  value,
  onChange,
  revisions,
}: {
  value: string;
  onChange: (v: string) => void;
  revisions: Revision[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-md border border-border bg-background px-2 py-1 text-sm"
    >
      <option value={LIVE_REF}>Current working plan (live)</option>
      {revisions.map((r) => (
        <option key={r.id} value={r.id}>
          {optionLabel(r)}
        </option>
      ))}
    </select>
  );
}
