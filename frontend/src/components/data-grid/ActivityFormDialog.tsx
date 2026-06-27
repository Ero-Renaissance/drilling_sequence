import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createActivity, type Activity } from "@/api/activities";
import { suggestedActivityTypes } from "@/lib/chart-colors";
import { cn } from "@/lib/utils";

const LOCATIONS = ["LAND", "SWAMP", "OFFSHORE"] as const;
const PLAN_TYPES = ["Firm", "Option", "Out of Plan"] as const;
const RISKS = ["Flood Risk", "No Flood Risk"] as const;

const schema = z
  .object({
    activity_type: z.string().min(1, "Required"),
    start_date: z.string().min(1, "Required"),
    end_date: z.string().min(1, "Required"),
    well_name: z.string().optional(),
    resource_type: z.enum(["Rig", "HWU"]),
    resource_name: z.string().optional(),
    location: z.string().optional(),
    plan_type: z.string().optional(),
    risk: z.string().optional(),
    comment: z.string().optional(),
    readiness_required: z.boolean(),
  })
  .refine((d) => !d.start_date || !d.end_date || d.end_date >= d.start_date, {
    message: "End date must be on or after start date",
    path: ["end_date"],
  });

type FormValues = z.infer<typeof schema>;

interface ActivityFormDialogProps {
  projectId: string;
  onCreated: (activity: Activity) => void;
  /** Existing activity types in the project — fed into the Activity Type combobox. */
  existingActivityTypes?: string[];
  /** Existing rigs in the project — fed into the resource combobox. */
  existingRigNames?: string[];
  /** Existing HWUs in the project — fed into the resource combobox. */
  existingHwuNames?: string[];
}

function Field({
  label,
  htmlFor,
  error,
  children,
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={htmlFor} className="text-xs font-medium text-slate-600">{label}</Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

export function ActivityFormDialog({
  projectId,
  onCreated,
  existingActivityTypes,
  existingRigNames,
  existingHwuNames,
}: ActivityFormDialogProps) {
  const [open, setOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const activityTypeSuggestions = useMemo(
    () => suggestedActivityTypes(existingActivityTypes ?? []),
    [existingActivityTypes],
  );
  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { readiness_required: true, resource_type: "Rig" },
  });
  const watchedResourceType = watch("resource_type");

  // Suggestions for the resource-name field, switching by the chosen type.
  const resourceSuggestions = useMemo(
    () =>
      Array.from(
        new Set((watchedResourceType === "HWU" ? existingHwuNames : existingRigNames) ?? []),
      ).sort(),
    [existingRigNames, existingHwuNames, watchedResourceType],
  );

  async function onSubmit(values: FormValues) {
    setServerError(null);
    try {
      const activity = await createActivity(projectId, {
        activity_type: values.activity_type,
        start_date: values.start_date,
        end_date: values.end_date,
        well_name: values.well_name || null,
        rig_name: values.resource_type === "Rig" ? values.resource_name || null : null,
        hwu_name: values.resource_type === "HWU" ? values.resource_name || null : null,
        location: values.location || null,
        plan_type: values.plan_type || null,
        risk: values.risk || null,
        comment: values.comment || null,
        readiness_required: values.readiness_required,
      });
      onCreated(activity);
      reset();
      setOpen(false);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Failed to create activity");
    }
  }

  function handleOpenChange(val: boolean) {
    setOpen(val);
    if (!val) { reset(); setServerError(null); }
  }

  const selectClass =
    "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-2 h-4 w-4" />
          Add Activity
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add Activity</DialogTitle>
          <DialogDescription>
            Fill in the required fields. You can edit all other details inline in the table.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 py-2">
          {/* Required row */}
          <div className="grid grid-cols-3 gap-3">
            <Field label="Activity Type *" htmlFor="activity_type" error={errors.activity_type?.message}>
              <Input
                id="activity_type"
                {...register("activity_type")}
                list="add-activity-type-suggestions"
                placeholder="Type or pick existing"
                spellCheck
              />
              <datalist id="add-activity-type-suggestions">
                {activityTypeSuggestions.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </Field>
            <Field label="Start Date *" htmlFor="start_date" error={errors.start_date?.message}>
              <Input id="start_date" type="date" {...register("start_date")} />
            </Field>
            <Field label="End Date *" htmlFor="end_date" error={errors.end_date?.message}>
              <Input id="end_date" type="date" {...register("end_date")} />
            </Field>
          </div>

          {/* Optional row 1 */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Well Name" error={errors.well_name?.message}>
              <Input
                {...register("well_name")}
                placeholder="Well-A1"
                spellCheck
              />
            </Field>
            <Field label="Resource" error={errors.resource_name?.message}>
              <div className="flex gap-2">
                <select
                  {...register("resource_type")}
                  className={cn(selectClass, "w-24 shrink-0")}
                >
                  <option value="Rig">Rig</option>
                  <option value="HWU">HWU</option>
                </select>
                <Input
                  {...register("resource_name")}
                  placeholder={watchedResourceType === "HWU" ? "Pick an HWU" : "Pick a rig"}
                  list="add-resource-suggestions"
                  spellCheck
                  className="min-w-0 flex-1"
                />
                <datalist id="add-resource-suggestions">
                  {resourceSuggestions.map((n) => (
                    <option key={n} value={n} />
                  ))}
                </datalist>
              </div>
            </Field>
          </div>

          {/* Optional row 2 */}
          <div className="grid grid-cols-3 gap-3">
            <Field label="Location">
              <select {...register("location")} className={selectClass}>
                <option value="">—</option>
                {LOCATIONS.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </Field>
            <Field label="Plan Type">
              <select {...register("plan_type")} className={selectClass}>
                <option value="">—</option>
                {PLAN_TYPES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>
            <Field label="Risk">
              <select {...register("risk")} className={selectClass}>
                <option value="">—</option>
                {RISKS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </Field>
          </div>

          {/* Comment */}
          <Field label="Comment" error={errors.comment?.message}>
            <Input
              {...register("comment")}
              placeholder="Optional note…"
              spellCheck
            />
          </Field>

          {/* Readiness opt-out — checked by default. When off, this activity
              shows no readiness gates on the chart or print-out. */}
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-input"
              {...register("readiness_required")}
            />
            <span className="font-medium">Readiness check required</span>
            <span className="text-xs text-muted-foreground">
              — off hides the readiness gates on the chart &amp; print
            </span>
          </label>

          {serverError && (
            <p className="text-sm text-destructive" role="alert">{serverError}</p>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : "Add Activity"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// Re-export so consumers can use without importing directly
export { LOCATIONS, PLAN_TYPES, RISKS };
