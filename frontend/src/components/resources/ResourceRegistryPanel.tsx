import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, ChevronUp, Loader2, PencilLine, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import { cn } from "@/lib/utils";
import { ResourceContractSection } from "@/components/readiness/ResourceContractSection";
import { classifyContract, URGENCY_VISUAL } from "@/lib/contract-urgency";
import { listContracts, type RigContract } from "@/api/contracts";
import { listHwuContracts, type HwuContract } from "@/api/hwu-contracts";
import {
  convertResource,
  listResources,
  removeResource,
  renameResource,
  updateResource,
  type ResourceRecord,
} from "@/api/resources";

/** Sections longer than this collapse behind a "Show all" expander — a safety
 *  valve, not pagination: a campaign fleet is ~25–35 units and scanning matters. */
const SECTION_LIMIT = 25;

/** Tab identifiers: the three terrains, HWUs as a peer tab (mobile units have
 *  no terrain), and Unassigned only when legacy blank-terrain rigs exist. */
type FleetTab = "LAND" | "SWAMP" | "OFFSHORE" | "UNASSIGNED" | "HWU";

const TAB_LABEL: Record<FleetTab, string> = {
  LAND: "Land",
  SWAMP: "Swamp",
  OFFSHORE: "Offshore",
  UNASSIGNED: "Unassigned",
  HWU: "HWUs",
};

function tabOf(u: ResourceRecord): FleetTab {
  if (u.kind === "hwu") return "HWU";
  if (u.terrain === "LAND" || u.terrain === "SWAMP" || u.terrain === "OFFSHORE") {
    return u.terrain;
  }
  return "UNASSIGNED";
}

/** The campaign's fleet registry — one row per PHYSICAL unit.
 *
 * Rig identity is (terrain, name): a LAND "10K Rig 1" and a SWAMP "10K Rig 1"
 * are two different rigs, each on its own terrain tab. HWUs are mobile, one
 * row per name, on their own tab. The search box and the Planned toggle scope
 * across ALL tabs — the per-tab counts in the strip show where matches live,
 * so a match can never hide silently behind an inactive tab.
 */
/** Contract urgencies that count as "at risk" for the fleet filter. */
const AT_RISK = new Set(["expired", "critical", "soon"]);

