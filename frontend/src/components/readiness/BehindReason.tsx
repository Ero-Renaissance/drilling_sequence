import { useCallback, useRef, useState, type ReactNode } from "react";
import type { CheckStatus } from "@/api/readiness";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { STATUS_SEVERITY } from "./check-meta";

/** The longest reason (backend `CheckUpsert.notes`). */
export const REASON_MAX_LENGTH = 512;

/**
 * Behind needs a reason (2026-11-26, every team): a check can't be saved as
 * behind without saying why — the note sent with the status. Judged by shared
 * severity, never status text. The server enforces it (422); every screen that
 * can set a status asks first, so the save isn't simply refused.
 */
export function needsReason(status: CheckStatus): boolean {
  return STATUS_SEVERITY[status] === "blocked";
}

/** What the prompt names: the check and who it is for. */
export interface ReasonRequest {
  /** The check's label ("Purchase Order"). */
  check: string;
  /** The target ("OGBO ADTU-1", "Bonga Phase 3 (field project)"). */
  subject: string;
}

/**
 * Ask why a check is behind before saving it. `askReason` resolves with the
 * reason — trimmed, never blank — or `null` when the user cancels (the status
 * is then left as it was). Render `reasonDialog` once in the component.
 *
 *   const reason = needsReason(next) ? await askReason({ check, subject }) : undefined;
 *   if (reason === null) return; // cancelled
 *   await setReadiness(projectId, code, target, next, reason);
 */
export function useBehindReason(): {
  askReason: (request: ReasonRequest) => Promise<string | null>;
  reasonDialog: ReactNode;
} {
  const [request, setRequest] = useState<ReasonRequest | null>(null);
  const settle = useRef<((reason: string | null) => void) | null>(null);

  const askReason = useCallback((next: ReasonRequest) => {
    // A second ask while one is open cancels the first.
    settle.current?.(null);
    setRequest(next);
    return new Promise<string | null>((resolve) => {
      settle.current = resolve;
    });
  }, []);

  const finish = (reason: string | null) => {
    settle.current?.(reason);
    settle.current = null;
    setRequest(null);
  };

  return {
    askReason,
    reasonDialog: request ? <ReasonDialog request={request} onDone={finish} /> : null,
  };
}

function ReasonDialog({
  request,
  onDone,
}: {
  request: ReasonRequest;
  onDone: (reason: string | null) => void;
}) {
  const [text, setText] = useState("");
  const reason = text.trim();
  return (
    <Dialog open onOpenChange={(open) => !open && onDone(null)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Why is it behind?</DialogTitle>
          <DialogDescription>
            {request.check} · {request.subject}. A reason is needed to mark a check as behind
            schedule; it is shown in the cell on the Readiness tab.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            // Never bubble to a form this dialog was opened from.
            e.stopPropagation();
            if (reason) onDone(reason);
          }}
          className="space-y-3"
        >
          <textarea
            aria-label="Reason it is behind"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={REASON_MAX_LENGTH}
            rows={3}
            autoFocus
            required
            spellCheck
            className="w-full rounded-md border border-input bg-background/60 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="e.g. vendor not yet awarded, awaiting partner sign-off…"
          />
          <p className="text-right text-[11px] tabular-nums text-muted-foreground">
            {text.length}/{REASON_MAX_LENGTH}
          </p>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onDone(null)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!reason}>
              Set as behind
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
