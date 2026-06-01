import { useEffect, useState } from "react";
import { GitBranch } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { createRevision, type Revision } from "@/api/revisions";
import { projectsApi } from "@/api/projects";
import type { ReviewPolicy } from "@/types";

interface CreateRevisionDialogProps {
  projectId: string;
  onCreated: (revision: Revision) => void;
}

export function CreateRevisionDialog({ projectId, onCreated }: CreateRevisionDialogProps) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [policy, setPolicy] = useState<ReviewPolicy>("optional");
  // Planner's route choice when policy is "optional".
  const [withReview, setWithReview] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Read the project's review policy when the dialog opens so we can offer the
  // right route choice (toggle for "optional", a note for "required"/"off").
  useEffect(() => {
    if (!open) return;
    projectsApi
      .get(projectId)
      .then((p) => setPolicy(p.review_policy))
      .catch(() => setPolicy("optional"));
  }, [open, projectId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      // request_review only matters for "optional"; the server forces the route
      // for "required"/"off", so we leave it unset there.
      const requestReview = policy === "optional" ? withReview : undefined;
      const revision = await createRevision(
        projectId,
        label.trim() || undefined,
        requestReview,
      );
      onCreated(revision);
      setOpen(false);
      setLabel("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create revision");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <GitBranch className="mr-2 h-4 w-4" />
          Create Revision
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create Revision Snapshot</DialogTitle>
          <DialogDescription>
            Takes a snapshot of the current schedule for formal approval. All activities will be
            locked from editing until the revision is approved or discarded.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-1">
            <label htmlFor="rev-label" className="text-sm font-medium text-foreground">
              Label <span className="text-muted-foreground">(optional)</span>
            </label>
            <input
              id="rev-label"
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Rev. 01"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/20"
            />
            <p className="text-xs text-muted-foreground">Leave blank to auto-generate (e.g. "Rev. 01")</p>
          </div>

          {/* Route choice — depends on the project's review policy */}
          {policy === "optional" && (
            <fieldset className="space-y-2" data-testid="review-route">
              <legend className="text-sm font-medium text-foreground">Route</legend>
              <label className="flex cursor-pointer items-start gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm">
                <input
                  type="radio"
                  name="route"
                  checked={withReview}
                  onChange={() => setWithReview(true)}
                  className="mt-0.5"
                />
                <span>
                  <span className="font-medium text-foreground">Send for review first</span>
                  <span className="block text-xs text-muted-foreground">
                    Reviewers sign off before it goes to the approvers.
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm">
                <input
                  type="radio"
                  name="route"
                  checked={!withReview}
                  onChange={() => setWithReview(false)}
                  className="mt-0.5"
                />
                <span>
                  <span className="font-medium text-foreground">Submit straight to approval</span>
                  <span className="block text-xs text-muted-foreground">
                    Skips review — approvers will see it was bypassed.
                  </span>
                </span>
              </label>
            </fieldset>
          )}
          {policy === "required" && (
            <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              This project requires review — the revision will go to reviewers first.
            </p>
          )}

          {error && (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Creating…" : "Create Revision"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
