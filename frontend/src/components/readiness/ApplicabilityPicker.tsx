import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, ListChecks, Loader2, Lock, Search, Undo2 } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import {
  applicabilityBody,
  changedChoices,
  groupTicks,
  groupToggle,
  isOwnChoice,
  isTicked,
  matchesPickerSearch,
  pickerBadge,
  pickerFooter,
  pickerGroups,
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
 * Phase 7 (spec §8.8): a check that "starts unticked" (the equipment types)
 * shows unticked until a team ticks it — ticking nominates it. The list is
 * searchable by code or label (a filter only hides rows: their choices stay
 * and Save sends them), shows the core checks first and then one collapsible
 * group per category with a tri-state "select all" and "n of m selected";
 * a group with nothing selected starts folded. Only the list scrolls — the
 * header and Save stay in view — and there is no pagination, so every tick
 * stays reachable before Save.
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
  // "5 of 6" over the checks that start ticked, "· 2 selected" for the ones
  // nominated; nothing for an untouched row (pickerBadge).
  const badge = pickerBadge(rows);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={`Which ${team.name} checks apply to ${targetLabel}`}
        className={cn(
          "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-medium text-primary",
          "hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
      >
        <ListChecks className="h-3.5 w-3.5" />
        Checks…
        <span className="sr-only"> for {targetLabel}</span>
        {badge && (
          <span className="font-normal text-muted-foreground" data-testid="checks-badge">
            {badge}
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
  const [query, setQuery] = useState("");
  const groups = useMemo(() => pickerGroups(rows), [rows]);
  // A group with nothing selected starts folded — decided once, as loaded.
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(
    () =>
      new Set(
        groups.categories
          .filter((g) => groupTicks(g.items, {}).selected > 0)
          .map((g) => g.name),
      ),
  );
  const changes = changedChoices(rows, choices);
  const unsaved = Object.keys(changes).length;
  const dirty = unsaved > 0;
  const set = (code: CheckCode, choice: TickChoice) => {
    setError(null);
    setChoices((prev) => ({ ...prev, [code]: choice }));
  };
  const setMany = (patch: Record<CheckCode, TickChoice>) => {
    setError(null);
    setChoices((prev) => ({ ...prev, ...patch }));
  };
  const toggleGroup = (name: string) =>
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  // Wells follow a field project's ticks for its two-level checks.
  const reachesWells = target.scope === "project" && rows.some((r) => r.check.applies_well);
  // A search only hides rows; the choices behind them stay.
  const searching = query.trim() !== "";
  const visible = (list: readonly PickerRow[]) => list.filter((r) => matchesPickerSearch(r, query));
  const shownCore = visible(groups.core);
  const shownGroups = groups.categories
    .map((g) => ({ ...g, shown: visible(g.items) }))
    .filter((g) => g.shown.length > 0);
  const shownCount = shownCore.length + shownGroups.reduce((n, g) => n + g.shown.length, 0);
  const footer = pickerFooter(shownCount, rows.length, unsaved);
  const readOnlyAll = !canEdit || saving;

  const item = (row: PickerRow) => (
    <PickerItem
      key={row.check.code}
      row={row}
      choice={choices[row.check.code] ?? null}
      canEdit={canEdit}
      saving={saving}
      onChoose={(choice) => set(row.check.code, choice)}
    />
  );

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
      {/* A column: the header and Save stay put, only the list scrolls. */}
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-lg">
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

        <div className="relative shrink-0">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            aria-label="Search checks"
            placeholder="Search code or label"
            value={query}
            maxLength={64}
            onChange={(e) => setQuery(e.target.value)}
            className="h-8 pl-8 text-sm"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pr-1" data-testid="picker-list">
          {shownCount === 0 ? (
            <p className="px-1 py-3 text-xs text-muted-foreground">No checks match this search.</p>
          ) : (
            <div className="space-y-2">
              {shownCore.length > 0 && (
                <ul className="divide-y divide-border/50 rounded-md border border-border/60" aria-label="Checks">
                  {shownCore.map(item)}
                </ul>
              )}
              {shownGroups.map((g) => {
                // While searching, a group with a match shows it; otherwise
                // the group's own fold (nothing selected → folded).
                const open = searching || openGroups.has(g.name);
                const all = groupTicks(g.items, choices);
                // The box reads and sets the rows it can change — the ones
                // shown, minus read-only "set on the field project" rows.
                const editableRows = g.shown.filter((r) => r.kind === "edit");
                const box = groupTicks(editableRows, choices);
                const editable = editableRows.length > 0;
                return (
                  <section
                    key={g.name}
                    aria-label={g.name}
                    className="rounded-md border border-border/60"
                  >
                    <div className="flex items-center gap-2 bg-muted/30 px-3 py-1.5 text-sm">
                      <GroupBox
                        label={`Select all ${g.name}`}
                        state={box.state}
                        disabled={readOnlyAll || !editable}
                        onChange={() => setMany(groupToggle(editableRows, choices))}
                      />
                      <button
                        type="button"
                        aria-expanded={open}
                        aria-label={`${open ? "Fold" : "Unfold"} ${g.name}`}
                        disabled={searching}
                        onClick={() => toggleGroup(g.name)}
                        className="-mx-1 inline-flex min-w-0 flex-1 items-center gap-1 rounded px-1 text-left font-medium hover:bg-accent/40 disabled:cursor-default disabled:hover:bg-transparent"
                      >
                        {open ? (
                          <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                        )}
                        <span className="truncate">{g.name}</span>
                      </button>
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {all.selected} of {all.total} selected
                      </span>
                    </div>
                    {open && (
                      <ul className="divide-y divide-border/50 border-t border-border/60" aria-label={`${g.name} checks`}>
                        {g.shown.map(item)}
                      </ul>
                    )}
                  </section>
                );
              })}
            </div>
          )}
        </div>

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

        <DialogFooter className="items-center gap-2">
          <span className="mr-auto text-xs text-muted-foreground" data-testid="picker-footer" aria-live="polite">
            {footer}
          </span>
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

/** One check's tick in the list. */
function PickerItem({
  row,
  choice,
  canEdit,
  saving,
  onChoose,
}: {
  row: PickerRow;
  choice: TickChoice;
  canEdit: boolean;
  saving: boolean;
  onChoose: (choice: TickChoice) => void;
}) {
  const Icon = checkIcon(row.check.icon_key);
  const readOnly = !canEdit || row.kind === "project";
  const own = isOwnChoice(row, choice);
  return (
    <li className="flex items-center gap-2 px-3 py-2 text-sm">
      <input
        type="checkbox"
        className="h-4 w-4 shrink-0 accent-primary"
        aria-label={`${row.check.code} — ${row.check.label}`}
        checked={isTicked(row, choice)}
        disabled={readOnly || saving}
        // The explicit tick — never "follow" (only Follow project is).
        onChange={(e) => onChoose(e.target.checked)}
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
              onClick={() => onChoose(null)}
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
}

/** A group's tri-state "select all": ticked when every row shown is, mixed
 *  when some are. Clicking ticks them all — or, from all, unticks them. */
function GroupBox({
  label,
  state,
  disabled,
  onChange,
}: {
  label: string;
  state: "none" | "some" | "all";
  disabled: boolean;
  onChange: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === "some";
  }, [state]);
  return (
    <input
      ref={ref}
      type="checkbox"
      className="h-4 w-4 shrink-0 accent-primary"
      aria-label={label}
      checked={state === "all"}
      disabled={disabled}
      onChange={onChange}
    />
  );
}
