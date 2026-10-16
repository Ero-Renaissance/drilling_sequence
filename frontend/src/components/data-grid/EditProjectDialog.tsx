import { useMemo, useRef, useState } from "react";
import { ClipboardCheck, Loader2, Lock, Plus, Trash2, Undo2 } from "lucide-react";
import {
  editProjectWells,
  type Activity,
  type EditedWellIn,
  type ProjectWellsEditIn,
  type ProjectWellsEditPlan,
} from "@/api/activities";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toaster";
import { cn, formatDate } from "@/lib/utils";
import { LOCATIONS, MARKETS, PLAN_TYPES, RISKS } from "./ActivityFormDialog";
import {
  ConflictList,
  ResourceInputs,
  WellDatalists,
  gapLabel,
  natural,
  resourceText,
  selectClass,
  useProjectSuggestions,
  type ResourceType,
} from "./project-dialog-shared";

/** A project-level field whose wells disagree — left as each well has it. */
const MIXED = "__mixed__";
const DAYS_PER_MONTH = 30.44; // the optimizer's month length, as on the server

interface EditRow {
  key: number;
  /** null → a new well (placed by the gap rules on preview). */
  id: string | null;
  updatedAt: string | null;
  completed: boolean;
  removed: boolean;
  /** The well's name + activity as loaded (null for a new row) — wells that
   *  already shared them may keep doing so. */
  original: { well_name: string; activity_type: string } | null;
  well_name: string;
  activity_type: string;
  resource_type: ResourceType;
  resource_name: string;
  start_date: string;
  end_date: string;
  duration_months: string;
}

let nextKey = 1;

function fromActivity(a: Activity): EditRow {
  return {
    key: nextKey++,
    id: a.id,
    updatedAt: a.updated_at,
    completed: a.completed_at != null,
    removed: false,
    original: { well_name: a.well_name ?? "", activity_type: a.activity_type },
    well_name: a.well_name ?? "",
    activity_type: a.activity_type,
    resource_type: a.rig_name ? "rig" : a.hwu_name ? "hwu" : "none",
    resource_name: a.rig_name ?? a.hwu_name ?? "",
    start_date: a.start_date,
    end_date: a.end_date,
    duration_months: "",
  };
}

function newRow(from?: EditRow): EditRow {
  return {
    key: nextKey++,
    id: null,
    updatedAt: null,
    completed: false,
    removed: false,
    original: null,
    well_name: "",
    // A new row copies the previous well's activity and rig — the common case.
    activity_type: from?.activity_type ?? "",
    resource_type: from?.resource_type ?? "rig",
    resource_name: from?.resource_name ?? "",
    start_date: "",
    end_date: "",
    duration_months: "2.5",
  };
}

/** The wells' shared value of a field: "" when none has one, MIXED when they differ. */
function common(wells: Activity[], get: (a: Activity) => string | null | undefined): string {
  const values = new Set(wells.map((a) => get(a) ?? ""));
  return values.size === 1 ? [...values][0] : MIXED;
}

function monthsBetween(start: string, end: string): string {
  const days = (Date.parse(end) - Date.parse(start)) / 86_400_000;
  return Number.isFinite(days) && days >= 0 ? `≈ ${(days / DAYS_PER_MONTH).toFixed(1)} mo` : "";
}

