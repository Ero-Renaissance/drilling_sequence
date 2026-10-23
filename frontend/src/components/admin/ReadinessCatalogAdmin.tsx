import { useState, type FormEvent } from "react";
import { Archive, ArchiveRestore, ListChecks, Loader2, Pencil, Plus, Power } from "lucide-react";
import {
  adminApi,
  type AdminCatalogCheck,
  type AdminCatalogTeam,
  type AdminReadinessCatalog,
} from "@/api/admin";
import { Badge } from "@/components/ui/badge";
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
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toaster";
import { PROJECTS_TEAM } from "@/components/readiness/catalog";
import { checkIcon } from "@/components/readiness/icon-registry";
import { cn } from "@/lib/utils";

// Mirrors the server's patterns (the API stays the authority).
const CHECK_CODE_RE = /^[A-Z][A-Z0-9-]{1,7}$/;
const TEAM_CODE_RE = /^[a-z][a-z0-9-]{1,31}$/;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Request failed";
}

function IconPicker({
  keys,
  value,
  onChange,
}: {
  keys: string[];
  value: string;
  onChange: (key: string) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Icon" className="flex flex-wrap gap-1.5">
      {keys.map((key) => {
        const Icon = checkIcon(key);
        const selected = key === value;
        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={key}
            title={key}
            onClick={() => onChange(key)}
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-md border transition-colors",
              selected
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:bg-accent/50",
            )}
          >
            <Icon className="h-4 w-4" />
          </button>
        );
      })}
    </div>
  );
}

function FieldError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="text-xs text-destructive" role="alert">
      {message}
    </p>
  );
}

// ── Team dialog (create / edit) ─────────────────────────────────────────────

