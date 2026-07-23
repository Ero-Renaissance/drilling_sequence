import { useEffect, useState } from "react";
import { PenLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toaster";
import { useProjectsStore } from "@/store/projects";

// Mirrors the Project.name column (String(256)) and the ProjectUpdate schema
// bound — the input hard-stops at the same width the server enforces.
const MAX_NAME = 256;

interface RenameCampaignDialogProps {
  projectId: string;
  currentName: string;
  /** Refresh the detail header (the locally fetched project) after a rename. */
  onRenamed?: () => void;
}

/**
 * Rename the campaign (the top-level container — `Project` in code). Persists via
 * the shared PATCH /api/projects/{id}, which is Planner/admin-gated and audited
 * server-side; the caller is responsible for only rendering this for editors.
 */
export function RenameCampaignDialog({
  projectId,
  currentName,
  onRenamed,
}: RenameCampaignDialogProps) {
  const updateProject = useProjectsStore((s) => s.updateProject);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(currentName);
  const [saving, setSaving] = useState(false);

  // Re-seed from the current name whenever the dialog opens, so a cancelled edit
  // or an external rename doesn't leave a stale value in the field.
  useEffect(() => {
    if (open) setName(currentName);
  }, [open, currentName]);

  const trimmed = name.trim();
  const unchanged = trimmed === currentName.trim();
  const invalid = trimmed.length === 0 || trimmed.length > MAX_NAME;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (invalid || unchanged || saving) return;
    setSaving(true);
    try {
      await updateProject(projectId, { name: trimmed });
      toast.success("Campaign renamed.");
      setOpen(false);
      onRenamed?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to rename the campaign");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
          aria-label="Rename campaign"
          title="Rename campaign"
        >
          <PenLine className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rename campaign</DialogTitle>
          <DialogDescription>
            Updates the campaign name wherever it appears. The plan itself —
            activities, readiness and approvals — is untouched.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label htmlFor="rename-campaign-name">Campaign name</Label>
            <Input
              id="rename-campaign-name"
              autoFocus
              value={name}
              maxLength={MAX_NAME}
              onChange={(e) => setName(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              placeholder="e.g. Bonga Q3 2026"
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={invalid || unchanged || saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
