import { useEffect, useMemo, useState } from "react";
import { GitCompare } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  compareRevisions,
  type RevisionDiff as RevisionDiffData,
} from "@/api/compare";
import type { Revision } from "@/api/revisions";
import { ActivityRow, LIVE_REF, optionLabel, sideLabel, SummaryBar } from "./diff-shared";

// ── Main component ──────────────────────────────────────────────────────────────

interface RevisionDiffProps {
  projectId: string;
  /** The revision being viewed — the "target" (newer) side of the diff. */
  target: Revision;
  /** All revisions in the project, for the comparison picker. */
  revisions: Revision[];
}

export function RevisionDiff({ projectId, target, revisions }: RevisionDiffProps) {
  // Candidate base revisions: every other revision (incl. discarded/rejected —
  // they're still valid "before" snapshots), most recent first.
  const candidates = useMemo(
    () =>
      revisions
        .filter((r) => r.id !== target.id)
        .sort((a, b) => b.rev_number - a.rev_number),
    [revisions, target.id],
  );

  // Default base = the most recent revision older than this one.
  const defaultBase = useMemo(
    () => candidates.find((r) => r.rev_number < target.rev_number) ?? candidates[0],
    [candidates, target.rev_number],
  );

  const [baseRef, setBaseRef] = useState<string>(defaultBase?.id ?? "");
  const [diff, setDiff] = useState<RevisionDiffData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setBaseRef(defaultBase?.id ?? "");
  }, [defaultBase?.id]);

  useEffect(() => {
    if (!baseRef) {
      setDiff(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    compareRevisions(projectId, baseRef, target.id)
      .then((d) => !cancelled && setDiff(d))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Failed to compare"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [projectId, baseRef, target.id]);

  if (candidates.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border/70 px-4 py-6 text-center text-sm text-muted-foreground">
        This is the first revision — nothing to compare against yet.
      </div>
    );
  }

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
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading && <p className="text-sm text-muted-foreground">Comparing…</p>}

      {diff && !loading && (
        <>
          <SummaryBar diff={diff} />
          {diff.activities.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border/70 px-3 py-4 text-center text-sm text-muted-foreground">
              No activity changes between these versions.
            </p>
          ) : (
            <div className="space-y-1.5">
              {diff.activities.map((a) => (
                <ActivityRow key={`${a.change}-${a.activity_id}`} act={a} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
