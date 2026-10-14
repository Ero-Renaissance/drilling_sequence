import { useMemo, useState } from "react";
import { AlertTriangle, FolderPlus, Loader2, Plus, Trash2 } from "lucide-react";
import {
  planProjectWells,
  type PlannedWellIn,
  type ProjectWellsIn,
  type ProjectWellsPlan,
} from "@/api/activities";
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
import { toast } from "@/components/ui/toaster";
import { suggestedActivityTypes } from "@/lib/chart-colors";
import { cn, formatDate } from "@/lib/utils";
import { LOCATIONS, MARKETS, PLAN_TYPES, RISKS } from "./ActivityFormDialog";

interface WellRow {
  key: number;
  well_name: string;
  activity_type: string;
  resource_type: PlannedWellIn["resource_type"];
  resource_name: string;
  duration_months: string;
}

// Natural order, so "PROJECT_2" sorts before "PROJECT_10".
const natural = (a: string, b: string) =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

let nextKey = 1;
const blankWell = (from?: WellRow): WellRow => ({
  key: nextKey++,
  well_name: "",
  // A new row copies the previous well's activity and rig — the common case.
  activity_type: from?.activity_type ?? "",
  resource_type: from?.resource_type ?? "rig",
  resource_name: from?.resource_name ?? "",
  duration_months: from?.duration_months ?? "2.5",
});

function gapLabel(kind: string, days: number): string {
  switch (kind) {
    case "inter_well":
      return `${days / 7} wk after previous well`;
    case "batch":
      return `${days / 7} wk after 3rd well`;
    case "project_move":
      return `rig move ${days} d after current job`;
    default:
      return "starts on start date";
  }
}

/**
 * "Add project" — a field project and its wells in one go. The project details
 * are set once; each well has its own activity, rig/HWU and duration (months).
 * The server lays the wells out with the rig optimizer's rules — 2 weeks between
 * wells on a rig, 4 weeks after every 3rd, rig-move time if the rig is still busy
 * — and the planner reviews that preview (with any clashes) before creating.
 */
