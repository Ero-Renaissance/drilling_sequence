import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AlertTriangle, CheckCircle2, Lock, RotateCcw } from "lucide-react";
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
import { setActivityCompletion, updateActivity, type Activity } from "@/api/activities";
import {
  upsertCheck,
  CHECK_CODES,
  type CheckCode,
  type CheckStatus,
} from "@/api/readiness";
import type { RigContract } from "@/api/contracts";
import type { HwuContract } from "@/api/hwu-contracts";
import { LOCATIONS, PLAN_TYPES, RISKS } from "@/components/data-grid/ActivityFormDialog";
import { ReadinessDot } from "@/components/readiness/ReadinessDot";
import { CHECK_META } from "@/components/readiness/check-meta";
import { suggestedActivityTypes } from "@/lib/chart-colors";
import {
  ResourceContractSection,
  type ResourceContractHandle,
} from "@/components/readiness/ResourceContractSection";
import { detectResourceConflicts } from "@/lib/conflicts";

/** Per-activity readiness gates the user can edit. */
const EDITABLE_CODES = CHECK_CODES;

const schema = z
  .object({
    activity_type: z.string().min(1, "Required"),
    start_date: z.string().min(1, "Required"),
    end_date: z.string().min(1, "Required"),
    well_name: z.string().min(1, "Required"),
    no_resource: z.boolean(),
    resource_type: z.enum(["Rig", "HWU"]),
    resource_name: z.string().optional(),
    location: z.string().min(1, "Required"),
    plan_type: z.string().min(1, "Required"),
    risk: z.string().min(1, "Required"),
    comment: z.string().optional(),
    readiness_required: z.boolean(),
  })
  .refine((d) => !d.start_date || !d.end_date || d.end_date >= d.start_date, {
    message: "End date must be on or after start date",
    path: ["end_date"],
  })
  .refine((d) => d.no_resource || !!d.resource_name?.trim(), {
    message: "Required — or tick “No resource needed”",
    path: ["resource_name"],
  });

type FormValues = z.infer<typeof schema>;

