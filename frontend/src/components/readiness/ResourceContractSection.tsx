import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toaster";
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
  /** The activity's location. Rig identity is (terrain, name) — a LAND and a
   *  SWAMP rig sharing a name have SEPARATE contracts — so the rig's contract is
   *  looked up and saved against this terrain. Ignored for HWUs (mobile). */
  terrain?: string | null;
  locked?: boolean;
  /** Standalone mode (the Fleet page): the section carries its OWN Save button
   *  instead of deferring to a parent dialog's Save via the imperative handle. */
  standalone?: boolean;
  /** Fired after a standalone save so the parent can refresh its summaries. */
  onSaved?: () => void;
}

/**
 * Inline editor for a *resource's* contract, surfaced in the activity form once a
 * rig/HWU is chosen. The contract belongs to the resource (shared by every activity
 * on it), so it's keyed by resource name, not the activity — but it saves together
 * with the activity via the dialog's main Save (see {@link ResourceContractHandle}),
 * so there's a single save, not two. Replaces the old per-activity CON readiness dot.
 */
export const ResourceContractSection = forwardRef<ResourceContractHandle, Props>(
  function ResourceContractSection(
    { projectId, resourceName, kind, terrain, locked, standalone = false, onSaved },
    ref,
  ) {
    const isHwu = kind === "hwu";
    const fetchContracts = isHwu ? listHwuContracts : listContracts;
    const saveContract = isHwu ? upsertHwuContract : upsertContract;
    const rigTerrain = isHwu ? null : (terrain ?? "").trim() || null;

    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    // Mirrors dirtyRef as state so the standalone Save button can enable itself.
    const [dirtyUi, setDirtyUi] = useState(false);
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
      setDirtyUi(true);
    };

    // Latest field values for the imperative save — avoids a stale closure.
    const valuesRef = useRef({ status, start, end, notes });
    valuesRef.current = { status, start, end, notes };

    // Debounced load — the resource name is a free-text field, so wait for it to
    // settle before fetching (and re-fetch when the resource or kind changes).
    useEffect(() => {
      if (!resourceName) return;
      dirtyRef.current = false; // new resource → fresh, untouched baseline
      setDirtyUi(false);
      let cancelled = false;
      const t = setTimeout(() => {
        setLoading(true);
        setError(null);
        fetchContracts(projectId)
          .then((all) => {
            // Don't clobber edits the user made while we were fetching.
            if (cancelled || dirtyRef.current) return;
            // Rigs match on (terrain, name) — a ""-terrain (legacy/unassigned)
            // contract is accepted as a fallback; HWUs match on name alone.
            const matches = all.filter(
              (c) => ("rig_name" in c ? c.rig_name : c.hwu_name) === resourceName,
            );
            const existing = isHwu
              ? matches[0] ?? null
              : matches.find((c) => "terrain" in c && c.terrain === (rigTerrain ?? "")) ??
                matches.find((c) => "terrain" in c && c.terrain === "") ??
                null;
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
    }, [resourceName, projectId, kind, fetchContracts, isHwu, rigTerrain]);

    const persist = useCallback(async () => {
      if (!dirtyRef.current) return; // untouched (or not yet loaded) → nothing to persist
      const v = valuesRef.current;
      await saveContract(projectId, resourceName, {
        status: v.status,
        // Name WHICH physical rig the contract covers (rig identity is
        // (terrain, name)); the server would 409 a bare name that exists in
        // several terrains. HWU upserts ignore the field.
        ...(isHwu ? {} : { terrain: rigTerrain }),
        contract_start: v.start || null,
        contract_end: v.end || null,
        notes: v.notes.trim() || null,
      });
      dirtyRef.current = false;
      setDirtyUi(false);
    }, [projectId, resourceName, saveContract, isHwu, rigTerrain]);

    useImperativeHandle(ref, () => ({ save: persist }), [persist]);

    // Standalone (Fleet page) save — errors surface here as a toast; the plan
    // lock (423) and planner gating are enforced server-side either way.
    async function saveNow() {
      setSaving(true);
      try {
        await persist();
        toast.success(`${resourceName}'s contract saved.`);
        onSaved?.();
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : "Failed to save the contract");
      } finally {
        setSaving(false);
      }
    }

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

            {!locked &&
              (standalone ? (
                <div className="flex justify-end">
                  <Button size="sm" className="h-7 px-3 text-xs" disabled={!dirtyUi || saving} onClick={saveNow}>
                    {saving && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
                    Save contract
                  </Button>
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground">
                  Saved together with the activity when you click Save.
                </p>
              ))}
          </>
        )}
      </div>
    );
  },
);
