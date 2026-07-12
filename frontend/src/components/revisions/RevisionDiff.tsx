import { useEffect, useMemo, useState } from "react";
import { GitCompare } from "lucide-react";
import {
  changesSinceApproved,
  compareRevisions,
  type RevisionDiff as RevisionDiffData,
} from "@/api/compare";
import type { Revision } from "@/api/revisions";
import { SearchInput } from "@/components/ui/search-input";
import {
  LIVE_REF,
  matchesContractFilter,
  matchesDiffFilter,
  optionLabel,
  sideLabel,
  SummaryBar,
  type ChangeKindFilter,
} from "./diff-shared";
import { ChangeNotesEditor } from "./ChangeNotesEditor";
import type { ChangeNote } from "@/api/change-notes";

// Sentinel base ref: let the server resolve the most recent approved baseline
// (this project's last approved revision, else the clone parent's).
const APPROVED_REF = "approved";
// Sentinel base ref: force the clone-parent's (previous quarter's) last approved
// plan, even when this project already has approvals of its own.
const PARENT_APPROVED_REF = "approved-parent";

// ── Main component ──────────────────────────────────────────────────────────────

interface RevisionDiffProps {
  projectId: string;
  /** The revision being viewed — the "target" (newer) side of the diff. */
  target: Revision;
  /** All revisions in the project, for the comparison picker. */
  revisions: Revision[];
  /** Set when this project was cloned from another — enables the
   *  "previous quarter (last approved)" baseline. */
  cloneParentId?: string | null;
  /** The revision's frozen change notes — shown per resource, read-only. */
  changeNotes?: ChangeNote[];
}

export function RevisionDiff({
  projectId,
  target,
  revisions,
  cloneParentId,
  changeNotes,
}: RevisionDiffProps) {
  // Candidate base revisions: every other revision (incl. discarded/rejected —
  // they're still valid "before" snapshots), most recent first.
  const candidates = useMemo(
    () =>
      revisions
        .filter((r) => r.id !== target.id)
        .sort((a, b) => b.rev_number - a.rev_number),
    [revisions, target.id],
  );

  // Default to the server-resolved "since last approved" baseline; the user can
  // still pick a specific revision or the live plan from the dropdown.
  const [baseRef, setBaseRef] = useState<string>(APPROVED_REF);
  const [diff, setDiff] = useState<RevisionDiffData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Triage controls: narrow what's EXPANDED, never what's counted (the
  // SummaryBar keeps full totals and shows "X of Y" while these are active).
  const [changeFilter, setChangeFilter] = useState<ChangeKindFilter | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    setBaseRef(APPROVED_REF);
  }, [target.id]);

  // A different comparison is a different change set — stale filters would
  // silently empty it.
  useEffect(() => {
    setChangeFilter(null);
    setSearch("");
  }, [target.id, baseRef]);

  const filterActive = changeFilter !== null || search.trim() !== "";
  const filteredActivities = useMemo(
    () => (diff?.activities ?? []).filter((a) => matchesDiffFilter(a, changeFilter, search)),
    [diff, changeFilter, search],
  );
  const filteredContracts = useMemo(
    () => (diff?.contracts ?? []).filter((c) => matchesContractFilter(c, changeFilter, search)),
    [diff, changeFilter, search],
  );

  useEffect(() => {
    if (!baseRef) {
      setDiff(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const request =
      baseRef === APPROVED_REF
        ? changesSinceApproved(projectId, target.id)
        : baseRef === PARENT_APPROVED_REF
          ? changesSinceApproved(projectId, target.id, "parent")
          : compareRevisions(projectId, baseRef, target.id);
    request
      .then((d) => !cancelled && setDiff(d))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Failed to compare"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [projectId, baseRef, target.id]);

  // Even a project's first revision can be compared against the last approved
  // plan (this project's or the previous quarter's) and the live working plan,
  // so there's always a meaningful baseline — no "nothing to compare" bail-out.

  return (
    <div className="space-y-4 rounded-xl border border-border/70 bg-card p-4 shadow-soft-sm">
      <div className="flex flex-wrap items-center gap-2">
        <GitCompare className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold text-foreground">Compare with</h2>
        <select
          value={baseRef}
          onChange={(e) => setBaseRef(e.target.value)}
          className="rounded-md border border-border bg-background px-2 py-1 text-sm"
        >
          <option value={APPROVED_REF}>Last approved revision</option>
          {cloneParentId && (
            <option value={PARENT_APPROVED_REF}>Previous quarter (last approved)</option>
          )}
          {candidates.map((r) => (
            <option key={r.id} value={r.id}>
              {optionLabel(r)}
            </option>
          ))}
          <option value={LIVE_REF}>Current working plan (live)</option>
        </select>
        <span className="text-xs text-muted-foreground">
          changes from the selected version into{" "}
          <span className="font-medium text-foreground">{sideLabel(target)}</span>
        </span>
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Filter by rig, well, project…"
          ariaLabel="Filter changes"
          testId="diff-search"
          className="ml-auto"
        />
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading && <p className="text-sm text-muted-foreground">Comparing…</p>}

      {diff && !loading && (
        <>
          {diff.base.kind === "none" && (
            <p className="text-xs text-muted-foreground">
              No prior approved revision — showing the full plan as new.
            </p>
          )}
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
          (changeNotes?.length ?? 0) === 0 ? (
            <p className="rounded-lg border border-dashed border-border/70 px-3 py-4 text-center text-sm text-muted-foreground">
              No activity changes between these versions.
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
              notes={changeNotes ?? []}
              canEdit={false}
              locked={false}
              readOnly
              filterActive={filterActive}
            />
          )}
        </>
      )}
    </div>
  );
}