export function ResourceRegistryPanel({
  projectId,
  canEdit,
  initialTbdOnly = false,
  initialAtRiskOnly = false,
}: {
  projectId: string;
  canEdit: boolean;
  /** Start with the Planned filter on (dashboard "planned slots" drill-through). */
  initialTbdOnly?: boolean;
  /** Start with the contracts-at-risk filter on (dashboard "expiring soon" drill-through). */
  initialAtRiskOnly?: boolean;
}) {
  const [resources, setResources] = useState<ResourceRecord[] | null>(null);
  const [rigContracts, setRigContracts] = useState<RigContract[]>([]);
  const [hwuContracts, setHwuContracts] = useState<HwuContract[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [tbdOnly, setTbdOnly] = useState(initialTbdOnly);
  const [atRiskOnly, setAtRiskOnly] = useState(initialAtRiskOnly);
  const [activeTab, setActiveTab] = useState<FleetTab | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [res, rc, hc] = await Promise.all([
        listResources(projectId),
        listContracts(projectId).catch(() => []),
        listHwuContracts(projectId).catch(() => []),
      ]);
      setResources(res);
      setRigContracts(rc);
      setHwuContracts(hc);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load the fleet registry");
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  const contractFor = useMemo(() => {
    const rigByLane = new Map(rigContracts.map((c) => [`${c.terrain ?? ""}|${c.rig_name}`, c]));
    const hwuByName = new Map(hwuContracts.map((c) => [c.hwu_name, c]));
    return (unit: ResourceRecord) =>
      unit.kind === "hwu"
        ? hwuByName.get(unit.name) ?? null
        : rigByLane.get(`${unit.terrain}|${unit.name}`) ?? rigByLane.get(`|${unit.name}`) ?? null;
  }, [rigContracts, hwuContracts]);

  const matches = useCallback(
    (u: ResourceRecord) => {
      if (tbdOnly && !u.is_placeholder) return false;
      if (atRiskOnly && !AT_RISK.has(classifyContract(contractFor(u)) ?? "")) return false;
      const q = filter.trim().toLowerCase();
      if (!q) return true;
      return (
        u.name.toLowerCase().includes(q) ||
        (u.capability_class ?? "").toLowerCase().includes(q)
      );
    },
    [filter, tbdOnly, atRiskOnly, contractFor],
  );

  const all = resources ?? [];
  // Filter FLEET-WIDE first; tabs then partition the matches, so the strip's
  // counts always reveal matches sitting on inactive tabs.
  const matched = useMemo(() => all.filter(matches), [all, matches]);
  const byTab = useMemo(() => {
    const m = new Map<FleetTab, ResourceRecord[]>();
    for (const u of matched) {
      const t = tabOf(u);
      m.set(t, [...(m.get(t) ?? []), u]);
    }
    for (const list of m.values()) list.sort((a, b) => a.name.localeCompare(b.name));
    return m;
  }, [matched]);
  const totalByTab = useMemo(() => {
    const m = new Map<FleetTab, number>();
    for (const u of all) m.set(tabOf(u), (m.get(tabOf(u)) ?? 0) + 1);
    return m;
  }, [all]);

  const tabs: FleetTab[] = useMemo(() => {
    const base: FleetTab[] = ["LAND", "SWAMP", "OFFSHORE"];
    if ((totalByTab.get("UNASSIGNED") ?? 0) > 0) base.push("UNASSIGNED");
    base.push("HWU"); // always present — HWU support must be visible even when empty
    return base;
  }, [totalByTab]);

  // Pick the landing tab once the registry loads: the first tab with a match
  // (respecting an initial TBD focus), else the first with any units, else Land.
  useEffect(() => {
    if (resources === null || activeTab !== null) return;
    const first =
      tabs.find((t) => (byTab.get(t)?.length ?? 0) > 0) ??
      tabs.find((t) => (totalByTab.get(t) ?? 0) > 0) ??
      "LAND";
    setActiveTab(first);
  }, [resources, activeTab, tabs, byTab, totalByTab]);

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
        {error}
      </div>
    );
  }
  if (resources === null || activeTab === null) {
    return (
      <div className="flex h-40 items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading fleet&hellip;
      </div>
    );
  }

  const filtering = !!filter.trim() || tbdOnly || atRiskOnly;
  const activeUnits = byTab.get(activeTab) ?? [];
  const matchesElsewhere = matched.length - activeUnits.length;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        One row per <span className="font-medium text-foreground">physical unit</span>. Rigs are
        terrain-locked — the same name on land and in swamp is two rigs, each on its own tab.{" "}
        <span className="font-medium text-foreground">Planned</span> marks capacity with no awarded
        unit behind it yet; rename it when the contract lands and its schedule and contract follow.
      </p>

      {/* Toolbar: search + Planned toggle — both scope across ALL tabs */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search the whole fleet…"
            className="h-8 w-64 pl-8 text-sm"
            aria-label="Search fleet"
          />
        </div>
        <button
          type="button"
          onClick={() => setTbdOnly((v) => !v)}
          className={cn(
            "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
            tbdOnly
              ? "border-amber-500/50 bg-amber-500/15 text-amber-700 dark:text-amber-400"
              : "border-border/70 text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          Planned only
        </button>
        <button
          type="button"
          onClick={() => setAtRiskOnly((v) => !v)}
          title="Only units whose contract is expired, critical (< 3 months) or expiring soon (3–6 months)"
          className={cn(
            "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
            atRiskOnly
              ? "border-orange-500/50 bg-orange-500/15 text-orange-700 dark:text-orange-400"
              : "border-border/70 text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          Contracts at risk
        </button>
        {filtering && (
          <span className="text-xs text-muted-foreground">
            {matched.length} of {all.length} units match
          </span>
        )}
      </div>

      {/* Terrain tab strip — counts always reflect the current search/filter scope */}
      <div className="flex flex-wrap items-center gap-1 border-b border-border/70">
        {tabs.map((t) => {
          const count = filtering ? byTab.get(t)?.length ?? 0 : totalByTab.get(t) ?? 0;
          const active = t === activeTab;
          return (
            <button
              key={t}
              type="button"
              onClick={() => setActiveTab(t)}
              className={cn(
                "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {TAB_LABEL[t]}
              <span
                className={cn(
                  "rounded-full px-1.5 text-[11px] tabular-nums",
                  count > 0 ? "bg-muted text-foreground" : "text-muted-foreground",
                )}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {activeTab === "HWU" && (
        <p className="text-xs text-muted-foreground">
          HWUs are modular units that move across terrains — identity is the name alone, so one HWU
          can double-book itself even across land and swamp.
        </p>
      )}

      <UnitList
        units={activeUnits}
        emptyText={
          filtering
            ? matchesElsewhere > 0
              ? `No matches in ${TAB_LABEL[activeTab]} — ${matchesElsewhere} on other tabs (see the counts above).`
              : "No units match the current search."
            : activeTab === "HWU"
              ? "No HWUs in this campaign yet — units register automatically when an activity uses one."
              : `No ${TAB_LABEL[activeTab].toLowerCase()} rigs yet — units register automatically as activities are added or imported.`
        }
        contractFor={contractFor}
        canEdit={canEdit}
        projectId={projectId}
        onChanged={load}
      />
    </div>
  );
}

function UnitList({
  units,
  emptyText,
  contractFor,
  canEdit,
  projectId,
  onChanged,
}: {
  units: ResourceRecord[];
  emptyText: string;
  contractFor: (u: ResourceRecord) => RigContract | HwuContract | null;
  canEdit: boolean;
  projectId: string;
  onChanged: () => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? units : units.slice(0, SECTION_LIMIT);
  const hidden = units.length - visible.length;

  return (
    <div className="overflow-hidden rounded-lg border border-border/70 bg-card shadow-soft-sm">
      {units.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-muted-foreground">{emptyText}</div>
      ) : (
        <div className="divide-y divide-border/60">
          {visible.map((u) => (
            <UnitRow
              key={u.id}
              unit={u}
              contract={contractFor(u)}
              canEdit={canEdit}
              projectId={projectId}
              onChanged={onChanged}
            />
          ))}
        </div>
      )}
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="w-full border-t border-border/60 px-3 py-2 text-center text-xs font-medium text-primary hover:bg-muted/50"
        >
          Show all ({units.length})
        </button>
      )}
    </div>
  );
}

function UnitRow({
  unit,
  contract,
  canEdit,
  projectId,
  onChanged,
}: {
  unit: ResourceRecord;
  contract: RigContract | HwuContract | null;
  canEdit: boolean;
  projectId: string;
  onChanged: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(unit.name);
  const [klass, setKlass] = useState(unit.capability_class ?? "");
  const [busy, setBusy] = useState(false);
  const [contractOpen, setContractOpen] = useState(false);
  const [convertConfirm, setConvertConfirm] = useState(false);
  const [removeConfirm, setRemoveConfirm] = useState(false);

  const lane = unit.terrain ? `${unit.terrain} – ${unit.name}` : unit.name;
  const urgency = classifyContract(contract);

  async function saveClass() {
    const next = klass.trim() || null;
    if (next === (unit.capability_class ?? null)) return;
    try {
      await updateResource(projectId, unit.id, { capability_class: next });
      onChanged();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to save class");
      setKlass(unit.capability_class ?? "");
    }
  }

  async function togglePlaceholder() {
    setBusy(true);
    try {
      await updateResource(projectId, unit.id, { is_placeholder: !unit.is_placeholder });
      onChanged();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to update the unit");
    } finally {
      setBusy(false);
    }
  }

  async function doConvert() {
    const to = unit.kind === "rig" ? "hwu" : "rig";
    setBusy(true);
    try {
      const converted = await convertResource(projectId, unit.id, to);
      toast.success(
        to === "hwu"
          ? `${unit.name} is now an HWU — its activities and contract moved with it.`
          : `${converted.name} is now a ${converted.terrain || "terrain-unassigned"} rig.`,
      );
      setConvertConfirm(false);
      onChanged();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Conversion failed");
    } finally {
      setBusy(false);
    }
  }

  async function doRemove() {
    setBusy(true);
    try {
      await removeResource(projectId, unit.id);
      toast.success(`${unit.name} removed from the fleet.`);
      setRemoveConfirm(false);
      onChanged();
    } catch (err: unknown) {
      // The server 409s while activities or a contract still reference the
      // unit — surface its explanation of what to clear first.
      toast.error(err instanceof Error ? err.message : "Failed to remove the unit");
    } finally {
      setBusy(false);
    }
  }

  async function doRename() {
    const name = newName.trim();
    if (!name || name === unit.name) {
      setRenaming(false);
      return;
    }
    setBusy(true);
    try {
      await renameResource(projectId, unit.id, name);
      toast.success(`Renamed to ${name} — its activities and contract moved with it.`);
      setRenaming(false);
      onChanged();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Rename failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5">
      {/* Unit identity + Planned badge */}
      <div className="flex min-w-0 flex-1 basis-56 items-center gap-2">
        <span className="truncate text-sm font-medium text-foreground">{unit.name}</span>
        {unit.is_placeholder && (
          <span
            className="inline-flex shrink-0 items-center rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400"
            title="Planned capacity — no awarded unit behind it yet (procurement pending)"
          >
            Planned
          </span>
        )}
      </div>

      {/* Capability class */}
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Class</span>
        {canEdit ? (
          <Input
            value={klass}
            onChange={(e) => setKlass(e.target.value)}
            onBlur={saveClass}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            placeholder="e.g. 10K"
            className="h-7 w-24 text-xs"
          />
        ) : (
          <span className="text-xs text-foreground">{unit.capability_class ?? "—"}</span>
        )}
      </div>

      {/* Contract summary */}
      <div className="flex items-center gap-1.5 text-xs">
        {contract && urgency ? (
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium",
              URGENCY_VISUAL[urgency].tintBg,
              URGENCY_VISUAL[urgency].tintText,
              URGENCY_VISUAL[urgency].tintBorder,
            )}
          >
            <span className={cn("h-1.5 w-1.5 rounded-full", URGENCY_VISUAL[urgency].dotClass)} />
            {URGENCY_VISUAL[urgency].label}
            {contract.contract_end && (
              <span className="font-normal opacity-80">· ends {contract.contract_end}</span>
            )}
          </span>
        ) : (
          // No contract is EXPECTED on a planned slot (nothing to contract yet —
          // the dashboard's planned-slots alert covers those); on a procured unit
          // it's a genuine data gap, so that's the case that gets the amber.
          <span
            className={cn(
              unit.is_placeholder
                ? "text-muted-foreground"
                : "text-amber-600 dark:text-amber-400",
            )}
            title={
              unit.is_placeholder
                ? "Expected — the slot isn't procured yet"
                : "Procured unit with no contract on file — enter its end date under Contract"
            }
          >
            No contract
          </span>
        )}
      </div>

      {/* Actions */}
      <div className="ml-auto flex items-center gap-1.5">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-xs text-muted-foreground"
          onClick={() => setContractOpen((v) => !v)}
          title="View or edit this unit's contract"
        >
          Contract
          {contractOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </Button>
      {canEdit && (
        <>
          {convertConfirm ? (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              {unit.kind === "rig" ? "Move to HWUs?" : "Move to rigs?"}
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                disabled={busy}
                onClick={doConvert}
                aria-label={`Confirm converting ${unit.name}`}
              >
                <Check className="h-3.5 w-3.5 text-emerald-600" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                disabled={busy}
                onClick={() => setConvertConfirm(false)}
                aria-label="Cancel conversion"
              >
                <X className="h-3.5 w-3.5 text-muted-foreground" />
              </Button>
            </span>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-muted-foreground"
              disabled={busy}
              onClick={() => setConvertConfirm(true)}
              title={
                unit.kind === "rig"
                  ? "Reclassify as an HWU (audited) — moves its activities and contract; merges with a same-name HWU, whose cross-terrain overlaps then count as conflicts"
                  : "Reclassify as a rig on its activities' terrain (audited) — moves its activities and contract"
              }
            >
              {unit.kind === "rig" ? "Make HWU" : "Make rig"}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground"
            disabled={busy}
            onClick={togglePlaceholder}
            title={
              unit.is_placeholder
                ? "Mark as a procured (real) unit without renaming"
                : "Mark as planned capacity (no awarded unit yet)"
            }
          >
            {unit.is_placeholder ? "Mark procured" : "Mark planned"}
          </Button>
          {renaming ? (
            <span className="flex items-center gap-1">
              <Input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") doRename();
                  if (e.key === "Escape") setRenaming(false);
                }}
                className="h-7 w-40 text-xs"
                aria-label={`New name for ${lane}`}
              />
              <Button variant="ghost" size="icon" className="h-7 w-7" disabled={busy} onClick={doRename}>
                <Check className="h-3.5 w-3.5 text-emerald-600" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                disabled={busy}
                onClick={() => {
                  setRenaming(false);
                  setNewName(unit.name);
                }}
              >
                <X className="h-3.5 w-3.5 text-muted-foreground" />
              </Button>
            </span>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 px-2 text-xs"
              disabled={busy}
              onClick={() => setRenaming(true)}
              title="Rename-on-award: give the slot the contracted unit's real name — its activities and contract follow (audited)"
            >
              <PencilLine className="h-3 w-3" /> Rename
            </Button>
          )}
          {removeConfirm ? (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              Remove from fleet?
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                disabled={busy}
                onClick={doRemove}
                aria-label={`Confirm removing ${unit.name}`}
              >
                <Check className="h-3.5 w-3.5 text-emerald-600" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                disabled={busy}
                onClick={() => setRemoveConfirm(false)}
                aria-label="Cancel removal"
              >
                <X className="h-3.5 w-3.5 text-muted-foreground" />
              </Button>
            </span>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
              disabled={busy}
              onClick={() => setRemoveConfirm(true)}
              title="Remove from the fleet roster (audited) — only possible once nothing references the unit: no activities on its lane and no contract on file"
            >
              Remove
            </Button>
          )}
        </>
      )}
      </div>
    </div>

    {/* Expandable standalone contract editor — the Fleet page is the contract's
        home (the same editor also appears inside activity dialogs, in context).
        Planner gating + plan lock are enforced server-side; read-only users get
        disabled fields. */}
    {contractOpen && (
      <div className="border-t border-border/40 bg-muted/10 px-3 py-3">
        <ResourceContractSection
          standalone
          projectId={projectId}
          resourceName={unit.name}
          kind={unit.kind}
          terrain={unit.terrain || null}
          locked={!canEdit}
          onSaved={onChanged}
        />
      </div>
    )}
    </div>
  );
}
