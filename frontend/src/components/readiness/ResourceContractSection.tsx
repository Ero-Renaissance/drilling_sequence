import { useEffect, useMemo, useState } from "react";
import { Calendar, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";
import { cn } from "@/lib/utils";
import { classifyContract, daysUntilExpiry, URGENCY_VISUAL } from "@/lib/contract-urgency";
import {
  listContracts,
  upsertContract,
  CONTRACT_STATUSES,
  type ContractStatus,
  type RigContract,
} from "@/api/contracts";
import { listHwuContracts, upsertHwuContract, type HwuContract } from "@/api/hwu-contracts";

function StatusSegmented({
  value,
  onChange,
  disabled,
}: {
  value: ContractStatus;
  onChange: (v: ContractStatus) => void;
  disabled?: boolean;
}) {
  return (
    <div className="inline-flex w-full rounded-lg border border-border/70 bg-card/60 p-0.5">
      {CONTRACT_STATUSES.map((s) => {
        const selected = s === value;
        return (
          <button
            key={s}
            type="button"
            disabled={disabled}
            onClick={() => onChange(s)}
            className={cn(
              "flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
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

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/**
 * Inline editor for a *resource's* contract, surfaced in the activity form once a
 * rig/HWU is chosen. The contract belongs to the resource (shared by every activity
 * on it), so this saves independently of the activity — its own "Save contract"
 * button. Replaces the old per-activity CON readiness dot, which conflated a
 * resource-level fact with a per-activity readiness gate.
 */
export function ResourceContractSection({
  projectId,
  resourceName,
  kind,
  locked,
}: {
  projectId: string;
  resourceName: string;
  kind: "rig" | "hwu";
  locked?: boolean;
}) {
  const isHwu = kind === "hwu";
  const fetchContracts = isHwu ? listHwuContracts : listContracts;
  const saveContract = isHwu ? upsertHwuContract : upsertContract;

  const [contract, setContract] = useState<RigContract | HwuContract | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [status, setStatus] = useState<ContractStatus>("Not Started");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [notes, setNotes] = useState("");

  // Debounced load — the resource name is a free-text field, so wait for it to
  // settle before fetching (and re-fetch when the resource or kind changes).
  useEffect(() => {
    if (!resourceName) return;
    let cancelled = false;
    const t = setTimeout(() => {
      setLoading(true);
      setError(null);
      fetchContracts(projectId)
        .then((all) => {
          if (cancelled) return;
          const existing =
            all.find((c) => ("rig_name" in c ? c.rig_name : c.hwu_name) === resourceName) ?? null;
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
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [resourceName, projectId, kind, fetchContracts]);

  const draftClass = useMemo(
    () => classifyContract({ status, contract_end: end || null }),
    [status, end],
  );
  const draftDaysLeft = useMemo(() => daysUntilExpiry({ contract_end: end || null }), [end]);
  const datesActive = status === "Completed";

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await saveContract(projectId, resourceName, {
        status,
        contract_start: start || null,
        contract_end: end || null,
        notes: notes.trim() || null,
      });
      toast.success(`Saved ${resourceName}'s contract.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save contract");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-border/70 bg-muted/20 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold text-foreground">
          {resourceName}&rsquo;s contract
          <span className="ml-1.5 font-normal text-muted-foreground">
            · the {isHwu ? "HWU" : "rig"}&rsquo;s contract, shared by all its activities
          </span>
        </p>
        {draftClass && (
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium",
              URGENCY_VISUAL[draftClass].tintBg,
              URGENCY_VISUAL[draftClass].tintText,
              URGENCY_VISUAL[draftClass].tintBorder,
            )}
          >
            <span className={cn("h-1.5 w-1.5 rounded-full", URGENCY_VISUAL[draftClass].dotClass)} />
            {URGENCY_VISUAL[draftClass].label}
            {datesActive && draftDaysLeft !== null && draftClass !== "incomplete" && (
              <span className="font-normal opacity-80">
                · {draftDaysLeft < 0 ? `${Math.abs(draftDaysLeft)}d ago` : `${draftDaysLeft}d left`}
              </span>
            )}
          </span>
        )}
      </div>

      {loading ? (
        <div className="flex h-16 items-center justify-center text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading&hellip;
        </div>
      ) : (
        <>
          <div className="space-y-1.5">
            <Label className="text-xs">Status</Label>
            <StatusSegmented value={status} onChange={setStatus} disabled={locked} />
            <p className="text-[11px] text-muted-foreground">
              Dates bind (and drive the expiry marker) only when status is{" "}
              <span className="font-medium text-foreground">Completed</span>.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor={`contract-start-${resourceName}`} className="text-xs">
                Contract start
              </Label>
              <Input
                id={`contract-start-${resourceName}`}
                type="date"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                disabled={locked}
                className={cn(!datesActive && "opacity-70")}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`contract-end-${resourceName}`} className="text-xs">
                Contract end
              </Label>
              <Input
                id={`contract-end-${resourceName}`}
                type="date"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                disabled={locked}
                className={cn(!datesActive && "opacity-70")}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`contract-notes-${resourceName}`} className="text-xs">
              Notes <span className="text-muted-foreground">(optional)</span>
            </Label>
            <textarea
              id={`contract-notes-${resourceName}`}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={locked}
              rows={2}
              placeholder="Day rate, contractor, options to extend&hellip;"
              className="flex w-full rounded-md border border-input bg-background/60 px-3 py-2 text-sm shadow-soft-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60"
            />
          </div>

          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}

          {!locked && (
            <div className="flex items-center gap-3">
              {contract && (
                <span className="text-[11px] text-muted-foreground">
                  <Calendar className="mr-1 inline h-3 w-3" />
                  Updated {fmtDate(contract.updated_at)}
                </span>
              )}
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={handleSave}
                disabled={saving}
                className="ml-auto"
              >
                {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                Save contract
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
