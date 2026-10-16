import { useMemo } from "react";
import { AlertTriangle } from "lucide-react";
import type { PlanConflict, PlannedWellIn } from "@/api/activities";
import { Input } from "@/components/ui/input";
import { suggestedActivityTypes } from "@/lib/chart-colors";
import { cn } from "@/lib/utils";

/** Pieces shared by the project dialog's two modes — Add Project and Edit
 *  Project — so both read and behave the same. */

export type ResourceType = PlannedWellIn["resource_type"];

// Natural order, so "PROJECT_2" sorts before "PROJECT_10".
export const natural = (a: string, b: string) =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

export const selectClass =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

/** Why a well starts when it does, for the preview table. */
export function gapLabel(kind: string, days: number): string {
  switch (kind) {
    case "inter_well":
      return `${days / 7} wk after previous well`;
    case "batch":
      return `${days / 7} wk after 3rd well`;
    case "project_move":
      return `rig move ${days} d after current job`;
    case "kept":
      return "dates kept";
    default:
      return "starts on start date";
  }
}

export interface SuggestionSources {
  existingProjects?: string[];
  existingActivityTypes?: string[];
  existingRigNames?: string[];
  existingHwuNames?: string[];
}

/** Sorted, de-duplicated suggestions for the dialog's datalists. */
export function useProjectSuggestions({
  existingProjects = [],
  existingActivityTypes = [],
  existingRigNames = [],
  existingHwuNames = [],
}: SuggestionSources) {
  return {
    projects: useMemo(
      () => [...new Set(existingProjects.filter(Boolean))].sort(natural),
      [existingProjects],
    ),
    types: useMemo(() => suggestedActivityTypes(existingActivityTypes), [existingActivityTypes]),
    rigs: useMemo(() => [...new Set(existingRigNames)].sort(natural), [existingRigNames]),
    hwus: useMemo(() => [...new Set(existingHwuNames)].sort(natural), [existingHwuNames]),
  };
}

/** The activity / rig / HWU datalists, ids prefixed per dialog. */
export function WellDatalists({
  prefix,
  types,
  rigs,
  hwus,
}: {
  prefix: string;
  types: string[];
  rigs: string[];
  hwus: string[];
}) {
  return (
    <>
      <datalist id={`${prefix}-type-suggestions`}>
        {types.map((t) => <option key={t} value={t} />)}
      </datalist>
      <datalist id={`${prefix}-rig-suggestions`}>
        {rigs.map((r) => <option key={r} value={r} />)}
      </datalist>
      <datalist id={`${prefix}-hwu-suggestions`}>
        {hwus.map((h) => <option key={h} value={h} />)}
      </datalist>
    </>
  );
}

/** A well's resource: Rig / HWU / None, then the unit's name. */
export function ResourceInputs({
  label,
  prefix,
  type,
  name,
  disabled,
  onChange,
}: {
  /** "Well 2" — prefixes the inputs' accessible names. */
  label: string;
  prefix: string;
  type: ResourceType;
  name: string;
  disabled?: boolean;
  onChange: (patch: { resource_type?: ResourceType; resource_name?: string }) => void;
}) {
  return (
    <div className="flex gap-1.5">
      <select
        aria-label={`${label} resource type`}
        value={type}
        disabled={disabled}
        onChange={(e) =>
          onChange({
            resource_type: e.target.value as ResourceType,
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
        aria-label={`${label} resource name`}
        value={name}
        disabled={disabled || type === "none"}
        onChange={(e) => onChange({ resource_name: e.target.value })}
        list={type === "hwu" ? `${prefix}-hwu-suggestions` : `${prefix}-rig-suggestions`}
        placeholder={type === "hwu" ? "Pick an HWU" : "Pick a rig"}
        className="min-w-0"
        maxLength={256}
      />
    </div>
  );
}

/** The clashes a preview found — reported, never silently resolved. */
export function ConflictList({ conflicts, hint }: { conflicts: PlanConflict[]; hint: string }) {
  if (conflicts.length === 0) return null;
  return (
    <div className="space-y-1 rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
      <p className="flex items-center gap-1.5 font-medium">
        <AlertTriangle className="h-3.5 w-3.5" />
        {conflicts.length} clash{conflicts.length === 1 ? "" : "es"} {hint}
      </p>
      <ul className="list-disc pl-5">
        {conflicts.map((c, i) => (
          <li key={`${c.well_name}-${c.clashes_with}-${i}`}>
            {c.well_name} overlaps {c.clashes_with} on {c.resource} by {c.overlap_days} days
          </li>
        ))}
      </ul>
    </div>
  );
}

/** "Rig A", "HWU · H-1" or "—". */
export function resourceText(rig: string | null, hwu: string | null): string {
  return rig ?? (hwu ? `HWU · ${hwu}` : "—");
}

/** Why the project dialog opens view-only, or undefined when it is editable. */
export function projectReadOnlyReason(canEditPlan: boolean, locked: boolean): string | undefined {
  if (locked) return "The plan is locked by a revision (pending or approved), so this is view only.";
  if (!canEditPlan) return "Only the campaign's planners can edit a project.";
  return undefined;
}
