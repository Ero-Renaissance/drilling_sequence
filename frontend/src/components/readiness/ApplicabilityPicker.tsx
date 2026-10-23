import { useMemo, useState } from "react";
import { ListChecks, Loader2, Lock, Undo2 } from "lucide-react";
import {
  setApplicability,
  type ApplicabilityResult,
  type CatalogCheck,
  type CatalogTeam,
  type CheckCode,
  type ReadinessTarget,
  type TeamCheckState,
} from "@/api/readiness";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/toaster";
import {
  applicabilityBody,
  changedChoices,
  isOwnChoice,
  isTicked,
  pickerRows,
  type PickerRow,
  type TickChoice,
} from "@/lib/readiness-applicability";
import { cn } from "@/lib/utils";
import { checkIcon } from "./icon-registry";

type Cells = Partial<Record<CheckCode, TeamCheckState>>;

/**
 * "Checks that apply" (spec §3.8, §8.7): a team's tick list for ONE target — a
 * field project or a well — opened from the row's **Checks…** control, never
 * from an icon. Every check starts ticked; a team unticks the ones that don't
 * apply, and an unticked check leaves the chart, the prints and every figure
 * while the status kept underneath comes back when it's re-ticked.
 *
 * Only for checks that don't lock with the plan: the Project gates mark a gate
 * that doesn't apply as N/A in its status menu, as they always have.
 *
 * Save sends ONE request — all or nothing — with only the ticks that changed;
 * the server decides what each means against the target's current state. Who
 * may tick is who may write the check (the team's grantees, admins); others see
 * the list read-only. The API stays the authority (403 → toast).
 */