function TeamDialog({
  team,
  iconKeys,
  nextOrder,
  onClose,
  onSaved,
}: {
  /** null → create a new team. */
  team: AdminCatalogTeam | null;
  iconKeys: string[];
  nextOrder: number;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [code, setCode] = useState(team?.code ?? "");
  const [name, setName] = useState(team?.name ?? "");
  const [icon, setIcon] = useState(team?.icon_key ?? iconKeys[0] ?? "");
  const [order, setOrder] = useState(String(team?.sort_order ?? nextOrder));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const sortOrder = Number(order);
    if (!team && !TEAM_CODE_RE.test(code)) {
      setError("Code: 2–32 lower-case letters, digits or hyphens, starting with a letter.");
      return;
    }
    if (!name.trim() || name.trim().length > 64) {
      setError("Name: 1–64 characters.");
      return;
    }
    if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 10000) {
      setError("Order: a whole number from 0 to 10000.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (team) {
        await adminApi.updateTeam(team.code, { name: name.trim(), icon_key: icon, sort_order: sortOrder });
        onSaved(`Team “${name.trim()}” updated`);
      } else {
        await adminApi.createTeam({ code, name: name.trim(), icon_key: icon, sort_order: sortOrder });
        onSaved(`Team “${name.trim()}” created`);
      }
    } catch (err: unknown) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{team ? `Edit team ${team.name}` : "Add readiness team"}</DialogTitle>
            <DialogDescription>
              {team
                ? "The team code can't change."
                : "A team owns a set of readiness checks. Its members are given a team grant on this page — the grant lets them update this team's checks in every campaign, and nothing else."}
            </DialogDescription>
          </DialogHeader>
          {!team && (
            <div className="space-y-1.5">
              <Label htmlFor="team-code">Code</Label>
              <Input
                id="team-code"
                value={code}
                onChange={(e) => setCode(e.target.value.toLowerCase())}
                placeholder="e.g. logistics"
                maxLength={32}
                autoComplete="off"
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="team-name">Name</Label>
            <Input
              id="team-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Logistics"
              maxLength={64}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Icon</Label>
            <IconPicker keys={iconKeys} value={icon} onChange={setIcon} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="team-order">Order</Label>
            <Input
              id="team-order"
              type="number"
              min={0}
              max={10000}
              value={order}
              onChange={(e) => setOrder(e.target.value)}
              className="w-28"
            />
          </div>
          <FieldError message={error} />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {team ? "Save" : "Add team"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Check dialog (create / edit) ────────────────────────────────────────────

function statusSetLabel(catalog: AdminReadinessCatalog, name: string): string {
  const set = catalog.status_sets[name];
  return set ? set.statuses.map((s) => s.status).join(" / ") : name;
}

function CheckDialog({
  catalog,
  team,
  check,
  nextOrder,
  onClose,
  onSaved,
}: {
  catalog: AdminReadinessCatalog;
  team: AdminCatalogTeam;
  /** null → create a new check in `team`. */
  check: AdminCatalogCheck | null;
  nextOrder: number;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const isProjectGate = team.code === PROJECTS_TEAM;
  // A history-only set (`availability`, Nominated Equipment's — withdrawn, spec
  // §3.5) is kept so past revisions render; a new check can't use it (422).
  const statusSets = Object.keys(catalog.status_sets).filter(
    (name) => !catalog.status_sets[name]?.history_only,
  );
  const [code, setCode] = useState(check?.code ?? "");
  const [label, setLabel] = useState(check?.label ?? "");
  const [icon, setIcon] = useState(check?.icon_key ?? catalog.icon_keys[0] ?? "");
  const [order, setOrder] = useState(String(check?.sort_order ?? nextOrder));
  const [appliesProject, setAppliesProject] = useState(check?.applies_project ?? true);
  const [appliesWell, setAppliesWell] = useState(check?.applies_well ?? !isProjectGate);
  const [statusSet, setStatusSet] = useState(check?.status_set ?? statusSets[0] ?? "standard");
  const [locks, setLocks] = useState(check?.locks_with_plan ?? isProjectGate);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Project gates live at project level and always lock with the plan; a check
  // that locks with the plan can't apply per well (server rules, mirrored here).
  const effAppliesProject = isProjectGate ? true : appliesProject;
  const effAppliesWell = isProjectGate ? false : appliesWell;
  const effLocks = isProjectGate ? true : locks && !effAppliesWell;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const sortOrder = Number(order);
    if (!check && !CHECK_CODE_RE.test(code)) {
      setError("Code: 2–8 upper-case letters, digits or hyphens, starting with a letter.");
      return;
    }
    if (!label.trim() || label.trim().length > 64) {
      setError("Label: 1–64 characters.");
      return;
    }
    if (!effAppliesProject && !effAppliesWell) {
      setError("Choose project level, well level, or both.");
      return;
    }
    if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 10000) {
      setError("Order: a whole number from 0 to 10000.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (check) {
        await adminApi.updateCheck(check.code, {
          label: label.trim(),
          icon_key: icon,
          sort_order: sortOrder,
        });
        onSaved(`Check ${check.code} updated`);
      } else {
        await adminApi.createCheck({
          code,
          label: label.trim(),
          team_code: team.code,
          applies_project: effAppliesProject,
          applies_well: effAppliesWell,
          status_set: statusSet,
          icon_key: icon,
          locks_with_plan: effLocks,
          sort_order: sortOrder,
        });
        onSaved(`Check ${code} added to ${team.name}`);
      }
    } catch (err: unknown) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>
              {check ? `Edit check ${check.code}` : `Add check to ${team.name}`}
            </DialogTitle>
            <DialogDescription>
              {check
                ? "Only the label, icon and order can change. Code, team, scope, statuses and plan lock are fixed once a check exists — retire it and add a new one instead."
                : "The code, scope, statuses and plan lock can't be changed later, and a code is never reused — even after the check is retired."}
            </DialogDescription>
          </DialogHeader>

          {!check && (
            <div className="space-y-1.5">
              <Label htmlFor="check-code">Code</Label>
              <Input
                id="check-code"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="e.g. PRM"
                maxLength={8}
                autoComplete="off"
                className="w-36 font-mono"
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="check-label">Label</Label>
            <Input
              id="check-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Permits"
              maxLength={64}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Icon</Label>
            <IconPicker keys={catalog.icon_keys} value={icon} onChange={setIcon} />
          </div>

          {check ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-md bg-muted/40 px-3 py-2 text-xs">
              <dt className="text-muted-foreground">Applies to</dt>
              <dd>{scopeLabel(check)}</dd>
              <dt className="text-muted-foreground">Statuses</dt>
              <dd>{statusSetLabel(catalog, check.status_set)}</dd>
              <dt className="text-muted-foreground">Plan lock</dt>
              <dd>{check.locks_with_plan ? "Locks with the plan" : "Stays editable after approval"}</dd>
              {check.withdrawn && (
                <>
                  <dt className="text-muted-foreground">Withdrawn</dt>
                  <dd>Retired for good — kept only so past revisions render as recorded</dd>
                </>
              )}
            </dl>
          ) : (
            <>
              <fieldset className="space-y-1.5">
                <legend className="text-sm font-medium">Applies to</legend>
                <div className="flex gap-4 text-sm">
                  <label className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-primary"
                      checked={effAppliesProject}
                      disabled={isProjectGate}
                      onChange={(e) => setAppliesProject(e.target.checked)}
                    />
                    Field project
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-primary"
                      checked={effAppliesWell}
                      disabled={isProjectGate}
                      onChange={(e) => setAppliesWell(e.target.checked)}
                    />
                    Well
                  </label>
                </div>
              </fieldset>
              <div className="space-y-1.5">
                <Label htmlFor="check-status-set">Statuses</Label>
                <select
                  id="check-status-set"
                  value={statusSet}
                  onChange={(e) => setStatusSet(e.target.value)}
                  className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                >
                  {statusSets.map((name) => (
                    <option key={name} value={name}>
                      {statusSetLabel(catalog, name)}
                    </option>
                  ))}
                </select>
              </div>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 accent-primary"
                  checked={effLocks}
                  disabled={isProjectGate || effAppliesWell}
                  onChange={(e) => setLocks(e.target.checked)}
                />
                <span>
                  Locks with the plan
                  <span className="block text-xs text-muted-foreground">
                    {isProjectGate
                      ? "Project gates are part of what approvers sign, so they always lock."
                      : effAppliesWell
                        ? "Well-level checks stay editable after approval."
                        : "Frozen while a revision is pending or approved. Leave off for checks that change day to day."}
                  </span>
                </span>
              </label>
            </>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="check-order">Order</Label>
            <Input
              id="check-order"
              type="number"
              min={0}
              max={10000}
              value={order}
              onChange={(e) => setOrder(e.target.value)}
              className="w-28"
            />
          </div>
          <FieldError message={error} />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {check ? "Save" : "Add check"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function scopeLabel(check: AdminCatalogCheck): string {
  if (check.applies_project && check.applies_well) return "Field project and well";
  return check.applies_project ? "Field project" : "Well";
}

// ── Main section ────────────────────────────────────────────────────────────

type TeamDialogState = { team: AdminCatalogTeam | null } | null;
type CheckDialogState = { team: AdminCatalogTeam; check: AdminCatalogCheck | null } | null;

export function ReadinessCatalogAdmin({
  catalog,
  loading,
  onChanged,
  defaultOpen = true,
  storageKey,
}: {
  catalog: AdminReadinessCatalog | null;
  loading: boolean;
  /** Reload the admin catalog and the app's live catalog. */
  onChanged: () => void;
  /** Whether the section starts unfolded (before any remembered choice). */
  defaultOpen?: boolean;
  /** Remember the folded/unfolded choice under this key. */
  storageKey?: string;
}) {
  const [teamDialog, setTeamDialog] = useState<TeamDialogState>(null);
  const [checkDialog, setCheckDialog] = useState<CheckDialogState>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function run(key: string, action: () => Promise<unknown>, success: string) {
    setBusy(key);
    try {
      await action();
      toast.success(success);
      onChanged();
    } catch (err: unknown) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  function saved(message: string) {
    setTeamDialog(null);
    setCheckDialog(null);
    toast.success(message);
    onChanged();
  }

  const nextOrder = (orders: number[]) => (orders.length ? Math.max(...orders) + 10 : 10);

  return (
    <CollapsibleSection
      title="Readiness checks"
      icon={ListChecks}
      defaultOpen={defaultOpen}
      storageKey={storageKey}
      count={
        catalog
          ? `${catalog.teams.length} ${catalog.teams.length === 1 ? "team" : "teams"} · ${
              catalog.checks.filter((c) => c.retired_at === null).length
            } checks`
          : ""
      }
      actions={
        <Button
          size="sm"
          variant="outline"
          disabled={!catalog}
          onClick={() => setTeamDialog({ team: null })}
        >
          <Plus className="h-3.5 w-3.5" />
          Add team
        </Button>
      }
    >
      <p className="px-4 pt-3 text-xs text-muted-foreground">
        Each team owns its readiness checks. The project gates are updated by campaign planners;
        other teams by the users given that team&apos;s grant above. Retire a check instead of
        deleting it — its saved values and past revisions are kept.
      </p>

      {loading || !catalog ? (
        <div className="space-y-2 p-4">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-lg" />
          ))}
        </div>
      ) : (
        <div className="divide-y divide-border/60">
          {catalog.teams.map((team) => {
            const TeamIcon = checkIcon(team.icon_key);
            const checks = catalog.checks.filter((c) => c.team_code === team.code);
            const isProjectGates = team.code === PROJECTS_TEAM;
            return (
              <section key={team.code} aria-label={`${team.name} checks`} className="py-2">
                <div className="flex flex-wrap items-center gap-2 px-4 py-2">
                  <TeamIcon className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium text-foreground">{team.name}</span>
                  <code className="text-xs text-muted-foreground">{team.code}</code>
                  <Badge variant="secondary" className="text-[10px]">
                    {team.editor_source === "planner"
                      ? "Updated by campaign planners"
                      : "Updated by team-grant holders"}
                  </Badge>
                  {!team.is_active && (
                    <Badge variant="warning" className="text-[10px]">
                      Inactive
                    </Badge>
                  )}
                  <div className="ml-auto flex gap-1.5">
                    <Button size="sm" variant="ghost" onClick={() => setTeamDialog({ team })}>
                      <Pencil className="h-3.5 w-3.5" />
                      Edit
                    </Button>
                    {!isProjectGates && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy === `team:${team.code}`}
                        title={
                          team.is_active
                            ? "Hide this team's checks everywhere and stop updates to them"
                            : "Show this team's checks again"
                        }
                        onClick={() =>
                          run(
                            `team:${team.code}`,
                            () => adminApi.updateTeam(team.code, { is_active: !team.is_active }),
                            `${team.name} ${team.is_active ? "deactivated" : "activated"}`,
                          )
                        }
                      >
                        <Power className="h-3.5 w-3.5" />
                        {team.is_active ? "Deactivate" : "Activate"}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!team.is_active}
                      onClick={() => setCheckDialog({ team, check: null })}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add check
                    </Button>
                  </div>
                </div>

                {checks.length === 0 ? (
                  <p className="px-4 pb-2 text-xs text-muted-foreground">No checks yet.</p>
                ) : (
                  <div className="overflow-x-auto px-4 pb-2">
                    <table className="w-full min-w-[640px] text-sm">
                      <thead>
                        <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                          <th className="py-1.5 pr-3 font-semibold">Check</th>
                          <th className="py-1.5 pr-3 font-semibold">Applies to</th>
                          <th className="py-1.5 pr-3 font-semibold">Statuses</th>
                          <th className="py-1.5 pr-3 font-semibold">Plan lock</th>
                          <th className="py-1.5 pr-3 font-semibold">Order</th>
                          <th className="py-1.5" />
                        </tr>
                      </thead>
                      <tbody>
                        {checks.map((check) => {
                          const Icon = checkIcon(check.icon_key);
                          const retired = check.retired_at !== null;
                          // Withdrawn (spec §4.4): retired for good — no Restore (409).
                          const withdrawn = !!check.withdrawn;
                          const key = `check:${check.code}`;
                          return (
                            <tr
                              key={check.code}
                              className={cn("border-t border-border/40", retired && "opacity-60")}
                            >
                              <td className="py-1.5 pr-3">
                                <div className="flex items-center gap-2">
                                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                                  <code className="text-xs font-semibold">{check.code}</code>
                                  <span className="text-foreground">{check.label}</span>
                                  {withdrawn ? (
                                    <Badge
                                      variant="outline"
                                      className="text-[10px]"
                                      title="Retired for good — it can't be restored or re-created; past revisions still show it"
                                    >
                                      Withdrawn
                                    </Badge>
                                  ) : (
                                    retired && (
                                      <Badge variant="outline" className="text-[10px]">
                                        Retired
                                      </Badge>
                                    )
                                  )}
                                </div>
                              </td>
                              <td className="py-1.5 pr-3 text-xs">{scopeLabel(check)}</td>
                              <td className="py-1.5 pr-3 text-xs text-muted-foreground">
                                {statusSetLabel(catalog, check.status_set)}
                              </td>
                              <td className="py-1.5 pr-3 text-xs">
                                {check.locks_with_plan ? "Locks" : "Live"}
                              </td>
                              <td className="py-1.5 pr-3 text-xs tabular-nums">{check.sort_order}</td>
                              <td className="py-1.5">
                                <div className="flex justify-end gap-1">
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    aria-label={`Edit ${check.code}`}
                                    onClick={() => setCheckDialog({ team, check })}
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </Button>
                                  {!withdrawn && (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      disabled={busy === key}
                                      title={
                                        retired
                                          ? "Show and allow updates to this check again"
                                          : "Hide this check everywhere; its saved values are kept"
                                      }
                                      onClick={() =>
                                        run(
                                          key,
                                          () =>
                                            retired
                                              ? adminApi.restoreCheck(check.code)
                                              : adminApi.retireCheck(check.code),
                                          `${check.code} ${retired ? "restored" : "retired"}`,
                                        )
                                      }
                                    >
                                      {retired ? (
                                        <ArchiveRestore className="h-3.5 w-3.5" />
                                      ) : (
                                        <Archive className="h-3.5 w-3.5" />
                                      )}
                                      {retired ? "Restore" : "Retire"}
                                    </Button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      {teamDialog && catalog && (
        <TeamDialog
          team={teamDialog.team}
          iconKeys={catalog.icon_keys}
          nextOrder={nextOrder(catalog.teams.map((t) => t.sort_order))}
          onClose={() => setTeamDialog(null)}
          onSaved={saved}
        />
      )}
      {checkDialog && catalog && (
        <CheckDialog
          catalog={catalog}
          team={checkDialog.team}
          check={checkDialog.check}
          nextOrder={nextOrder(
            catalog.checks.filter((c) => c.team_code === checkDialog.team.code).map((c) => c.sort_order),
          )}
          onClose={() => setCheckDialog(null)}
          onSaved={saved}
        />
      )}
    </CollapsibleSection>
  );
}
