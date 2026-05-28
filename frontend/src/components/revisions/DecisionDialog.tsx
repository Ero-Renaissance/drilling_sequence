import { useEffect, useState } from "react";
import { Ban, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type DecisionAction = "reject" | "request-changes";

const COPY: Record<
  DecisionAction,
  { title: string; description: string; confirm: string; placeholder: string }
> = {
  reject: {
    title: "Reject revision",
    description:
      "Rejecting declines this revision and unlocks its activities. The reason is recorded on the revision and in the activity log.",
    confirm: "Reject revision",
    placeholder: "Why is this revision being rejected?",
  },
  "request-changes": {
    title: "Request changes",
    description:
      "This sends the revision back and unlocks its activities so the plan can be revised and resubmitted. The reason is recorded on the revision and in the activity log.",
    confirm: "Request changes",
    placeholder: "What needs to change before this can be approved?",
  },
};

interface DecisionDialogProps {
  open: boolean;
  action: DecisionAction;
  revLabel: string;
  loading: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: string) => void;
}

export function DecisionDialog({
  open,
  action,
  revLabel,
  loading,
  onOpenChange,
  onConfirm,
}: DecisionDialogProps) {
  const [reason, setReason] = useState("");
  const copy = COPY[action];

  // Reset the field whenever the dialog opens for a fresh decision.
  useEffect(() => {
    if (open) setReason("");
  }, [open, action]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = reason.trim();
    if (!trimmed) return;
    onConfirm(trimmed);
  }

  const isReject = action === "reject";
  const Icon = isReject ? Ban : RotateCcw;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon
              className={isReject ? "h-4 w-4 text-red-600" : "h-4 w-4 text-orange-600"}
            />
            {copy.title}
          </DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-1">
            <label htmlFor="decision-reason" className="text-sm font-medium text-foreground">
              {revLabel} — reason <span className="text-red-500">*</span>
            </label>
            <textarea
              id="decision-reason"
              autoFocus
              rows={4}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={copy.placeholder}
              className="w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={loading || reason.trim().length === 0}
              variant={isReject ? "destructive" : "default"}
              data-testid="confirm-decision"
            >
              {loading ? "Saving…" : copy.confirm}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