export function ApplicabilityPicker({
  projectId,
  team,
  checks,
  target,
  targetLabel,
  cells,
  projectCells,
  canEdit,
  wellsWithOwnChoice,
  onSaved,
  className,
}: {
  projectId: string;
  team: Pick<CatalogTeam, "code" | "name">;
  /** The definitions the view rendered from (the team rows' `checks`). */
  checks: readonly CatalogCheck[];
  target: ReadinessTarget;
  /** Names the target in the dialog, e.g. "W-1 · Bonga Phase 3 · Oil Development". */
  targetLabel: string;
  /** The target's cells as served. */
  cells: Cells | undefined;
  /** A well's field-project cells — what Follow project shows. */
  projectCells?: Cells;
  canEdit: boolean;
  /** A field project: how many of its wells have their own choice. */
  wellsWithOwnChoice?: number;
  /** After a save, with the target's new rows; awaited before the dialog closes. */
  onSaved: (result: ApplicabilityResult) => void | Promise<void>;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rows = useMemo(
    () => pickerRows(checks, target, cells, projectCells),
    [checks, target, cells, projectCells],
  );
  if (rows.length === 0) return null;
  const ticked = rows.filter((r) => isTicked(r, r.initial)).length;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={`Which ${team.name} checks apply to ${targetLabel}`}
        className={cn(
          "inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-primary",
          "hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
      >
        <ListChecks className="h-3.5 w-3.5" />
        Checks…
        <span className="sr-only"> for {targetLabel}</span>
        {ticked < rows.length && (
          <span className="font-normal text-muted-foreground">
            {ticked} of {rows.length}
          </span>
        )}
      </button>
      {open && (
        <PickerDialog
          projectId={projectId}
          team={team}
          target={target}
          targetLabel={targetLabel}
          rows={rows}
          canEdit={canEdit}
          wellsWithOwnChoice={wellsWithOwnChoice}
          onClose={() => setOpen(false)}
          onSaved={async (result) => {
            await onSaved(result);
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

function PickerDialog({
  projectId,
  team,
  target,
  targetLabel,
  rows,
  canEdit,
  wellsWithOwnChoice,
  onClose,
  onSaved,
}: {
  projectId: string;
  team: Pick<CatalogTeam, "code" | "name">;
  target: ReadinessTarget;
  targetLabel: string;
  rows: PickerRow[];
  canEdit: boolean;
  wellsWithOwnChoice?: number;
  onClose: () => void;
  onSaved: (result: ApplicabilityResult) => Promise<void>;
}) {
  const [choices, setChoices] = useState<Record<CheckCode, TickChoice>>(() =>
    Object.fromEntries(rows.map((r) => [r.check.code, r.initial])),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changes = changedChoices(rows, choices);
  const dirty = Object.keys(changes).length > 0;
  const set = (code: CheckCode, choice: TickChoice) => {
    setError(null);
    setChoices((prev) => ({ ...prev, [code]: choice }));
  };
  // Wells follow a field project's ticks for its two-level checks.
  const reachesWells = target.scope === "project" && rows.some((r) => r.check.applies_well);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const result = await setApplicability(projectId, team.code, applicabilityBody(target, changes));
      await onSaved(result);
    } catch (err: unknown) {
      // All or nothing: nothing changed; keep the dialog so the choice isn't
      // lost. The toast is the app's report; the line in the dialog is what a
      // screen reader hears while the modal hides the rest of the page.
      const message = err instanceof Error ? err.message : "Failed to update which checks apply";
      toast.error(message);
      setError(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{team.name} checks that apply</DialogTitle>
          <DialogDescription>{targetLabel}</DialogDescription>
        </DialogHeader>

        {reachesWells && (
          <p className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            Applies to its wells unless a well has its own choice.{" "}
            {!wellsWithOwnChoice
              ? "No well has its own choice."
              : wellsWithOwnChoice === 1
                ? "1 well has its own choice."
                : `${wellsWithOwnChoice} wells have their own choice.`}
          </p>
        )}

        <ul className="divide-y divide-border/50 rounded-md border border-border/60" aria-label="Checks">
          {rows.map((row) => {
            const choice = choices[row.check.code] ?? null;
            const Icon = checkIcon(row.check.icon_key);
            const readOnly = !canEdit || row.kind === "project";
            const own = isOwnChoice(row, choice);
            return (
              <li key={row.check.code} className="flex items-center gap-2 px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 shrink-0 accent-primary"
                  aria-label={`${row.check.code} — ${row.check.label}`}
                  checked={isTicked(row, choice)}
                  disabled={readOnly || saving}
                  // The explicit tick — never "follow" (only Follow project is).
                  onChange={(e) => set(row.check.code, e.target.checked)}
                />
                <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="font-mono text-xs font-semibold">{row.check.code}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{row.check.label}</span>
                {row.kind === "project" ? (
                  <span className="shrink-0 text-[11px] text-muted-foreground">set on the field project</span>
                ) : own ? (
                  <span className="flex shrink-0 items-center gap-1.5">
                    <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-medium text-sky-700 dark:text-sky-300">
                      set on this well
                    </span>
                    {canEdit && (
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => set(row.check.code, null)}
                        title="Drop this well's own choice so it follows its field project again"
                        aria-label={`Follow project for ${row.check.code}`}
                        className="inline-flex items-center gap-1 rounded px-1 text-[11px] text-primary hover:underline disabled:opacity-50"
                      >
                        <Undo2 className="h-3 w-3" />
                        Follow project
                      </button>
                    )}
                  </span>
                ) : row.inherits ? (
                  <span className="shrink-0 text-[11px] text-muted-foreground">from project</span>
                ) : null}
              </li>
            );
          })}
        </ul>

        {error && (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </p>
        )}

        {!canEdit && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Lock className="h-3.5 w-3.5" />
            View only — choosing which {team.name} checks apply needs the {team.name} grant (Admin
            page).
          </p>
        )}

        <DialogFooter className="gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            {canEdit ? "Cancel" : "Close"}
          </Button>
          {canEdit && (
            <Button type="button" onClick={save} disabled={!dirty || saving}>
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Save
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
