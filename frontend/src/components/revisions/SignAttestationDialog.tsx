import { useEffect, useState } from "react";
import { PenLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const COPY = {
  approval: {
    title: "Approve & Sign",
    description:
      "Your signature makes this revision part of the approved record. The attestation below is stored with it.",
    statement: "I approve the plan captured in this revision.",
    confirm: "Approve & Sign",
  },
  review: {
    title: "Support & Sign",
    description:
      "Your signature records your support for this revision's progression; it advances to approval once every reviewer has signed. The attestation below is stored with it.",
    statement: "I support the plan captured in this revision.",
    confirm: "Support & Sign",
  },
} as const;

interface SignAttestationDialogProps {
  open: boolean;
  stage: "approval" | "review";
  revLabel: string;
  loading: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

/** The signing confirmation: a signature is a declaration, not a click. The
 *  required checkbox is the signer's attestation; the server refuses an
 *  unattested signature and stores its own canonical wording (with the
 *  resolved baseline) alongside the signature — see revisions.sign. */
export function SignAttestationDialog({
  open,
  stage,
  revLabel,
  loading,
  onOpenChange,
  onConfirm,
}: SignAttestationDialogProps) {
  const [attested, setAttested] = useState(false);
  const copy = COPY[stage];

  // A fresh dialog means a fresh declaration — never carry a tick over.
  useEffect(() => {
    if (open) setAttested(false);
  }, [open, stage]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (attested) onConfirm();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {copy.title} — {revLabel}
          </DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border/70 bg-muted/30 px-3 py-2.5 text-sm text-foreground">
            <input
              type="checkbox"
              checked={attested}
              onChange={(e) => setAttested(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-primary"
              data-testid="attestation-checkbox"
            />
            <span>{copy.statement}</span>
          </label>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!attested || loading} data-testid="attestation-confirm">
              <PenLine className="h-4 w-4" />
              {loading ? "Signing…" : copy.confirm}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
