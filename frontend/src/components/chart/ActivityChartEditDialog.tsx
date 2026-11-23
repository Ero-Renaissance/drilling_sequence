import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AlertTriangle, CheckCircle2, ListChecks, Lock, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn, formatDate } from "@/lib/utils";
import {
  COMMENT_MAX_LENGTH,
  setActivityCompletion,
  updateActivity,
  type Activity,
} from "@/api/activities";
import { upsertCheck, type CheckCode, type CheckStatus } from "@/api/readiness";
import type { RigContract } from "@/api/contracts";
import type { HwuContract } from "@/api/hwu-contracts";
import { LOCATIONS, MARKETS, PLAN_TYPES, RISKS } from "@/components/data-grid/ActivityFormDialog";
import { ReadinessDot } from "@/components/readiness/ReadinessDot";
import { statusOf, useProjectGates } from "@/components/readiness/catalog";
import { getActivityColor, suggestedActivityTypes } from "@/lib/chart-colors";
import {
  ResourceContractSection,
  type ResourceContractHandle,
} from "@/components/readiness/ResourceContractSection";
import { detectResourceConflicts } from "@/lib/conflicts";
import { normalizeResourceName } from "@/lib/resource-identity";

const schema = z
  .object({
    activity_type: z.string().min(1, "Required"),
    start_date: z.string().min(1, "Required"),
    end_date: z.string().min(1, "Required"),
    well_name: z.string().min(1, "Required"),
    well_project: z.string().optional(),
    no_resource: z.boolean(),
    resource_type: z.enum(["Rig", "HWU"]),
    resource_name: z.string().optional(),
    location: z.string().min(1, "Required"),
    plan_type: z.string().min(1, "Required"),
    risk: z.string().min(1, "Required"),
    market: z.string().optional(),
    comment: z
      .string()
      .max(COMMENT_MAX_LENGTH, `Comment must be ${COMMENT_MAX_LENGTH} characters or fewer`)
      .optional(),
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
  /** Open this activity's Readiness panel (every team's checks). */
  onOpenReadiness?: () => void;
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
  onOpenReadiness,
}: Props) {
  // The field-project gates the user can edit — from the readiness catalog.
  const gates = useProjectGates();
  const locked = !!activity.locked_by_revision_id;
  const isCompleted = !!activity.completed_at;
  // Readiness gates live on the FIELD PROJECT (well_project). Without one there's
  // nothing to attach them to, so the gates are shown disabled with a hint.
  const hasProject = !!activity.well_project;
  const [completing, setCompleting] = useState(false);
  const [savingGates, setSavingGates] = useState(false);
  // The Project field is read-only until the user asks to move the well.
  const [movingProject, setMovingProject] = useState(false);

  const [checkStatuses, setCheckStatuses] = useState<Record<CheckCode, CheckStatus>>(
    () => Object.fromEntries(gates.map(({ code }) => [code, statusOf(readiness, code)])),
  );

  const [error, setError] = useState<string | null>(null);
  const contractRef = useRef<ResourceContractHandle>(null);

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      activity_type: activity.activity_type,
      start_date: activity.start_date,
      end_date: activity.end_date,
      well_name: activity.well_name ?? "",
      well_project: activity.well_project ?? "",
      no_resource: !activity.rig_name && !activity.hwu_name,
      resource_type: activity.hwu_name ? "HWU" : "Rig",
      resource_name: activity.hwu_name ?? activity.rig_name ?? "",
      location: activity.location ?? "",
      plan_type: activity.plan_type ?? "",
      risk: activity.risk ?? "",
      market: activity.market ?? "",
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
      well_project: activity.well_project ?? "",
      no_resource: !activity.rig_name && !activity.hwu_name,
      resource_type: activity.hwu_name ? "HWU" : "Rig",
      resource_name: activity.hwu_name ?? activity.rig_name ?? "",
      location: activity.location ?? "",
      plan_type: activity.plan_type ?? "",
      risk: activity.risk ?? "",
      market: activity.market ?? "",
      comment: activity.comment ?? "",
      readiness_required: activity.readiness_required ?? true,
    });
    setCheckStatuses(
      Object.fromEntries(gates.map(({ code }) => [code, statusOf(readiness, code)])),
    );
    setError(null);
    setMovingProject(false);
  }, [activity, readiness, reset, gates]);

  // ── Derived: resource suggestions (existing rigs/HWUs of the chosen type) ────
  // Existing field-project names — a datalist nudge toward consistent spelling
  // (the project drives readiness anchoring, market grouping and the filter).
  const projectSuggestions = useMemo(
    () =>
      [...new Set((allActivities ?? []).map((a) => a.well_project).filter((v): v is string => !!v))].sort(
        (x, y) => x.localeCompare(y),
      ),
    [allActivities],
  );

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

  // The contract for the currently-chosen resource (rig or HWU). The maps are
  // display-keyed (their keys feed the suggestion list), so scan with the
  // registry's case-insensitive identity — a typed "10k rig 1" must still
  // preview the contract saved as "10K Rig 1".
  const resourceContract = useMemo<RigContract | HwuContract | undefined>(() => {
    if (noResource || !watchedResourceName) return undefined;
    const source = watchedResourceType === "HWU" ? contractsByHwu : contractsByRig;
    const exact = source?.get(watchedResourceName);
    if (exact) return exact;
    const nameKey = normalizeResourceName(watchedResourceName);
    for (const [name, contract] of source ?? []) {
      if (normalizeResourceName(name) === nameKey) return contract;
    }
    return undefined;
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
  const contractImpactWarning = useMemo(() => {
    if (!watchedResourceName || !watchedEnd) return null;
    const contract = resourceContract;
    if (!contract?.contract_end) return null;
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

  const changedGates = gates.filter(
    ({ code }) => checkStatuses[code] !== undefined && checkStatuses[code] !== statusOf(readiness, code),
  );

  // Who the dialog is about — the SAVED activity, so the heading stays put
  // while the fields below are being edited.
  const resourceName = activity.hwu_name ?? activity.rig_name;
  const identity = [
    activity.well_name ? activity.activity_type : null,
    activity.well_project || "No field project",
    resourceName || "No rig / HWU",
    `${formatDate(activity.start_date)} – ${formatDate(activity.end_date)}`,
  ].filter((part): part is string => !!part);

  async function onSubmit(values: FormValues) {
    setError(null);
    try {
      await updateActivity(projectId, activity.id, {
        activity_type: values.activity_type,
        start_date: values.start_date,
        end_date: values.end_date,
        well_name: values.well_name || null,
        well_project: values.well_project?.trim() || null,
        rig_name:
          !values.no_resource && values.resource_type === "Rig" ? values.resource_name || null : null,
        hwu_name:
          !values.no_resource && values.resource_type === "HWU" ? values.resource_name || null : null,
        location: values.location || null,
        plan_type: values.plan_type || null,
        risk: values.risk || null,
        market: values.market || null,
        comment: values.comment || null,
        readiness_required: values.readiness_required,
      });

      await saveGates();

      // The resource's contract (only if the user edited it) saves with the
      // activity — one Save, not two.
      await contractRef.current?.save();

      onSaved();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save activity");
    }
  }

  // Persist the readiness gates the user changed. Gates belong to the FIELD
  // PROJECT (well_project), so this updates every activity sharing it; an
  // activity with no field project has no gates to save.
  async function saveGates() {
    const wellProject = activity.well_project;
    if (!wellProject) return;
    await Promise.all(
      changedGates.map(({ code }) => upsertCheck(projectId, wellProject, code, checkStatuses[code])),
    );
  }

  // The plan is locked: the activity's fields are read-only, but readiness is
  // live status and still saves (the server keeps it editable under the lock).
  async function saveGatesOnly(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSavingGates(true);
    try {
      await saveGates();
      onSaved();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save readiness");
    } finally {
      setSavingGates(false);
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
      {/* Focus lands on the dialog, not its first field: an opened dialog with a
          field's text selected turns one stray key into a rename. */}
      <DialogContent
        className="sm:max-w-2xl max-h-[90vh] overflow-y-auto focus:outline-none"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (event.currentTarget as HTMLElement).focus();
        }}
      >
        {/* Stays in view while the form scrolls, so it is always clear WHICH well
            is being edited: the well's name is the heading, with the colour of
            its bar on the sequence. */}
        <DialogHeader className="sticky -top-6 z-10 -mx-6 -mt-6 border-b border-border/70 bg-background px-6 pb-3 pt-6 pr-12">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {locked ? "Viewing" : "Editing"} {activity.well_name ? "well" : "activity"}
          </p>
          <DialogTitle className="flex flex-wrap items-center gap-2 text-xl leading-tight">
            <span
              aria-hidden
              className="h-5 w-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: getActivityColor(activity.activity_type) }}
            />
            <span className="[overflow-wrap:anywhere]" data-testid="edit-dialog-subject">
              {activity.well_name || activity.activity_type}
            </span>
            {isCompleted && (
              <span className="flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/12 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="h-3 w-3" />
                Completed
              </span>
            )}
            {locked && (
              <span className="flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/12 px-2 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
                <Lock className="h-3 w-3" />
                Plan locked
              </span>
            )}
          </DialogTitle>
          <DialogDescription className="text-xs" data-testid="edit-dialog-identity">
            {identity.join(" · ")}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={locked ? saveGatesOnly : handleSubmit(onSubmit)} className="space-y-5 py-1">
          {/* ── Schedule fields ─────────────────────────────────── */}
          <div className="space-y-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Schedule
            </p>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Well Name *" error={errors.well_name?.message}>
                <Input
                  {...register("well_name")}
                  placeholder="Well-A1"
                  spellCheck
                  disabled={locked}
                />
              </Field>
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
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Start Date *" error={errors.start_date?.message}>
                <Input type="date" {...register("start_date")} disabled={locked} />
              </Field>
              <Field label="End Date *" error={errors.end_date?.message}>
                <Input type="date" {...register("end_date")} disabled={locked} />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
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
              <Field label="Market" error={errors.market?.message}>
                <select {...register("market")} className={selectClass} disabled={locked}>
                  <option value="">Select…</option>
                  {MARKETS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

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

            {/* The field project is shown, not offered for typing: moving a well to
                another project changes which gates it reads, so it takes a
                deliberate "Move". A well with no project can simply be given one. */}
            {activity.well_project && !movingProject ? (
              <div className="space-y-1" data-testid="project-readonly">
                <Label className="text-xs font-medium text-muted-foreground">Project</Label>
                <div className="flex min-h-9 flex-wrap items-center justify-between gap-2 rounded-md border border-border/70 bg-muted/30 px-3 py-1.5 text-sm">
                  <span className="font-medium [overflow-wrap:anywhere]">{activity.well_project}</span>
                  {!locked && (
                    <button
                      type="button"
                      onClick={() => setMovingProject(true)}
                      className="text-xs font-medium text-primary hover:underline"
                    >
                      Move to another project
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <Field
                label={activity.well_project ? "Move to project" : "Project"}
                error={errors.well_project?.message}
                hint={
                  activity.well_project ? (
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                      The well will read the new project&apos;s readiness gates.{" "}
                      <button
                        type="button"
                        onClick={() => {
                          setValue("well_project", activity.well_project ?? "");
                          setMovingProject(false);
                        }}
                        className="font-medium text-primary hover:underline"
                      >
                        Keep {activity.well_project}
                      </button>
                    </p>
                  ) : undefined
                }
              >
                <Input
                  {...register("well_project")}
                  list="project-suggestions"
                  placeholder="e.g. Bonga Phase 3"
                  spellCheck
                  disabled={locked}
                  autoFocus={movingProject}
                />
                <datalist id="project-suggestions">
                  {projectSuggestions.map((pName) => (
                    <option key={pName} value={pName} />
                  ))}
                </datalist>
              </Field>
            )}

            {/* Warnings — both live and non-blocking HERE, but colour tracks what
                happens at SUBMIT: amber = advisory (planning past a contract end
                is legitimate; the contract gets extended or re-tendered), red =
                this will be refused (a double-booked rig is physically
                impossible, so submit hard-blocks it with a 409). */}
            {(contractImpactWarning || conflictWarning) && (
              <div className="space-y-1.5">
                {contractImpactWarning && (
                  <div
                    data-testid="contract-impact-warning"
                    className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400"
                  >
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{contractImpactWarning}</span>
                  </div>
                )}
                {conflictWarning && (
                  <div
                    data-testid="conflict-warning"
                    className="flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400"
                  >
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
                terrain={watch("location")}
                locked={locked}
              />
            )}


            <Field label="Comment" error={errors.comment?.message}>
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
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Readiness
              </p>
              {onOpenReadiness && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={onOpenReadiness}
                  title="Every team's checks for this activity — Wells, Logistics…"
                >
                  <ListChecks className="h-3.5 w-3.5" />
                  All teams&apos; readiness
                </Button>
              )}
            </div>
            {/* Gates are per FIELD PROJECT — editing them here updates every activity
                that shares this well's project. */}
            {hasProject ? (
              <p className="text-xs text-muted-foreground">
                Gates apply to the whole{" "}
                <span className="font-medium text-foreground">{activity.well_project}</span>{" "}
                field project — every activity in it shares them.
              </p>
            ) : (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Set a Project for this well to track its readiness gates.
              </p>
            )}
            {locked && hasProject && (
              <p className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                <Lock className="h-3 w-3 shrink-0" />
                The plan is locked, but readiness can still be updated. Changes don&apos;t alter
                what the revision recorded.
              </p>
            )}
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
            <div
              className="grid gap-3 rounded-lg border border-border/70 bg-card/60 p-3"
              style={{ gridTemplateColumns: `repeat(${gates.length}, minmax(0, 1fr))` }}
            >
              {gates.map(({ code, label }) => {
                const status = checkStatuses[code] ?? statusOf(readiness, code);
                return (
                  <div key={code} className="flex flex-col items-center gap-1.5">
                    <div className="flex flex-col items-center gap-0.5">
                      <span className="text-[10px] font-semibold text-foreground/80">
                        {code}
                      </span>
                      <span className="text-[9px] text-muted-foreground line-clamp-1">
                        {label}
                      </span>
                    </div>
                    <ReadinessDot
                      code={code}
                      status={status}
                      disabled={!hasProject}
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
            {locked ? (
              hasProject && (
                <Button type="submit" disabled={savingGates || changedGates.length === 0}>
                  {savingGates ? "Saving…" : "Save readiness"}
                </Button>
              )
            ) : (
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
