import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { classifyContract, daysUntilExpiry, URGENCY_VISUAL } from "@/lib/contract-urgency";
import {
  listContracts,
  upsertContract,
  CONTRACT_STATUSES,
  type ContractStatus,
} from "@/api/contracts";
import { listHwuContracts, upsertHwuContract } from "@/api/hwu-contracts";

/** Imperative handle so the parent dialog's main Save persists the contract too. */
export interface ResourceContractHandle {
  /**
   * Persist the contract — but only if the user actually edited it. A no-op when
   * untouched (or still loading), so a plain activity save never rewrites, and
   * crucially never *wipes*, the resource's contract. Rejects on API failure so
   * the caller can surface it.
   */
  save: () => Promise<void>;
}

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

interface Props {
  projectId: string;
  resourceName: string;
  kind: "rig" | "hwu";
  locked?: boolean;
}

/**
 * Inline editor for a *resource's* contract, surfaced in the activity form once a
 * rig/HWU is chosen. The contract belongs to the resource (shared by every activity
 * on it), so it's keyed by resource name, not the activity — but it saves together
 * with the activity via the dialog's main Save (see {@link ResourceContractHandle}),
 * so there's a single save, not two. Replaces the old per-activity CON readiness dot.
 */
export const ResourceContractSection = forwardRef<ResourceContractHandle, Props>(
  function ResourceContractSection({ projectId, resourceName, kind, locked }, ref) {
    const isHwu = kind === "hwu";
    const fetchContracts = isHwu ? listHwuContracts : listContracts;
    const saveContract = isHwu ? upsertHwuContract : upsertContract;

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [status, setStatus] = useState<ContractStatus>("Draft");
    const [start, setStart] = useState("");
    const [end, setEnd] = useState("");
    const [notes, setNotes] = useState("");

    // Has the user edited the contract since it loaded? Drives the save guard and
    // protects against the load clobbering in-flight edits. A ref (not state) so
    // the imperative save() and the async load both read the live value.
    const dirtyRef = useRef(false);
    const markDirty = () => {
      dirtyRef.current = true;
    };

    // Latest field values for the imperative save — avoids a stale closure.
    const valuesRef = useRef({ status, start, end, notes });
    valuesRef.current = { status, start, end, notes };

    // Debounced load — the resource name is a free-text field, so wait for it to
    // settle before fetching (and re-fetch when the resource or kind changes).
    useEffect(() => {
      if (!resourceName) return;
      dirtyRef.current = false; // new resource → fresh, untouched baseline
      let cancelled = false;
      const t = setTimeout(() => {
        setLoading(true);
        setError(null);
        fetchContracts(projectId)
          .then((all) => {
            // Don't clobber edits the user made while we were fetching.
            if (cancelled || dirtyRef.current) return;
            const existing =
              all.find((c) => ("rig_name" in c ? c.rig_name : c.hwu_name) === resourceName) ?? null;
            setStatus(existing?.status ?? "Draft");
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

    useImperativeHandle(
      ref,
      () => ({
        async save() {
          if (!dirtyRef.current) return; // untouched (or not yet loaded) → nothing to persist
          const v = valuesRef.current;
          await saveContract(projectId, resourceName, {
            status: v.status,
            contract_start: v.start || null,
            contract_end: v.end || null,
            notes: v.notes.trim() || null,
          });
          dirtyRef.current = false;
        },
      }),
      [projectId, resourceName, saveContract],
    );

    const draftClass = useMemo(
      () => classifyContract({ status, contract_end: end || null }),
      [status, end],
    );
    const draftDaysLeft = useMemo(() => daysUntilExpiry({ contract_end: end || null }), [end]);
    const datesActive = status === "Completed";

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
              <StatusSegmented
                value={status}
                onChange={(v) => {
                  markDirty();
                  setStatus(v);
                }}
                disabled={locked}
              />
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
                  onChange={(e) => {
                    markDirty();
                    setStart(e.target.value);
                  }}
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
                  onChange={(e) => {
                    markDirty();
                    setEnd(e.target.value);
                  }}
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
                onChange={(e) => {
                  markDirty();
                  setNotes(e.target.value);
                }}
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
              <p className="text-[11px] text-muted-foreground">
                Saved together with the activity when you click Save.
              </p>
            )}
          </>
        )}
      </div>
    );
  },
);
