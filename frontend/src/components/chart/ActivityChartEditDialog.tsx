import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AlertTriangle, FileSignature, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { updateActivity, type Activity } from "@/api/activities";
import {
  upsertCheck,
  CHECK_CODES,
  type CheckCode,
  type CheckStatus,
} from "@/api/readiness";
import type { RigContract } from "@/api/contracts";
import { LOCATIONS, PLAN_TYPES, RISKS } from "@/components/data-grid/ActivityFormDialog";
import { ReadinessDot } from "@/components/readiness/ReadinessDot";
import { CHECK_META, STATUS_DOT } from "@/components/readiness/check-meta";
import { suggestedActivityTypes } from "@/lib/chart-colors";
import {
  classifyContract,
  daysUntilExpiry,
  URGENCY_VISUAL,
} from "@/lib/contract-urgency";
import { detectRigConflicts } from "@/lib/conflicts";

/** Per-activity gates the user can edit. CON is derived from the rig contract. */
const EDITABLE_CODES = CHECK_CODES.filter((c) => c !== "CON") as readonly CheckCode[];

const schema = z
  .object({
    activity_type: z.string().min(1, "Required"),
    start_date: z.string().min(1, "Required"),
    end_date: z.string().min(1, "Required"),
    well_name: z.string().optional(),
    rig_name: z.string().optional(),
    location: z.string().optional(),
    plan_type: z.string().optional(),
    risk: z.string().optional(),
    comment: z.string().optional(),
  })
  .refine((d) => !d.start_date || !d.end_date || d.end_date >= d.start_date, {
    message: "End date must be on or after start date",
    path: ["end_date"],
  });

type FormValues = z.infer<typeof schema>;

interface Props {
  projectId: string;
  activity: Activity;
  readiness: Record<CheckCode, { status: CheckStatus }> | null;
  /** All activities in the project — used for rig autocomplete + conflict detection. */
  allActivities?: Activity[];
  /** Rig contracts in the project — used for the rig contract preview chip. */
  contractsByRig?: Map<string, RigContract>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
      {hint && !error && <div>{hint}</div>}
    </div>
  );
}

const selectClass =
  "flex h-9 w-full rounded-md border border-input bg-background/60 px-3 py-1 text-sm shadow-soft-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50";

// ── Contract preview chip (under the rig field) ──────────────────────────────