interface Props {
  projectId: string;
  activity: Activity;
  readiness: Record<CheckCode, { status: CheckStatus }> | null;
  /** All activities in the project — used for rig autocomplete + conflict detection. */
  allActivities?: Activity[];
  /** Rig contracts in the project — used for the contract preview chip. */
  contractsByRig?: Map<string, RigContract>;
  /** HWU contracts — the HWU parallel to contractsByRig. */
  contractsByHwu?: Map<string, HwuContract>;
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

// ── Main component ────────────────────────────────────────────────────────────

export function ActivityChartEditDialog({
  projectId,
  activity,
  readiness,
  allActivities,
  contractsByRig,
  contractsByHwu,
  open,
  onOpenChange,
  onSaved,
}: Props) {
  const locked = !!activity.locked_by_revision_id;
  const isCompleted = !!activity.completed_at;
  const [completing, setCompleting] = useState(false);

  const [checkStatuses, setCheckStatuses] = useState<Record<CheckCode, CheckStatus>>(
    () =>
      Object.fromEntries(
        CHECK_CODES.map((c) => [c, readiness?.[c]?.status ?? "On Track"]),
      ) as Record<CheckCode, CheckStatus>,
  );

  const [error, setError] = useState<string | null>(null);
  const contractRef = useRef<ResourceContractHandle>(null);

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
      no_resource: !activity.rig_name && !activity.hwu_name,
      resource_type: activity.hwu_name ? "HWU" : "Rig",
      resource_name: activity.hwu_name ?? activity.rig_name ?? "",
      location: activity.location ?? "",
      plan_type: activity.plan_type ?? "",
      risk: activity.risk ?? "",
      comment: activity.comment ?? "",
      readiness_required: activity.readiness_required ?? true,
    },
  });

  // Live form values — used for warnings + contract preview
  const watchedResourceType = watch("resource_type");
  const watchedResourceName = watch("resource_name") ?? "";
  const noResource = watch("no_resource");
  const watchedStart = watch("start_date") ?? "";
  const watchedEnd = watch("end_date") ?? "";

  useEffect(() => {
    reset({
      activity_type: activity.activity_type,
      start_date: activity.start_date,
      end_date: activity.end_date,
      well_name: activity.well_name ?? "",
      no_resource: !activity.rig_name && !activity.hwu_name,
      resource_type: activity.hwu_name ? "HWU" : "Rig",
      resource_name: activity.hwu_name ?? activity.rig_name ?? "",
      location: activity.location ?? "",
      plan_type: activity.plan_type ?? "",
      risk: activity.risk ?? "",
      comment: activity.comment ?? "",
      readiness_required: activity.readiness_required ?? true,
    });
    setCheckStatuses(
      Object.fromEntries(
        CHECK_CODES.map((c) => [c, readiness?.[c]?.status ?? "On Track"]),
      ) as Record<CheckCode, CheckStatus>,
    );
    setError(null);
  }, [activity, readiness, reset]);

  // ── Derived: resource suggestions (existing rigs/HWUs of the chosen type) ────
  const resourceSuggestions = useMemo(() => {
    const isHwu = watchedResourceType === "HWU";
    const set = new Set<string>();
    for (const a of allActivities ?? []) {
      const name = isHwu ? a.hwu_name : a.rig_name;
      if (name) set.add(name);
    }
    for (const n of (isHwu ? contractsByHwu : contractsByRig)?.keys() ?? []) set.add(n);
    return Array.from(set).sort();
  }, [allActivities, contractsByRig, contractsByHwu, watchedResourceType]);

  // The contract for the currently-chosen resource (rig or HWU).
  const resourceContract = useMemo<RigContract | HwuContract | undefined>(() => {
    if (noResource || !watchedResourceName) return undefined;
    return watchedResourceType === "HWU"
      ? contractsByHwu?.get(watchedResourceName)
      : contractsByRig?.get(watchedResourceName);
  }, [noResource, watchedResourceType, watchedResourceName, contractsByRig, contractsByHwu]);

  // ── Derived: activity type suggestion list (project + predefined) ───────────
  const activityTypeSuggestions = useMemo(
    () =>
      suggestedActivityTypes(
        (allActivities ?? []).map((a) => a.activity_type).filter(Boolean),
      ),
    [allActivities],
  );

  // ── Derived: contract-impact warning ────────────────────────────────────────
  // Only flag a coverage problem when the contract is workflow-Completed —
  // a draft contract's dates aren't binding yet.
  const contractImpactWarning = useMemo(() => {
    if (!watchedResourceName || !watchedEnd) return null;
    const contract = resourceContract;
    if (!contract || contract.status !== "Completed") return null;
    if (!contract.contract_end) return null;
    if (watchedEnd <= contract.contract_end) return null;
    return `End date falls past the contract end (${contract.contract_end}). The contract must be extended to cover this activity.`;
  }, [watchedResourceName, watchedEnd, resourceContract]);

  // ── Derived: rig conflict warning ───────────────────────────────────────────
  const conflictWarning = useMemo(() => {
    if (noResource || !allActivities || !watchedResourceName || !watchedStart || !watchedEnd)
      return null;
    const draft: Activity = {
      ...activity,
      rig_name: watchedResourceType === "Rig" ? watchedResourceName : null,
      hwu_name: watchedResourceType === "HWU" ? watchedResourceName : null,
      start_date: watchedStart,
      end_date: watchedEnd,
    };
    const others = allActivities.filter((a) => a.id !== activity.id);
    const conflicts = detectResourceConflicts([draft, ...others]).filter(
      (c) => c.a.id === activity.id || c.b.id === activity.id,
    );
    if (conflicts.length === 0) return null;
    const other = conflicts[0].a.id === activity.id ? conflicts[0].b : conflicts[0].a;
    return `Overlaps "${other.activity_type}" on ${watchedResourceName} (${other.start_date} – ${other.end_date}).`;
  }, [noResource, allActivities, activity, watchedResourceType, watchedResourceName, watchedStart, watchedEnd]);

  async function onSubmit(values: FormValues) {
    setError(null);
    try {
      await updateActivity(projectId, activity.id, {
        activity_type: values.activity_type,
        start_date: values.start_date,
        end_date: values.end_date,
        well_name: values.well_name || null,
        rig_name:
          !values.no_resource && values.resource_type === "Rig" ? values.resource_name || null : null,
        hwu_name:
          !values.no_resource && values.resource_type === "HWU" ? values.resource_name || null : null,
        location: values.location || null,
        plan_type: values.plan_type || null,
        risk: values.risk || null,
        comment: values.comment || null,
        readiness_required: values.readiness_required,
      });

      // Persist the per-activity readiness gates.
      await Promise.all(
        EDITABLE_CODES.map((code) =>
          upsertCheck(projectId, activity.id, code, checkStatuses[code]),
        ),
      );

      // The resource's contract (only if the user edited it) saves with the
      // activity — one Save, not two.
      await contractRef.current?.save();

      onSaved();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save activity");
    }
  }

  async function toggleCompletion() {
    setCompleting(true);
    setError(null);
    try {
      await setActivityCompletion(projectId, activity.id, !isCompleted);
      onSaved();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update completion");
    } finally {
      setCompleting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Edit Activity
            {isCompleted && (
              <span className="flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/12 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="h-3 w-3" />
                Completed
              </span>
            )}
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
              <Field label="Well Name *" error={errors.well_name?.message}>
                <Input
                  {...register("well_name")}
                  placeholder="Well-A1"
                  spellCheck
                  disabled={locked}
                />
              </Field>
              <Field label="Resource *" error={errors.resource_name?.message}>
                <div className="flex gap-2">
                  <select
                    {...register("resource_type")}
                    className={cn(selectClass, "w-24 shrink-0", noResource && "opacity-50")}
                    disabled={locked || noResource}
                  >
                    <option value="Rig">Rig</option>
                    <option value="HWU">HWU</option>
                  </select>
                  <Input
                    {...register("resource_name")}
                    placeholder={
                      watchedResourceType === "HWU" ? "Type or pick an HWU" : "Type or pick a rig"
                    }
                    list="resource-suggestions"
                    spellCheck
                    disabled={locked || noResource}
                    className={cn("min-w-0 flex-1", noResource && "opacity-50")}
                  />
                  <datalist id="resource-suggestions">
                    {resourceSuggestions.map((n) => (
                      <option key={n} value={n} />
                    ))}
                  </datalist>
                </div>
                <label className="mt-1.5 flex items-center gap-2 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 rounded border-input"
                    disabled={locked}
                    {...register("no_resource")}
                  />
                  No resource needed
                </label>
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

            {!noResource && watchedResourceName && (
              <ResourceContractSection
                ref={contractRef}
                projectId={projectId}
                resourceName={watchedResourceName}
                kind={watchedResourceType === "HWU" ? "hwu" : "rig"}
                locked={locked}
              />
            )}

            <div className="grid grid-cols-3 gap-3">
              <Field label="Location *" error={errors.location?.message}>
                <select {...register("location")} className={selectClass} disabled={locked}>
                  <option value="">Select…</option>
                  {LOCATIONS.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Plan Type *" error={errors.plan_type?.message}>
                <select {...register("plan_type")} className={selectClass} disabled={locked}>
                  <option value="">Select…</option>
                  {PLAN_TYPES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Risk *" error={errors.risk?.message}>
                <select {...register("risk")} className={selectClass} disabled={locked}>
                  <option value="">Select…</option>
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
            {/* Opt-out — when off, this activity's gate icons are hidden on the
                chart and print-out, and it drops out of the dashboard readiness KPIs. */}
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-input"
                disabled={locked}
                {...register("readiness_required")}
              />
              <span className="font-medium text-foreground">Readiness check required</span>
              <span className="text-muted-foreground">
                — off hides these gates on the chart &amp; print-out
              </span>
            </label>
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
            <Button
              type="button"
              variant="outline"
              className="mr-auto"
              onClick={toggleCompletion}
              disabled={completing}
              data-testid="toggle-completion"
            >
              {isCompleted ? (
                <>
                  <RotateCcw className="h-4 w-4" />
                  {completing ? "Reopening…" : "Reopen"}
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  {completing ? "Completing…" : "Mark complete"}
                </>
              )}
            </Button>
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