export function AddProjectDialog({
  projectId,
  onCreated,
  locked,
  existingProjects = [],
  existingActivityTypes = [],
  existingRigNames = [],
  existingHwuNames = [],
}: {
  projectId: string;
  onCreated: () => void;
  locked?: boolean;
  existingProjects?: string[];
  existingActivityTypes?: string[];
  existingRigNames?: string[];
  existingHwuNames?: string[];
}) {
  const [open, setOpen] = useState(false);
  const [project, setProject] = useState("");
  const [startDate, setStartDate] = useState("");
  const [location, setLocation] = useState("");
  const [planType, setPlanType] = useState("");
  const [risk, setRisk] = useState("");
  const [market, setMarket] = useState("");
  const [readiness, setReadiness] = useState(true);
  const [wells, setWells] = useState<WellRow[]>(() => [blankWell()]);
  const [plan, setPlan] = useState<ProjectWellsPlan | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState<"preview" | "create" | null>(null);

  const projectSuggestions = useMemo(
    () => [...new Set(existingProjects.filter(Boolean))].sort(natural),
    [existingProjects],
  );
  const typeSuggestions = useMemo(
    () => suggestedActivityTypes(existingActivityTypes),
    [existingActivityTypes],
  );
  const rigSuggestions = useMemo(() => [...new Set(existingRigNames)].sort(natural), [existingRigNames]);
  const hwuSuggestions = useMemo(() => [...new Set(existingHwuNames)].sort(natural), [existingHwuNames]);

  function reset() {
    setProject("");
    setStartDate("");
    setLocation("");
    setPlanType("");
    setRisk("");
    setMarket("");
    setReadiness(true);
    setWells([blankWell()]);
    setPlan(null);
    setErrors([]);
  }

  // Any edit invalidates the preview — the dates must be recomputed.
  function touch<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      setPlan(null);
    };
  }
  const updateWell = (key: number, patch: Partial<WellRow>) => {
    setWells((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setPlan(null);
  };

  function validate(): string[] {
    const problems: string[] = [];
    if (!project.trim()) problems.push("Project name is required.");
    if (!startDate) problems.push("Start date is required.");
    if (!location) problems.push("Location is required.");
    if (!planType) problems.push("Plan type is required.");
    if (!risk) problems.push("Risk is required.");
    const seen = new Set<string>();
    wells.forEach((w, i) => {
      const n = `Well ${i + 1}`;
      if (!w.well_name.trim()) problems.push(`${n}: name is required.`);
      if (!w.activity_type.trim()) problems.push(`${n}: activity is required.`);
      if (w.resource_type !== "none" && !w.resource_name.trim())
        problems.push(`${n}: pick a ${w.resource_type === "hwu" ? "HWU" : "rig"} or choose None.`);
      const months = Number(w.duration_months);
      if (!(months > 0 && months <= 36)) problems.push(`${n}: duration must be 0–36 months.`);
      const key = `${w.well_name.trim()}\u0001${w.activity_type.trim().toLowerCase()}`;
      if (w.well_name.trim() && seen.has(key))
        problems.push(`${n}: ${w.well_name.trim()} is already listed with that activity.`);
      seen.add(key);
    });
    return problems;
  }

  function payload(dryRun: boolean): ProjectWellsIn {
    return {
      well_project: project.trim(),
      start_date: startDate,
      location,
      plan_type: planType,
      risk,
      market: market || null,
      readiness_required: readiness,
      comment: null,
      dry_run: dryRun,
      wells: wells.map((w) => ({
        well_name: w.well_name.trim(),
        activity_type: w.activity_type.trim(),
        resource_type: w.resource_type,
        resource_name: w.resource_type === "none" ? null : w.resource_name.trim(),
        duration_months: Number(w.duration_months),
      })),
    };
  }

  async function preview() {
    const problems = validate();
    setErrors(problems);
    if (problems.length) return;
    setBusy("preview");
    try {
      setPlan(await planProjectWells(projectId, payload(true)));
    } catch (err: unknown) {
      setErrors([err instanceof Error ? err.message : "Failed to preview the wells"]);
    } finally {
      setBusy(null);
    }
  }

  async function create() {
    setBusy("create");
    try {
      const result = await planProjectWells(projectId, payload(false));
      toast.success(`Added ${result.created} well${result.created === 1 ? "" : "s"} to ${project.trim()}`);
      onCreated();
      reset();
      setOpen(false);
    } catch (err: unknown) {
      setErrors([err instanceof Error ? err.message : "Failed to add the wells"]);
    } finally {
      setBusy(null);
    }
  }

  const selectClass =
    "flex h-9 w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring";

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          disabled={locked}
          title={
            locked
              ? "A revision is awaiting approval — the plan is locked."
              : "Add a field project and its wells in one go"
          }
        >
          <FolderPlus className="mr-2 h-4 w-4" />
          Add Project
        </Button>
      </DialogTrigger>

      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Add Project</DialogTitle>
          <DialogDescription>
            Set the project once, then list its wells. The dates are laid out like the Rig
            Optimizer: 2 weeks between wells on a rig, 4 weeks after every 3rd well, and the
            rig-move time if a rig is still busy on the start date. Preview before creating.
          </DialogDescription>
        </DialogHeader>

        {/* The project */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="col-span-2 space-y-1">
            <Label htmlFor="ap-project" className="text-xs">Project *</Label>
            <Input
              id="ap-project"
              value={project}
              onChange={(e) => touch(setProject)(e.target.value)}
              list="ap-project-suggestions"
              placeholder="Type or pick existing"
              maxLength={256}
            />
            <datalist id="ap-project-suggestions">
              {projectSuggestions.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </div>
          <div className="space-y-1">
            <Label htmlFor="ap-start" className="text-xs">Start date *</Label>
            <Input id="ap-start" type="date" value={startDate} onChange={(e) => touch(setStartDate)(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ap-location" className="text-xs">Location *</Label>
            <select id="ap-location" value={location} onChange={(e) => touch(setLocation)(e.target.value)} className={selectClass}>
              <option value="">Select…</option>
              {LOCATIONS.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="ap-plan" className="text-xs">Plan type *</Label>
            <select id="ap-plan" value={planType} onChange={(e) => touch(setPlanType)(e.target.value)} className={selectClass}>
              <option value="">Select…</option>
              {PLAN_TYPES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="ap-risk" className="text-xs">Risk *</Label>
            <select id="ap-risk" value={risk} onChange={(e) => touch(setRisk)(e.target.value)} className={selectClass}>
              <option value="">Select…</option>
              {RISKS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="ap-market" className="text-xs">Market</Label>
            <select id="ap-market" value={market} onChange={(e) => touch(setMarket)(e.target.value)} className={selectClass}>
              <option value="">Select…</option>
              {MARKETS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <label className="flex items-end gap-2 pb-2 text-xs">
            <input
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={readiness}
              onChange={(e) => touch(setReadiness)(e.target.checked)}
            />
            Readiness check required
          </label>
        </div>

        {/* The wells */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Wells</h3>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={wells.length >= 50}
              onClick={() => {
                setWells((rows) => [...rows, blankWell(rows[rows.length - 1])]);
                setPlan(null);
              }}
            >
              <Plus className="h-3.5 w-3.5" />
              Add well
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="w-8 py-1 pr-2">#</th>
                  <th className="py-1 pr-2">Well name</th>
                  <th className="py-1 pr-2">Activity</th>
                  <th className="py-1 pr-2">Resource</th>
                  <th className="w-24 py-1 pr-2">Months</th>
                  <th className="w-8 py-1" />
                </tr>
              </thead>
              <tbody>
                {wells.map((w, i) => (
                  <tr key={w.key}>
                    <td className="py-1 pr-2 text-xs tabular-nums text-muted-foreground">{i + 1}</td>
                    <td className="py-1 pr-2">
                      <Input
                        aria-label={`Well ${i + 1} name`}
                        value={w.well_name}
                        onChange={(e) => updateWell(w.key, { well_name: e.target.value })}
                        placeholder="Well-A1"
                        maxLength={256}
                      />
                    </td>
                    <td className="py-1 pr-2">
                      <Input
                        aria-label={`Well ${i + 1} activity`}
                        value={w.activity_type}
                        onChange={(e) => updateWell(w.key, { activity_type: e.target.value })}
                        list="ap-type-suggestions"
                        placeholder="Type or pick"
                        maxLength={256}
                      />
                    </td>
                    <td className="py-1 pr-2">
                      <div className="flex gap-1.5">
                        <select
                          aria-label={`Well ${i + 1} resource type`}
                          value={w.resource_type}
                          onChange={(e) =>
                            updateWell(w.key, {
                              resource_type: e.target.value as WellRow["resource_type"],
                              ...(e.target.value === "none" ? { resource_name: "" } : {}),
                            })
                          }
                          className={cn(selectClass, "w-20 shrink-0")}
                        >
                          <option value="rig">Rig</option>
                          <option value="hwu">HWU</option>
                          <option value="none">None</option>
                        </select>
                        <Input
                          aria-label={`Well ${i + 1} resource name`}
                          value={w.resource_name}
                          disabled={w.resource_type === "none"}
                          onChange={(e) => updateWell(w.key, { resource_name: e.target.value })}
                          list={w.resource_type === "hwu" ? "ap-hwu-suggestions" : "ap-rig-suggestions"}
                          placeholder={w.resource_type === "hwu" ? "Pick an HWU" : "Pick a rig"}
                          className="min-w-0"
                          maxLength={256}
                        />
                      </div>
                    </td>
                    <td className="py-1 pr-2">
                      <Input
                        aria-label={`Well ${i + 1} duration in months`}
                        type="number"
                        min={0.1}
                        max={36}
                        step={0.1}
                        value={w.duration_months}
                        onChange={(e) => updateWell(w.key, { duration_months: e.target.value })}
                      />
                    </td>
                    <td className="py-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        aria-label={`Remove well ${i + 1}`}
                        disabled={wells.length === 1}
                        onClick={() => {
                          setWells((rows) => rows.filter((r) => r.key !== w.key));
                          setPlan(null);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <datalist id="ap-type-suggestions">
            {typeSuggestions.map((t) => <option key={t} value={t} />)}
          </datalist>
          <datalist id="ap-rig-suggestions">
            {rigSuggestions.map((r) => <option key={r} value={r} />)}
          </datalist>
          <datalist id="ap-hwu-suggestions">
            {hwuSuggestions.map((h) => <option key={h} value={h} />)}
          </datalist>
        </div>

        {errors.length > 0 && (
          <ul className="space-y-0.5 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">
            {errors.map((e) => <li key={e}>{e}</li>)}
          </ul>
        )}

        {/* The preview */}
        {plan && (
          <section aria-label="Preview" className="space-y-2 rounded-lg border border-border/70 p-3">
            <h3 className="text-sm font-semibold">Preview</h3>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="py-1 pr-2">Well</th>
                  <th className="py-1 pr-2">Resource</th>
                  <th className="py-1 pr-2">Start</th>
                  <th className="py-1 pr-2">End</th>
                  <th className="py-1">Why this start</th>
                </tr>
              </thead>
              <tbody>
                {plan.wells.map((p) => (
                  <tr key={`${p.well_name}\u0001${p.activity_type}`} className="border-t border-border/40">
                    <td className="py-1 pr-2">
                      <span className="font-medium">{p.well_name}</span>{" "}
                      <span className="text-muted-foreground">{p.activity_type}</span>
                    </td>
                    <td className="py-1 pr-2">{p.rig_name ?? (p.hwu_name ? `HWU · ${p.hwu_name}` : "—")}</td>
                    <td className="py-1 pr-2 tabular-nums">{formatDate(p.start_date)}</td>
                    <td className="py-1 pr-2 tabular-nums">{formatDate(p.end_date)}</td>
                    <td className="py-1 text-muted-foreground">{gapLabel(p.gap_kind, p.gap_before_days)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {plan.conflicts.length > 0 && (
              <div className="space-y-1 rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                <p className="flex items-center gap-1.5 font-medium">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {plan.conflicts.length} clash{plan.conflicts.length === 1 ? "" : "es"} with work already on these rigs —
                  adjust the start date or rigs, or fix them after creating.
                </p>
                <ul className="list-disc pl-5">
                  {plan.conflicts.map((c) => (
                    <li key={`${c.well_name}-${c.clashes_with}`}>
                      {c.well_name} overlaps {c.clashes_with} on {c.resource} by {c.overlap_days} days
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="button" variant="outline" onClick={preview} disabled={busy !== null}>
            {busy === "preview" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Preview
          </Button>
          <Button
            type="button"
            onClick={create}
            disabled={!plan || busy !== null}
            title={plan ? undefined : "Preview the dates first"}
          >
            {busy === "create" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {plan ? `Create ${plan.wells.length} well${plan.wells.length === 1 ? "" : "s"}` : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
