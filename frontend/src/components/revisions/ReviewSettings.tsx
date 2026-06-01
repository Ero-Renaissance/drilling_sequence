import { useCallback, useEffect, useState } from "react";
import { ChevronDown, Plus, RefreshCw, SlidersHorizontal, Trash2, UserSearch } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { addReviewer, listReviewers, removeReviewer, type Reviewer } from "@/api/reviewers";
import { projectsApi } from "@/api/projects";
import type { ReviewPolicy } from "@/types";

function initials(value: string): string {
  return value
    .split(/[\s.@_-]+/)
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

const POLICY_COPY: Record<ReviewPolicy, string> = {
  required: "Every revision must pass review before approval.",
  optional: "The planner chooses per revision whether to route through review.",
  off: "Review is unavailable — revisions go straight to approval.",
};

// ── Review policy selector ────────────────────────────────────────────────────

function ReviewPolicyCard({ projectId }: { projectId: string }) {
  const [policy, setPolicy] = useState<ReviewPolicy>("optional");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    projectsApi
      .get(projectId)
      .then((p) => setPolicy(p.review_policy))
      .catch(() => undefined);
  }, [projectId]);

  async function change(next: ReviewPolicy) {
    const prev = policy;
    setPolicy(next);
    setSaving(true);
    setError(null);
    try {
      await projectsApi.update(projectId, { review_policy: next });
    } catch (err) {
      setPolicy(prev);
      setError(err instanceof Error ? err.message : "Failed to update review policy");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-border/70 bg-card p-4 shadow-soft-sm">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <SlidersHorizontal className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-foreground">Review policy</h2>
          <p className="text-xs text-muted-foreground">{POLICY_COPY[policy]}</p>
        </div>
        <select
          value={policy}
          onChange={(e) => change(e.target.value as ReviewPolicy)}
          disabled={saving}
          className="rounded-md border border-border bg-background px-2 py-1 text-sm"
          data-testid="review-policy-select"
          aria-label="Review policy"
        >
          <option value="required">Required</option>
          <option value="optional">Optional</option>
          <option value="off">Off</option>
        </select>
      </div>
      {error && (
        <p className="mt-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

// ── Reviewer matrix (mirrors ApproverSettings) ────────────────────────────────

function ReviewerList({ projectId }: { projectId: string }) {
  const [reviewers, setReviewers] = useState<Reviewer[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [roleLabel, setRoleLabel] = useState("Reviewer");
  const [adding, setAdding] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setReviewers(await listReviewers(projectId));
    } catch {
      // non-critical
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setAdding(true);
    setError(null);
    try {
      const r = await addReviewer(projectId, {
        email: email.trim(),
        name: name.trim() || undefined,
        role_label: roleLabel.trim() || "Reviewer",
      });
      setReviewers((prev) => [...prev, r]);
      setEmail("");
      setName("");
      setRoleLabel("Reviewer");
      setShowForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add reviewer");
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(reviewer: Reviewer) {
    try {
      await removeReviewer(projectId, reviewer.id);
      setReviewers((prev) => prev.filter((r) => r.id !== reviewer.id));
    } catch {
      setError("Failed to remove reviewer");
    }
  }

  return (
    <div className="rounded-xl border border-border/70 bg-card shadow-soft-sm">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-3 rounded-t-xl px-4 py-3 text-left transition-colors hover:bg-accent/30"
      >
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-500/10 text-sky-600 dark:text-sky-400">
          <UserSearch className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-foreground">Reviewers</h2>
          <p className="text-xs text-muted-foreground">
            {reviewers.length === 0
              ? "Designate reviewers — all must sign off before a revision goes to approval"
              : `${reviewers.length} reviewer${reviewers.length === 1 ? "" : "s"} · all sign off before approval`}
          </p>
        </div>
        {loading && <RefreshCw className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        <ChevronDown
          className={cn("h-4 w-4 text-muted-foreground transition-transform", expanded && "rotate-180")}
        />
      </button>

      {expanded && (
        <div className="border-t border-border/70 px-4 py-3">
          {error && (
            <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          {reviewers.length > 0 && (
            <ul className="mb-3 space-y-1.5">
              {reviewers.map((r) => (
                <li
                  key={r.id}
                  className="group flex items-center gap-3 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-sm transition-colors hover:border-border"
                >
                  <Avatar className="h-7 w-7">
                    <AvatarFallback className="bg-sky-500/15 text-[10px] text-sky-600 dark:text-sky-400">
                      {initials(r.name ?? r.email)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1 leading-tight">
                    <div className="truncate font-medium text-foreground">
                      {r.name ?? r.email.split("@")[0]}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">{r.email}</div>
                  </div>
                  <span className="shrink-0 rounded-full border border-border bg-background px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                    {r.role_label}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRemove(r)}
                    className="shrink-0 rounded-md p-1 text-muted-foreground opacity-0 transition-all hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                    title="Remove reviewer"
                    data-testid="remove-reviewer"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {showForm ? (
            <form
              onSubmit={handleAdd}
              className="space-y-2 rounded-lg border border-sky-500/25 bg-sky-500/[0.04] p-3"
            >
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <Input
                  type="email"
                  placeholder="email@company.com *"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  data-testid="reviewer-email-input"
                />
                <Input
                  type="text"
                  placeholder="Display name (optional)"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
                <Input
                  type="text"
                  placeholder="Role (e.g. Subsurface)"
                  value={roleLabel}
                  onChange={(e) => setRoleLabel(e.target.value)}
                />
              </div>
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={adding || !email.trim()}>
                  {adding ? "Adding…" : "Add reviewer"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setShowForm(false);
                    setError(null);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setShowForm(true)}
              className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
              data-testid="add-reviewer-btn"
            >
              <Plus className="h-3.5 w-3.5" />
              Add reviewer
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function ReviewSettings({ projectId }: { projectId: string }) {
  return (
    <div className="space-y-4">
      <ReviewPolicyCard projectId={projectId} />
      <ReviewerList projectId={projectId} />
    </div>
  );
}
