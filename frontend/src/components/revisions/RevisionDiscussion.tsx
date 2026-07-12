import { useCallback, useEffect, useState } from "react";
import { Loader2, MessageSquare, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  addRevisionComment,
  listRevisionComments,
  type RevisionComment,
} from "@/api/revision-comments";
import { ApiError } from "@/api/http";

/** Chip colors per author capacity — mirrors the reviewer (sky) / approver
 *  (primary/green) accents used by the settings panels. */
const ROLE_CHIP: Record<string, string> = {
  Admin: "border-purple-500/30 bg-purple-500/10 text-purple-600 dark:text-purple-400",
  Approver: "border-primary/30 bg-primary/10 text-primary",
  Reviewer: "border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400",
  Planner: "border-border bg-muted/40 text-muted-foreground",
};

interface RevisionDiscussionProps {
  projectId: string;
  revisionId: string;
  /** True while the revision is pending (review/approval) — the only window
   *  the backend accepts new comments in; afterwards the thread is read-only. */
  open: boolean;
}

/** The revision's deliberation thread: lets a reviewer/approver (or planner /
 *  admin) record context WITHOUT ending the pending state — signing carries no
 *  text, and a decision reason only exists on reject / request-changes. The
 *  thread is org-wide visible and stays attached to the revision after
 *  resolution as part of the approval record. */
export function RevisionDiscussion({ projectId, revisionId, open }: RevisionDiscussionProps) {
  const [comments, setComments] = useState<RevisionComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setComments(await listRevisionComments(projectId, revisionId));
    } catch {
      // Non-critical panel — the page must not fail on a comments hiccup.
    } finally {
      setLoading(false);
    }
  }, [projectId, revisionId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handlePost(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setPosting(true);
    setError(null);
    try {
      const created = await addRevisionComment(projectId, revisionId, body.trim());
      setComments((prev) => [...prev, created]);
      setBody("");
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setError("Only designated reviewers/approvers, planners and admins can post.");
      } else {
        setError(err instanceof Error ? err.message : "Failed to post comment");
      }
    } finally {
      setPosting(false);
    }
  }

  // A resolved revision with no recorded deliberation: nothing to show.
  if (!open && !loading && comments.length === 0) return null;

  return (
    <div className="rounded-xl border border-border/70 bg-card shadow-soft-sm">
      <div className="flex items-center gap-3 border-b border-border/70 px-4 py-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <MessageSquare className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-foreground">Discussion</h2>
          <p className="text-xs text-muted-foreground">
            {open
              ? "Visible to everyone; posting is open to reviewers, approvers and planners while the revision is pending"
              : "Part of the approval record — the thread closed when the revision was resolved"}
          </p>
        </div>
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      </div>

      <div className="space-y-3 px-4 py-3">
        {comments.length === 0 && !loading && (
          <p className="text-xs text-muted-foreground">No comments yet.</p>
        )}

        <ul className="space-y-2.5">
          {comments.map((c) => (
            <li key={c.id} className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-medium text-foreground">{c.user_name ?? "Unknown"}</span>
                <span
                  className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                    ROLE_CHIP[c.author_role] ?? ROLE_CHIP.Planner
                  }`}
                >
                  {c.author_role}
                </span>
                <span className="text-muted-foreground">
                  {c.stage === "review" ? "during review" : "at approval"} ·{" "}
                  {new Date(c.created_at).toLocaleString()}
                </span>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{c.body}</p>
            </li>
          ))}
        </ul>

        {open && (
          <form onSubmit={handlePost} className="space-y-2">
            {error && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={2000}
              rows={2}
              placeholder="Add context for the record — e.g. what you checked, what you're waiting on…"
              className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              data-testid="discussion-input"
            />
            <Button type="submit" size="sm" disabled={posting || !body.trim()}>
              {posting ? (
                "Posting…"
              ) : (
                <>
                  <Send className="mr-1.5 h-3.5 w-3.5" />
                  Post comment
                </>
              )}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
