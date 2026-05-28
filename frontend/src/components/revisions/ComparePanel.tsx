import { useEffect, useMemo, useState } from "react";
import { ArrowRight, ChevronDown, GitCompare } from "lucide-react";
import { cn } from "@/lib/utils";
import { compareRevisions, type RevisionDiff as RevisionDiffData } from "@/api/compare";
import { listRevisions, type Revision } from "@/api/revisions";
import { ActivityRow, LIVE_REF, optionLabel, SummaryBar } from "./diff-shared";

interface ComparePanelProps {
  projectId: string;
}

/**
 * Planner-facing comparison: a collapsible panel with free base + target
 * pickers (any revision or the live working plan on either side). Defaults to
 * "latest approved revision → live", the planner's most common question.
 */
export function ComparePanel({ projectId }: ComparePanelProps) {
  const [open, setOpen] = useState(false);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [baseRef, setBaseRef] = useState<string>("");
  const [targetRef, setTargetRef] = useState<string>(LIVE_REF);
  const [diff, setDiff] = useState<RevisionDiffData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Revisions newest-first for the pickers.
  const ordered = useMemo(
    () => [...revisions].sort((a, b) => b.rev_number - a.rev_number),
    [revisions],
  );

  useEffect(() => {
    listRevisions(projectId)
      .then(setRevisions)
      .catch(() => setRevisions([]));
  }, [projectId]);

  // Default base = latest approved revision, else latest revision of any status.
  useEffect(() => {
    if (baseRef || ordered.length === 0) return;
    const approved = ordered.find((r) => r.status === "approved");
    setBaseRef((approved ?? ordered[0]).id);
  }, [ordered, baseRef]);

  useEffect(() => {
    if (!open || !baseRef || !targetRef || baseRef === targetRef) {
      if (baseRef === targetRef) setDiff(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    compareRevisions(projectId, baseRef, targetRef)
      .then((d) => !cancelled && setDiff(d))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Failed to compare"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [open, projectId, baseRef, targetRef]);

  return (
    <div className="rounded-xl border border-border/70 bg-card shadow-soft-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 px-4 py-3 text-left transition-colors hover:bg-accent/30"
      >
        <GitCompare className="h-4 w-4 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-foreground">What changed</div>
          <p className="text-xs text-muted-foreground">
            Compare the live working plan against a revision, or any two revisions
          </p>
        </div>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div className="space-y-4 border-t border-border/70 px-4 py-4">
          {revisions.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border/70 px-3 py-4 text-center text-sm text-muted-foreground">
              No revisions yet — create one to compare against the working plan.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Picker
                  value={baseRef}
                  onChange={setBaseRef}
                  revisions={ordered}
                  label="From"
                />
                <ArrowRight className="h-4 w-4 text-muted-foreground/60" />
                <Picker
                  value={targetRef}
                  onChange={setTargetRef}
                  revisions={ordered}
                  label="To"
                />
              </div>

              {baseRef === targetRef && (
                <p className="text-xs text-muted-foreground">
                  Pick two different versions to see what changed.
                </p>
              )}

              {error && (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </div>
              )}

              {loading && <p className="text-sm text-muted-foreground">Comparing…</p>}

              {diff && !loading && baseRef !== targetRef && (
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
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Picker({
  value,
  onChange,
  revisions,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  revisions: Revision[];
  label: string;
}) {
  return (
    <label className="inline-flex items-center gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
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
    </label>
  );
}
