import { useEffect, useMemo, useState } from "react";
import { Calendar, FileSignature, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  classifyContract,
  daysUntilExpiry,
  URGENCY_VISUAL,
} from "@/lib/contract-urgency";
import {
  listContracts,
  upsertContract,
  CONTRACT_STATUSES,
  type ContractStatus,
  type RigContract,
} from "@/api/contracts";

interface ContractEditorDialogProps {
  projectId: string;
  rigName: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful save so the parent can refresh derived readiness data. */
  onSaved?: () => void;
}

// ── Status segmented selector ────────────────────────────────────────────────

function StatusSegmented({
  value,
  onChange,
}: {
  value: ContractStatus;
  onChange: (v: ContractStatus) => void;
}) {
  return (
    <div className="inline-flex w-full rounded-lg border border-border/70 bg-card/60 p-0.5">
      {CONTRACT_STATUSES.map((s) => {
        const selected = s === value;
        return (
          <button
            key={s}
            type="button"
            onClick={() => onChange(s)}
            className={cn(
              "flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
              selected
                ? "bg-primary text-primary-foreground shadow-soft-sm"
                : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
            )}
          >
            {s}
          </button>
        );
      })}
    </div>
  );
}

// ── Dialog ────────────────────────────────────────────────────────────────────

export function ContractEditorDialog({
  projectId,
  rigName,
  open,
  onOpenChange,
  onSaved,
}: ContractEditorDialogProps) {
  const [contract, setContract] = useState<RigContract | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [status, setStatus] = useState<ContractStatus>("Not Started");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!open || !rigName) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    listContracts(projectId)
      .then((all) => {
        if (cancelled) return;
        const existing = all.find((c) => c.rig_name === rigName) ?? null;
        setContract(existing);
        setStatus(existing?.status ?? "Not Started");
        setStart(existing?.contract_start ?? "");
        setEnd(existing?.contract_end ?? "");
        setNotes(existing?.notes ?? "");
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load contract");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, rigName, projectId]);

  async function handleSave() {
    if (!rigName) return;
    setSaving(true);
    setError(null);
    try {
      await upsertContract(projectId, rigName, {
        status,
        contract_start: start || null,
        contract_end: end || null,
        notes: notes.trim() || null,
      });
      onSaved?.();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save contract");
    } finally {
      setSaving(false);
    }
  }

  function fmtDate(iso: string | null | undefined): string {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }

  // Live classification based on the current draft of (status + end date).
  const draftClassification = useMemo(
    () => classifyContract({ status, contract_end: end || null }),
    [status, end],
  );
  const draftDaysLeft = useMemo(
    () => daysUntilExpiry({ contract_end: end || null }),
    [end],
  );

  const datesActive = status === "Completed";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <FileSignature className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle>Rig Contract</DialogTitle>
              <DialogDescription>
                {rigName ? (
                  <>
                    Contract for{" "}
                    <span className="font-medium text-foreground">{rigName}</span>.
                  </>
                ) : (
                  "No rig selected"
                )}
              </DialogDescription>
            </div>
          </div>

          {draftClassification && (
            <div className="mt-3 flex items-center gap-2 text-xs">
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2 py-1 font-medium",
                  URGENCY_VISUAL[draftClassification].tintBg,
                  URGENCY_VISUAL[draftClassification].tintText,
                  URGENCY_VISUAL[draftClassification].tintBorder,
                )}
              >
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    URGENCY_VISUAL[draftClassification].dotClass,
                  )}
                />
                {URGENCY_VISUAL[draftClassification].label}
              </span>
              {datesActive && draftDaysLeft !== null && draftClassification !== "incomplete" && (
                <span className="tabular-nums text-muted-foreground">
                  {draftDaysLeft < 0
                    ? `${Math.abs(draftDaysLeft)}d ago`
                    : `${draftDaysLeft}d remaining`}
                </span>
              )}
            </div>
          )}
        </DialogHeader>

        {loading ? (
          <div className="flex h-32 items-center justify-center text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (
          <div className="space-y-4 py-2">
            {/* Status — explicit workflow state */}
            <div className="space-y-1.5">
              <Label className="text-xs">Contract status</Label>
              <StatusSegmented value={status} onChange={setStatus} />
              <p className="text-[11px] text-muted-foreground">
                Dates below only count toward the activity gate + expiry alarm when status is{" "}
                <span className="font-medium text-foreground">Completed</span>.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label
                  htmlFor="contract-start"
                  className={cn(
                    "text-xs",
                    !datesActive && "text-muted-foreground/70",
                  )}
                >
                  Contract start{" "}
                  {datesActive ? null : (
                    <span className="text-muted-foreground/70">(draft)</span>
                  )}
                </Label>
                <Input
                  id="contract-start"
                  type="date"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                  className={cn(!datesActive && "opacity-70")}
                />
              </div>
              <div className="space-y-1.5">
                <Label
                  htmlFor="contract-end"
                  className={cn(
                    "text-xs",
                    !datesActive && "text-muted-foreground/70",
                  )}
                >
                  Contract end{" "}
                  {datesActive ? null : (
                    <span className="text-muted-foreground/70">(draft)</span>
                  )}
                </Label>
                <Input
                  id="contract-end"
                  type="date"
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                  className={cn(!datesActive && "opacity-70")}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="contract-notes" className="text-xs">
                Notes <span className="text-muted-foreground">(optional)</span>
              </Label>
              <textarea
                id="contract-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Day rate, contractor name, options to extend…"
                rows={3}
                spellCheck
                className="flex w-full rounded-md border border-input bg-background/60 px-3 py-2 text-sm shadow-soft-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:border-ring/50"
              />
            </div>

            <p className="text-[11px] text-muted-foreground">
              The CON readiness check on each activity mirrors the contract status above. Once
              status is{" "}
              <span className="font-medium text-emerald-600 dark:text-emerald-400">
                Completed
              </span>
              , CON turns{" "}
              <span className="font-medium text-emerald-600 dark:text-emerald-400">Completed</span>{" "}
              for activities whose end date the contract covers, and{" "}
              <span className="font-medium text-red-600 dark:text-red-400">Behind</span> for any
              activity whose end date falls past{" "}
              <span className="font-medium text-foreground">{end || "the contract end"}</span>.
            </p>

            {contract && (
              <div className="rounded-md bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
                <Calendar className="mr-1.5 inline h-3 w-3" />
                Last updated {fmtDate(contract.updated_at)}
              </div>
            )}

            {error && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || loading || !rigName}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save contract
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