function ContractPreview({
  rigName,
  contract,
}: {
  rigName: string;
  contract: RigContract | undefined;
}) {
  const urgency = classifyContract(contract);
  const days = daysUntilExpiry(contract);

  if (!urgency) {
    return (
      <p className="mt-1.5 text-[11px] text-muted-foreground italic">
        No contract on file for{" "}
        <span className="font-medium not-italic text-foreground">{rigName}</span>.
      </p>
    );
  }

  const v = URGENCY_VISUAL[urgency];
  const endLabel = contract?.contract_end ?? "no end date";

  return (
    <div
      className={cn(
        "mt-1.5 inline-flex items-center gap-2 rounded-full border px-2 py-1 text-[11px] font-medium",
        v.tintBg,
        v.tintText,
        v.tintBorder,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", v.dotClass)} />
      <span>{v.label}</span>
      <span className="font-normal opacity-80">
        · ends {endLabel}
        {days !== null && urgency !== "incomplete"
          ? ` (${days >= 0 ? `${days}d left` : `${Math.abs(days)}d ago`})`
          : ""}
      </span>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ActivityChartEditDialog({
  projectId,
  activity,
  readiness,
  allActivities,
  contractsByRig,
  open,
  onOpenChange,
  onSaved,
}: Props) {
  const locked = !!activity.locked_by_revision_id;

  const [checkStatuses, setCheckStatuses] = useState<Record<CheckCode, CheckStatus>>(
    () =>
      Object.fromEntries(
        CHECK_CODES.map((c) => [c, readiness?.[c]?.status ?? "Not Started"]),
      ) as Record<CheckCode, CheckStatus>,
  );

  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      activity_type: activity.activity_type,
      start_date: activity.start_date,
      end_date: activity.end_date,
      well_name: activity.well_name ?? "",
      rig_name: activity.rig_name ?? "",
      location: activity.location ?? "",
      plan_type: activity.plan_type ?? "",
      risk: activity.risk ?? "",
      comment: activity.comment ?? "",
    },
  });

  // Live form values — used for warnings + contract preview
  const watchedRig = watch("rig_name") ?? "";
  const watchedStart = watch("start_date") ?? "";
  const watchedEnd = watch("end_date") ?? "";

  useEffect(() => {
    reset({
      activity_type: activity.activity_type,
      start_date: activity.start_date,
      end_date: activity.end_date,
      well_name: activity.well_name ?? "",
      rig_name: activity.rig_name ?? "",
      location: activity.location ?? "",
      plan_type: activity.plan_type ?? "",
      risk: activity.risk ?? "",
      comment: activity.comment ?? "",
    });
    setCheckStatuses(
      Object.fromEntries(
        CHECK_CODES.map((c) => [c, readiness?.[c]?.status ?? "Not Started"]),
      ) as Record<CheckCode, CheckStatus>,
    );
    setError(null);
  }, [activity, readiness, reset]);

  // ── Derived: rig suggestion list (existing rigs in project) ─────────────────
  const rigSuggestions = useMemo(() => {
    const set = new Set<string>();
    for (const a of allActivities ?? []) if (a.rig_name) set.add(a.rig_name);
    for (const rig of contractsByRig?.keys() ?? []) set.add(rig);
    return Array.from(set).sort();
  }, [allActivities, contractsByRig]);

  // ── Derived: activity type suggestion list (project + predefined) ───────────
  const activityTypeSuggestions = useMemo(
    () =>
      suggestedActivityTypes(
        (allActivities ?? []).map((a) => a.activity_type).filter(Boolean),
      ),
    [allActivities],
  );

  // ── Derived: live CON status for this draft ────────────────────────────────
  // Mirrors the backend derivation: contract.status drives most cases; dates
  // only matter once the contract is workflow-Completed.
  const draftConStatus: CheckStatus = useMemo(() => {
    if (!watchedRig) return "N/A";
    const contract = contractsByRig?.get(watchedRig);
    if (!contract) return "Not Started";
    if (contract.status === "N/A") return "N/A";
    if (contract.status === "Not Started") return "Not Started";
    if (contract.status === "In Progress") return "In Progress";
    if (!contract.contract_end) return "In Progress";
    if (watchedEnd && contract.contract_end < watchedEnd) return "Behind";
    return "Completed";
  }, [watchedRig, watchedEnd, contractsByRig]);

  // ── Derived: contract-impact warning ────────────────────────────────────────
  // Only flag a coverage problem when the contract is workflow-Completed —
  // a draft contract's dates aren't binding yet.
  const contractImpactWarning = useMemo(() => {
    if (!watchedRig || !watchedEnd) return null;
    const contract = contractsByRig?.get(watchedRig);
    if (!contract || contract.status !== "Completed") return null;
    if (!contract.contract_end) return null;
    if (watchedEnd <= contract.contract_end) return null;
    return `End date falls past the rig's contract end (${contract.contract_end}). CON will be Behind for this activity until the contract is extended.`;
  }, [watchedRig, watchedEnd, contractsByRig]);

  // ── Derived: rig conflict warning ───────────────────────────────────────────
  const conflictWarning = useMemo(() => {
    if (!allActivities || !watchedRig || !watchedStart || !watchedEnd) return null;
    const draft: Activity = {
      ...activity,
      rig_name: watchedRig,
      start_date: watchedStart,
      end_date: watchedEnd,
    };
    const others = allActivities.filter((a) => a.id !== activity.id);
    const conflicts = detectRigConflicts([draft, ...others]).filter(
      (c) => c.a.id === activity.id || c.b.id === activity.id,
    );
    if (conflicts.length === 0) return null;
    const other = conflicts[0].a.id === activity.id ? conflicts[0].b : conflicts[0].a;
    return `Overlaps "${other.activity_type}" on ${watchedRig} (${other.start_date} – ${other.end_date}).`;
  }, [allActivities, activity, watchedRig, watchedStart, watchedEnd]);

  async function onSubmit(values: FormValues) {
    setError(null);
    try {
      await updateActivity(projectId, activity.id, {
        activity_type: values.activity_type,
        start_date: values.start_date,
        end_date: values.end_date,
        well_name: values.well_name || null,
        rig_name: values.rig_name || null,
        location: values.location || null,
        plan_type: values.plan_type || null,
        risk: values.risk || null,
        comment: values.comment || null,
      });

      // Only persist user-editable checks. CON is derived server-side.
      await Promise.all(
        EDITABLE_CODES.map((code) =>
          upsertCheck(projectId, activity.id, code, checkStatuses[code]),
        ),
      );

      onSaved();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save activity");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Edit Activity
            {locked && (
              <span className="flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/12 px-2 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
                <Lock className="h-3 w-3" />
                Locked — pending revision
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5 py-1">
          {/* ── Schedule fields ─────────────────────────────────── */}
          <div className="space-y-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Schedule
            </p>

            <div className="grid grid-cols-3 gap-3">
              <Field label="Activity Type *" error={errors.activity_type?.message}>
                <Input
                  {...register("activity_type")}
                  list="activity-type-suggestions"
                  placeholder="Type or pick existing"
                  spellCheck
                  disabled={locked}
                />
                <datalist id="activity-type-suggestions">
                  {activityTypeSuggestions.map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
              </Field>
              <Field label="Start Date *" error={errors.start_date?.message}>
                <Input type="date" {...register("start_date")} disabled={locked} />
              </Field>
              <Field label="End Date *" error={errors.end_date?.message}>
                <Input type="date" {...register("end_date")} disabled={locked} />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Well Name">
                <Input
                  {...register("well_name")}
                  placeholder="Well-A1"
                  spellCheck
                  disabled={locked}
                />
              </Field>
              <Field
                label="Rig Name"
                hint={
                  watchedRig ? (
                    <ContractPreview
                      rigName={watchedRig}
                      contract={contractsByRig?.get(watchedRig)}
                    />
                  ) : null
                }
              >
                <Input
                  {...register("rig_name")}
                  placeholder="Type or pick an existing rig"
                  list="rig-suggestions"
                  spellCheck
                  disabled={locked}
                />
                <datalist id="rig-suggestions">
                  {rigSuggestions.map((rig) => (
                    <option key={rig} value={rig} />
                  ))}
                </datalist>
              </Field>
            </div>

            {/* Warnings — live, non-blocking */}
            {(contractImpactWarning || conflictWarning) && (
              <div className="space-y-1.5">
                {contractImpactWarning && (
                  <div className="flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{contractImpactWarning}</span>
                  </div>
                )}
                {conflictWarning && (
                  <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{conflictWarning}</span>
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-3 gap-3">
              <Field label="Location">
                <select {...register("location")} className={selectClass} disabled={locked}>
                  <option value="">—</option>
                  {LOCATIONS.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Plan Type">
                <select {...register("plan_type")} className={selectClass} disabled={locked}>
                  <option value="">—</option>
                  {PLAN_TYPES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Risk">
                <select {...register("risk")} className={selectClass} disabled={locked}>
                  <option value="">—</option>
                  {RISKS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <Field label="Comment">
              <Input
                {...register("comment")}
                placeholder="Optional note…"
                spellCheck
                disabled={locked}
              />
            </Field>
          </div>

          {/* ── Readiness gates ──────────────────────────────────── */}
          <div className="space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Readiness
            </p>
            <div className="grid grid-cols-7 gap-3 rounded-lg border border-border/70 bg-card/60 p-3">
              {EDITABLE_CODES.map((code) => {
                const status = checkStatuses[code];
                return (
                  <div key={code} className="flex flex-col items-center gap-1.5">
                    <div className="flex flex-col items-center gap-0.5">
                      <span className="text-[10px] font-semibold text-foreground/80">
                        {code}
                      </span>
                      <span className="text-[9px] text-muted-foreground line-clamp-1">
                        {CHECK_META[code].label}
                      </span>
                    </div>
                    <ReadinessDot
                      code={code}
                      status={status}
                      disabled={locked}
                      onChange={(next) =>
                        setCheckStatuses((prev) => ({ ...prev, [code]: next }))
                      }
                    />
                    <span className="text-[10px] text-muted-foreground">{status}</span>
                  </div>
                );
              })}
            </div>

            {/* CON — read-only, derived from rig contract */}
            <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-xs">
              <FileSignature className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="font-medium text-foreground">CON · Contract</span>
              <span className="flex items-center gap-1.5">
                <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOT[draftConStatus])} />
                <span className="font-medium">{draftConStatus}</span>
              </span>
              <span className="ml-auto text-[11px] text-muted-foreground">
                Derived from the rig contract — edit the contract to change this.
              </span>
            </div>
          </div>

          {error && (
            <p
              className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              role="alert"
            >
              {error}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {locked ? "Close" : "Cancel"}
            </Button>
            {!locked && (
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Saving…" : "Save"}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