const CHANGE_BADGE: Record<string, { text: string; className: string }> = {
  new: { text: "New", className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  changed: { text: "Changed", className: "bg-sky-500/15 text-sky-700 dark:text-sky-300" },
};

/**
 * The project dialog in edit mode: a field project and all its wells, opened
 * from the project's name (the chart's project tag, the grid's Project column).
 * Existing wells keep their dates unless changed here; new wells chain after the
 * project's last well on their rig; "Re-sequence" lays them all out again. The
 * save is all or nothing, after a preview. Read-only for non-planners and while
 * the plan is locked.
 */
export function EditProjectDialog({
  projectId,
  projectName,
  activities,
  canEdit,
  readOnlyReason,
  open,
  onOpenChange,
  onSaved,
  onOpenReadiness,
}: {
  projectId: string;
  projectName: string;
  /** Every activity in the campaign — the project's wells are picked from it. */
  activities: Activity[];
  canEdit: boolean;
  /** Why it is read-only (shown in the banner when `canEdit` is false). */
  readOnlyReason?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  /** Open one well's Readiness panel (closes this dialog). */
  onOpenReadiness?: (activityId: string) => void;
}) {
  const projectWells = useMemo(
    () =>
      activities
        .filter((a) => a.well_project === projectName)
        .sort((a, b) =>
          a.start_date === b.start_date
            ? natural(a.well_name ?? "", b.well_name ?? "")
            : a.start_date.localeCompare(b.start_date),
        ),
    [activities, projectName],
  );
  const suggestions = useProjectSuggestions({
    existingActivityTypes: useMemo(() => activities.map((a) => a.activity_type), [activities]),
    existingRigNames: useMemo(
      () => activities.map((a) => a.rig_name).filter((n): n is string => !!n),
      [activities],
    ),
    existingHwuNames: useMemo(
      () => activities.map((a) => a.hwu_name).filter((n): n is string => !!n),
      [activities],
    ),
  });

  // The project's details as loaded — a field is sent only when changed.
  const [initial] = useState(() => ({
    location: common(projectWells, (a) => a.location),
    planType: common(projectWells, (a) => a.plan_type),
    risk: common(projectWells, (a) => a.risk),
    market: common(projectWells, (a) => a.market),
    readiness: common(projectWells, (a) => (a.readiness_required === false ? "no" : "yes")),
    start: projectWells.find((a) => a.completed_at == null)?.start_date ?? "",
  }));
  const [name, setName] = useState(projectName);
  const [location, setLocation] = useState(initial.location);
  const [planType, setPlanType] = useState(initial.planType);
  const [risk, setRisk] = useState(initial.risk);
  const [market, setMarket] = useState(initial.market);
  const [readiness, setReadiness] = useState(initial.readiness);
  const [rows, setRows] = useState<EditRow[]>(() => projectWells.map(fromActivity));
  const [layout, setLayout] = useState<"keep" | "resequence">("keep");
  const [resequenceStart, setResequenceStart] = useState(initial.start);
  const [plan, setPlan] = useState<ProjectWellsEditPlan | null>(null);
  const [confirmRemoval, setConfirmRemoval] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState<"preview" | "save" | null>(null);
  // Bumped by every edit: a preview answered after a later edit is discarded,
  // and Save sends exactly the request that was previewed (never newer edits).
  const generation = useRef(0);
  const previewed = useRef<ProjectWellsEditIn | null>(null);

  const readOnly = !canEdit;
  const kept = rows.filter((r) => !r.removed);

  // Any edit invalidates the preview — dates and clashes must be recomputed.
  function changed() {
    generation.current += 1;
    previewed.current = null;
    setPlan(null);
    setConfirmRemoval(false);
    setDirty(true);
  }
  function touch<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      changed();
    };
  }
  const updateRow = (key: number, patch: Partial<EditRow>) => {
    setRows((all) => all.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    changed();
  };

  function validate(): string[] {
    const problems: string[] = [];
    if (!name.trim()) problems.push("Project name is required.");
    if (kept.length === 0) problems.push("Keep at least one well.");
    if (layout === "resequence" && !resequenceStart)
      problems.push("Pick the date to re-sequence from.");
    const byKey = new Map<string, EditRow[]>();
    rows.forEach((r, i) => {
      if (r.removed) return;
      const n = `Well ${i + 1}`;
      if (!r.well_name.trim()) problems.push(`${n}: name is required.`);
      if (!r.activity_type.trim()) problems.push(`${n}: activity is required.`);
      if (r.resource_type !== "none" && !r.resource_name.trim())
        problems.push(`${n}: pick a ${r.resource_type === "hwu" ? "HWU" : "rig"} or choose None.`);
      if (r.id) {
        if (!r.start_date || !r.end_date) problems.push(`${n}: start and end dates are required.`);
        else if (r.end_date < r.start_date) problems.push(`${n}: the end is before the start.`);
      } else {
        const months = Number(r.duration_months);
        if (!(months > 0 && months <= 36)) problems.push(`${n}: duration must be 0–36 months.`);
      }
      const key = `${r.well_name.trim()}\u0001${r.activity_type.trim().toLowerCase()}`;
      if (r.well_name.trim()) byKey.set(key, [...(byKey.get(key) ?? []), r]);
    });
    // One well + activity per row — except wells that already shared them.
    const unchanged = (r: EditRow) =>
      !!r.original &&
      r.original.well_name === r.well_name.trim() &&
      r.original.activity_type.toLowerCase() === r.activity_type.trim().toLowerCase();
    for (const sharing of byKey.values()) {
      if (sharing.length > 1 && !sharing.every(unchanged)) {
        problems.push(`${sharing[0].well_name.trim()} is listed twice with that activity.`);
      }
    }
    return problems;
  }

  function payload(dryRun: boolean): ProjectWellsEditIn {
    const body: ProjectWellsEditIn = {
      well_project: projectName,
      wells: [],
      removed: [],
      layout,
      dry_run: dryRun,
    };
    if (name.trim() !== projectName) body.new_name = name.trim();
    // Only what changed; MIXED (or a blank required field) leaves each well's own.
    if (location !== initial.location && location && location !== MIXED) body.location = location;
    if (planType !== initial.planType && planType && planType !== MIXED) body.plan_type = planType;
    if (risk !== initial.risk && risk && risk !== MIXED) body.risk = risk;
    if (market !== initial.market && market !== MIXED) body.market = market || null;
    if (readiness !== initial.readiness && readiness !== MIXED)
      body.readiness_required = readiness === "yes";
    if (layout === "resequence") body.start_date = resequenceStart;
    for (const r of rows) {
      if (r.removed) {
        if (r.id && r.updatedAt) body.removed.push({ id: r.id, expected_updated_at: r.updatedAt });
        continue;
      }
      const well: EditedWellIn = {
        well_name: r.well_name.trim(),
        activity_type: r.activity_type.trim(),
        resource_type: r.resource_type,
        resource_name: r.resource_type === "none" ? null : r.resource_name.trim(),
      };
      if (r.id && r.updatedAt) {
        well.id = r.id;
        well.expected_updated_at = r.updatedAt;
        well.start_date = r.start_date;
        well.end_date = r.end_date;
      } else {
        well.duration_months = Number(r.duration_months);
      }
      body.wells.push(well);
    }
    return body;
  }

  async function preview() {
    const problems = validate();
    setErrors(problems);
    if (problems.length) return;
    setBusy("preview");
    const asked = generation.current;
    const body = payload(true);
    try {
      const result = await editProjectWells(projectId, body);
      if (asked !== generation.current) return; // edited meanwhile — out of date
      previewed.current = body;
      setPlan(result);
    } catch (err: unknown) {
      if (asked !== generation.current) return;
      setErrors([err instanceof Error ? err.message : "Failed to preview the changes"]);
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    const body = previewed.current;
    if (!body) return;
    setBusy("save");
    try {
      // Exactly what the preview showed (and the deletion confirmed).
      const result = await editProjectWells(projectId, { ...body, dry_run: false });
      toast.success(`Saved ${result.well_project}`);
      onSaved();
      onOpenChange(false);
    } catch (err: unknown) {
      setErrors([err instanceof Error ? err.message : "Failed to save the project"]);
      setPlan(null);
    } finally {
      setBusy(null);
    }
  }

  const nothingToSave =
    !!plan &&
    plan.removed.length === 0 &&
    plan.wells.every((w) => w.change === "unchanged");
  const needsConfirm = !!plan && plan.removed.length > 0 && !confirmRemoval;

  // A project-level select: its values, plus "Mixed" while the wells disagree.
  function projectSelect(
    id: string,
    label: string,
    value: string,
    setter: (v: string) => void,
    options: readonly (string | { value: string; label: string })[],
    wasMixed: boolean,
    blank?: string,
  ) {
    return (
      <div className="space-y-1">
        <Label htmlFor={id} className="text-xs">{label}</Label>
        <select
          id={id}
          value={value}
          disabled={readOnly}
          onChange={(e) => touch(setter)(e.target.value)}
          className={selectClass}
        >
          {wasMixed && <option value={MIXED}>Mixed — keep each well's</option>}
          {blank !== undefined && <option value="">{blank}</option>}
          {options.map((o) =>
            typeof o === "string" ? (
              <option key={o} value={o}>{o}</option>
            ) : (
              <option key={o.value} value={o.value}>{o.label}</option>
            ),
          )}
        </select>
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{readOnly ? "Project" : "Edit Project"} — {projectName}</DialogTitle>
          <DialogDescription>
            {readOnly
              ? `${projectWells.length} well${projectWells.length === 1 ? "" : "s"} in this project.`
              : "Change the project and its wells, then preview and save. Existing wells keep their dates unless you change them; new wells follow the Rig Optimizer gaps after the project's last well on their rig."}
          </DialogDescription>
        </DialogHeader>

        {readOnly && (
          <p className="flex items-center gap-1.5 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
            <Lock className="h-3.5 w-3.5" />
            {readOnlyReason ?? "View only."}
          </p>
        )}

        {/* The project */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="col-span-2 space-y-1">
            <Label htmlFor="ep-project" className="text-xs">Project *</Label>
            <Input
              id="ep-project"
              value={name}
              disabled={readOnly}
              onChange={(e) => touch(setName)(e.target.value)}
              maxLength={256}
            />
          </div>
          {projectSelect("ep-location", "Location", location, setLocation, LOCATIONS, initial.location === MIXED, initial.location === "" ? "Select…" : undefined)}
          {projectSelect("ep-plan", "Plan type", planType, setPlanType, PLAN_TYPES, initial.planType === MIXED, initial.planType === "" ? "Select…" : undefined)}
          {projectSelect("ep-risk", "Risk", risk, setRisk, RISKS, initial.risk === MIXED, initial.risk === "" ? "Select…" : undefined)}
          {projectSelect("ep-market", "Market", market, setMarket, MARKETS, initial.market === MIXED, "None")}
          {projectSelect(
            "ep-readiness",
            "Readiness check",
            readiness,
            setReadiness,
            [
              { value: "yes", label: "Required" },
              { value: "no", label: "Not required" },
            ],
            initial.readiness === MIXED,
          )}
        </div>

        {/* The wells */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Wells</h3>
            {!readOnly && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={kept.length >= 100}
                onClick={() => {
                  setRows((all) => {
                    const listed = all.filter((r) => !r.removed);
                    return [...all, newRow(listed[listed.length - 1])];
                  });
                  changed();
                }}
              >
                <Plus className="h-3.5 w-3.5" />
                Add well
              </Button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="w-8 py-1 pr-2">#</th>
                  <th className="py-1 pr-2">Well name</th>
                  <th className="py-1 pr-2">Activity</th>
                  <th className="py-1 pr-2">Resource</th>
                  <th className="w-36 py-1 pr-2">Start</th>
                  <th className="w-36 py-1 pr-2">End</th>
                  <th className="w-20 py-1 pr-2">Months</th>
                  <th className="w-16 py-1" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const label = `Well ${i + 1}`;
                  const locked = readOnly || r.completed || r.removed;
                  return (
                    <tr key={r.key} className={cn(r.removed && "opacity-50 [&_input]:line-through")}>
                      <td className="py-1 pr-2 text-xs tabular-nums text-muted-foreground">{i + 1}</td>
                      <td className="py-1 pr-2">
                        <Input
                          aria-label={`${label} name`}
                          value={r.well_name}
                          disabled={locked}
                          onChange={(e) => updateRow(r.key, { well_name: e.target.value })}
                          placeholder="Well-A1"
                          maxLength={256}
                        />
                        {r.completed && (
                          <span className="mt-0.5 inline-block text-[10px] font-medium text-muted-foreground">
                            Completed — only the project's details change
                          </span>
                        )}
                      </td>
                      <td className="py-1 pr-2">
                        <Input
                          aria-label={`${label} activity`}
                          value={r.activity_type}
                          disabled={locked}
                          onChange={(e) => updateRow(r.key, { activity_type: e.target.value })}
                          list="ep-type-suggestions"
                          placeholder="Type or pick"
                          maxLength={256}
                        />
                      </td>
                      <td className="py-1 pr-2">
                        <ResourceInputs
                          label={label}
                          prefix="ep"
                          type={r.resource_type}
                          name={r.resource_name}
                          disabled={locked}
                          onChange={(patch) => updateRow(r.key, patch)}
                        />
                      </td>
                      {r.id ? (
                        <>
                          <td className="py-1 pr-2">
                            <Input
                              aria-label={`${label} start`}
                              type="date"
                              value={r.start_date}
                              disabled={locked}
                              onChange={(e) => updateRow(r.key, { start_date: e.target.value })}
                            />
                          </td>
                          <td className="py-1 pr-2">
                            <Input
                              aria-label={`${label} end`}
                              type="date"
                              value={r.end_date}
                              disabled={locked}
                              onChange={(e) => updateRow(r.key, { end_date: e.target.value })}
                            />
                          </td>
                          <td className="py-1 pr-2 text-xs tabular-nums text-muted-foreground">
                            {monthsBetween(r.start_date, r.end_date)}
                          </td>
                        </>
                      ) : (
                        <>
                          <td colSpan={2} className="py-1 pr-2 text-xs text-muted-foreground">
                            Placed by the gap rules on preview
                          </td>
                          <td className="py-1 pr-2">
                            <Input
                              aria-label={`${label} duration in months`}
                              type="number"
                              min={0.1}
                              max={36}
                              step={0.1}
                              value={r.duration_months}
                              onChange={(e) => updateRow(r.key, { duration_months: e.target.value })}
                            />
                          </td>
                        </>
                      )}
                      <td className="py-1">
                        <div className="flex justify-end">
                          {r.id && onOpenReadiness && !r.removed && (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              aria-label={`Open readiness for ${r.well_name || label}`}
                              title={dirty ? "Save or cancel your changes first" : "Open this well's Readiness panel"}
                              disabled={dirty}
                              onClick={() => onOpenReadiness(r.id!)}
                            >
                              <ClipboardCheck className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          {!readOnly && !r.completed && (
                            r.removed ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                aria-label={`Keep ${r.well_name || label}`}
                                title="Keep this well"
                                onClick={() => updateRow(r.key, { removed: false })}
                              >
                                <Undo2 className="h-3.5 w-3.5" />
                              </Button>
                            ) : (
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                aria-label={`Remove ${r.well_name || label}`}
                                title={r.id ? "Remove this well (deleted on save)" : "Remove this row"}
                                disabled={kept.length === 1}
                                onClick={() => {
                                  if (r.id) updateRow(r.key, { removed: true });
                                  else {
                                    setRows((all) => all.filter((x) => x.key !== r.key));
                                    changed();
                                  }
                                }}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            )
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <WellDatalists prefix="ep" types={suggestions.types} rigs={suggestions.rigs} hwus={suggestions.hwus} />
        </div>

        {/* Dates: keep them, or lay every open well out again */}
        {!readOnly && (
          <fieldset className="space-y-1.5 rounded-md border border-border/70 px-3 py-2 text-xs">
            <legend className="px-1 text-xs font-semibold">Dates</legend>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="ep-layout"
                className="accent-primary"
                checked={layout === "keep"}
                onChange={() => touch(setLayout)("keep")}
              />
              Keep each well's dates (new wells follow the project's last well on their rig)
            </label>
            <label className="flex flex-wrap items-center gap-2">
              <input
                type="radio"
                name="ep-layout"
                className="accent-primary"
                checked={layout === "resequence"}
                onChange={() => touch(setLayout)("resequence")}
              />
              Re-sequence every open well, in this order, from
              <Input
                aria-label="Re-sequence from"
                type="date"
                value={resequenceStart}
                disabled={layout !== "resequence"}
                onChange={(e) => touch(setResequenceStart)(e.target.value)}
                className="h-7 w-40"
              />
              <span className="text-muted-foreground">(durations kept; completed wells stay put)</span>
            </label>
          </fieldset>
        )}

        {errors.length > 0 && (
          <ul className="space-y-0.5 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">
            {errors.map((e) => <li key={e}>{e}</li>)}
          </ul>
        )}

        {/* The preview */}
        {plan && (
          <section aria-label="Preview" className="space-y-2 rounded-lg border border-border/70 p-3">
            <h3 className="text-sm font-semibold">
              Preview{plan.well_project !== projectName ? ` — renamed to ${plan.well_project}` : ""}
            </h3>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="py-1 pr-2">Well</th>
                  <th className="py-1 pr-2">Resource</th>
                  <th className="py-1 pr-2">Start</th>
                  <th className="py-1 pr-2">End</th>
                  <th className="py-1 pr-2">Change</th>
                  <th className="py-1">Why this start</th>
                </tr>
              </thead>
              <tbody>
                {plan.wells.map((w) => (
                  <tr key={`${w.well_name}\u0001${w.activity_type}`} className="border-t border-border/40">
                    <td className="py-1 pr-2">
                      <span className="font-medium">{w.well_name}</span>{" "}
                      <span className="text-muted-foreground">{w.activity_type}</span>
                    </td>
                    <td className="py-1 pr-2">{resourceText(w.rig_name, w.hwu_name)}</td>
                    <td className="py-1 pr-2 tabular-nums">{formatDate(w.start_date)}</td>
                    <td className="py-1 pr-2 tabular-nums">{formatDate(w.end_date)}</td>
                    <td className="py-1 pr-2">
                      {CHANGE_BADGE[w.change] ? (
                        <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", CHANGE_BADGE[w.change].className)}>
                          {CHANGE_BADGE[w.change].text}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="py-1 text-muted-foreground">{gapLabel(w.gap_kind, w.gap_before_days)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {plan.removed.length > 0 && (
              <label className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 accent-destructive"
                  checked={confirmRemoval}
                  onChange={(e) => setConfirmRemoval(e.target.checked)}
                />
                <span>
                  Delete {plan.removed.length} well{plan.removed.length === 1 ? "" : "s"} from the plan:{" "}
                  {plan.removed.map((r) => `${r.well_name ?? "—"} (${r.activity_type})`).join(", ")}.
                </span>
              </label>
            )}
            <ConflictList
              conflicts={plan.conflicts}
              hint="on these rigs — adjust the dates or rigs, or fix them after saving."
            />
          </section>
        )}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {readOnly ? "Close" : "Cancel"}
          </Button>
          {!readOnly && (
            <>
              <Button type="button" variant="outline" onClick={preview} disabled={busy !== null}>
                {busy === "preview" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Preview
              </Button>
              <Button
                type="button"
                onClick={save}
                disabled={!plan || busy !== null || nothingToSave || needsConfirm}
                title={
                  !plan
                    ? "Preview the changes first"
                    : nothingToSave
                      ? "Nothing has changed"
                      : needsConfirm
                        ? "Confirm the wells to delete first"
                        : undefined
                }
              >
                {busy === "save" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Save changes
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
