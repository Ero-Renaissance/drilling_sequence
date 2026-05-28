import { useState } from "react";
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

interface CreateRevisionDialogProps {
  projectId: string;
  onCreated: (revision: Revision) => void;
}

export function CreateRevisionDialog({ projectId, onCreated }: CreateRevisionDialogProps) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const revision = await createRevision(projectId, label.trim() || undefined);
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
            <label htmlFor="rev-label" className="text-sm font-medium text-slate-700">
              Label <span className="text-slate-400">(optional)</span>
            </label>
            <input
              id="rev-label"
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Rev. 01"
              className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200"
            />
            <p className="text-xs text-slate-400">Leave blank to auto-generate (e.g. "Rev. 01")</p>
          </div>

          {error && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
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
