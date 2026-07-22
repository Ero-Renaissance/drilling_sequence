import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Calculator, FileDown, FileUp, FolderPlus, Loader2, Plus, Trash2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumericInput } from "@/components/ui/numeric-input";
import { toast } from "@/components/ui/toaster";
import { optimizerApi, type DemandRow, type OptimizerAssumptions, type OptimizerOptions, type OptimizationResponse, type RunPayload, type StreamKey, type Terrain, type TerrainResult } from "@/api/optimizer";
import { DrillChart } from "@/components/chart/DrillChart";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { optimizerResultsToActivities } from "@/lib/optimizer-chart";
import { useMemo } from "react";

const TERRAINS: Terrain[] = ["Land", "Swamp", "SWO"];

const TERRAIN_COLOR: Record<Terrain, string> = {
  Land: "#f58220",
  Swamp: "#3cb44a",
  SWO: "#0e7490",
};

const TERRAIN_LABEL: Record<Terrain, string> = {
  Land: "Land",
  Swamp: "Swamp",
  SWO: "Offshore",
};

const DEFAULT_ASSUMPTIONS: OptimizerAssumptions = {
  well_duration_days: 76,
  inter_well_gap_days: 14,
  batch_size: 3,
  batch_gap_days: 28,
  project_move_days_land: 45,
  project_move_days_swamp: 30,
  project_move_days_swo: 30,
  rig_months_per_year: 12,
};

const DEFAULT_OPTIONS: OptimizerOptions = {
  delivery: "finished",
  allow_slip_days: 0,
  allow_drill_ahead: false,
  batch_reset_on_new_year: false,
};

const DEFAULT_YEARS = [2027, 2028, 2029, 2030, 2031];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const STREAM_LABEL: Record<StreamKey, string> = {
  oil: "Oil",
  domestic_gas: "Domestic gas",
  export_gas: "Export gas",
};

/** All six orderings of the three value streams — a select over these beats a
 *  drag-and-drop for a 3-item list. Encoded as comma-joined keys. */
const PRIORITY_CHOICES: StreamKey[][] = [
  ["oil", "domestic_gas", "export_gas"],
  ["oil", "export_gas", "domestic_gas"],
  ["domestic_gas", "oil", "export_gas"],
  ["domestic_gas", "export_gas", "oil"],
  ["export_gas", "oil", "domestic_gas"],
  ["export_gas", "domestic_gas", "oil"],
];

const priorityKeyOf = (order: StreamKey[]) => order.join(",");
const priorityLabelOf = (order: StreamKey[]) =>
  order.map((s) => STREAM_LABEL[s]).join(" › ");

function PrioritySelect({
  value,
  onChange,
  disabled,
  testId,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  testId: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      data-testid={testId}
      className="h-7 rounded-md border border-border bg-background px-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
    >
      <option value="">None — largest schedule first</option>
      {PRIORITY_CHOICES.map((order) => (
        <option key={priorityKeyOf(order)} value={priorityKeyOf(order)}>
          {priorityLabelOf(order)}
        </option>
      ))}
    </select>
  );
}

interface GridRow {
  terrain: Terrain;
  project: string;
  wells: Record<number, number | "">;
  oil_volume: number | "";
  domestic_gas_volume: number | "";
  export_gas_volume: number | "";
}

function emptyRow(): GridRow {
  return {
    terrain: "Land", project: "", wells: {},
    oil_volume: "", domestic_gas_volume: "", export_gas_volume: "",
  };
}


/** Assumption field with a label — digits only (owned NumericInput), bounds
 *  mirroring the server's so garbage can't even be typed. Always holds a
 *  number: emptying the field restores the previous value on blur. */
function NumberField({
  label,
  value,
  onChange,
  suffix,
  min = 0,
  max,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  suffix?: string;
  min?: number;
  max?: number;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      <span>{label}</span>
      <span className="flex items-center gap-1.5">
        <NumericInput
          integer
          value={value}
          min={min}
          max={max}
          allowEmpty={false}
          onValueChange={(v) => {
            if (v !== "") onChange(v);
          }}
          className="h-8 w-24 text-sm"
        />
        {suffix && <span className="text-[11px]">{suffix}</span>}
      </span>
    </label>
  );
}

export function RigOptimizer() {
  const navigate = useNavigate();
  const [assumptions, setAssumptions] = useState(DEFAULT_ASSUMPTIONS);
  const [options, setOptions] = useState(DEFAULT_OPTIONS);
  const [years, setYears] = useState<number[]>(DEFAULT_YEARS);
  // Per-year completion cutoff (month by whose end the year's last well must
  // FINISH). 12 = no cutoff; only <12 entries are sent.
  const [cutoffs, setCutoffs] = useState<Record<number, number>>({});
  // Stream priority: one global ordering ("" = off) with an optional
  // per-terrain override; overrides prefill from the global when opened.
  const [priorityKey, setPriorityKey] = useState("");
  const [perTerrainPriority, setPerTerrainPriority] = useState(false);
  const [terrainPriorityKeys, setTerrainPriorityKeys] = useState<Record<Terrain, string>>({
    Land: "", Swamp: "", SWO: "",
  });
  const [rows, setRows] = useState<GridRow[]>([emptyRow()]);
  const [issues, setIssues] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<OptimizationResponse | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // The optimizer's schedules rendered by the real sequence chart: one row per
  // rig, grouped Land → Swamp → Offshore, project filter intact.
  const chartActivities = useMemo(
    () => (result ? optimizerResultsToActivities(result.results) : []),
    [result],
  );

  const setA = (patch: Partial<OptimizerAssumptions>) =>
    setAssumptions((a) => ({ ...a, ...patch }));
  const setO = (patch: Partial<OptimizerOptions>) => setOptions((o) => ({ ...o, ...patch }));

  function updateRow(i: number, patch: Partial<GridRow>) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  function setWell(i: number, year: number, value: number | "") {
    setRows((rs) =>
      rs.map((r, j) => (j === i ? { ...r, wells: { ...r.wells, [year]: value } } : r)),
    );
  }

  function addYear() {
    setYears((ys) => [...ys, (ys[ys.length - 1] ?? new Date().getFullYear()) + 1]);
  }

  function removeYear(year: number) {
    setYears((ys) => ys.filter((y) => y !== year));
  }

  async function upload(file: File) {
    try {
      const parsed = await optimizerApi.parseSchedule(file);
      setRows(
        parsed.demand.map((d: DemandRow) => ({
          terrain: d.terrain,
          project: d.project,
          oil_volume: "" as const,
          domestic_gas_volume: "" as const,
          export_gas_volume: "" as const,
          wells: Object.fromEntries(
            Object.entries(d.wells_by_year).map(([y, n]) => [Number(y), n]),
          ),
        })),
      );
      if (parsed.years.length) setYears(parsed.years);
      setIssues(parsed.issues);
      setResult(null);
      if (parsed.issues.length === 0) {
        toast.success(`Loaded ${parsed.demand.length} project rows`);
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Could not parse the schedule file");
    }
  }

  function buildDemand(): DemandRow[] {
    return rows
      .filter((r) => r.project.trim())
      .map((r) => ({
        terrain: r.terrain,
        project: r.project.trim(),
        oil_volume: Number(r.oil_volume) || 0,
        domestic_gas_volume: Number(r.domestic_gas_volume) || 0,
        export_gas_volume: Number(r.export_gas_volume) || 0,
        wells_by_year: Object.fromEntries(
          years
            .filter((y) => Number(r.wells[y]) > 0)
            .map((y) => [String(y), Number(r.wells[y])]),
        ),
      }))
      .filter((r) => Object.keys(r.wells_by_year).length > 0);
  }

  // Priority is meaningless until at least one volume is captured — the
  // control greys out with a hint instead of silently doing nothing.
  const hasVolumes = rows.some(
    (r) =>
      Number(r.oil_volume) > 0 ||
      Number(r.domestic_gas_volume) > 0 ||
      Number(r.export_gas_volume) > 0,
  );

  /** Resolved terrain → ordering map, only for terrains present in the demand.
   *  Per-terrain "None" (empty key) leaves that terrain on the default sort. */
  function buildPriority(demand: DemandRow[]): RunPayload["stream_priority_by_terrain"] {
    if (!hasVolumes) return undefined;
    const terrains = [...new Set(demand.map((d) => d.terrain))];
    const entries = terrains
      .map((t) => [t, perTerrainPriority ? terrainPriorityKeys[t] : priorityKey] as const)
      .filter(([, key]) => key !== "")
      .map(([t, key]) => [t, key.split(",") as StreamKey[]] as const);
    return entries.length ? Object.fromEntries(entries) : undefined;
  }

  /** One payload for run + Excel export so the workbook always reflects the
   *  same cutoffs and priority as the on-screen result. */
  function buildRunPayload(demand: DemandRow[]): RunPayload {
    const cutoffEntries = Object.entries(cutoffs).filter(([, m]) => m && m < 12);
    return {
      demand,
      assumptions: {
        ...assumptions,
        last_completion_month_by_year: Object.fromEntries(cutoffEntries),
      },
      options,
      stream_priority_by_terrain: buildPriority(demand),
    };
  }

  async function run() {
    const demand = buildDemand();
    if (demand.length === 0) {
      toast.error("Add at least one project row with wells in a year");
      return;
    }
    setRunning(true);
    try {
      const res = await optimizerApi.run(buildRunPayload(demand));
      setResult(res);
      if (res.warning) toast.info(res.warning);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Optimization failed");
    } finally {
      setRunning(false);
    }
  }

  async function downloadExcel() {
    const demand = buildDemand();
    if (demand.length === 0) {
      toast.error("Add at least one project row with wells in a year");
      return;
    }
    try {
      const blob = await optimizerApi.exportExcel(buildRunPayload(demand));
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "rig-optimization.xlsx";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Excel export failed");
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Rig Optimization</h1>
        <p className="text-sm text-muted-foreground">
          Minimum rig fleet per terrain to deliver the committed wells per project per year.
          Rigs never cross terrains; every assumption below is editable.
        </p>
      </div>

      {/* Assumptions + options */}
      <div className="rounded-xl border border-border/70 bg-card p-4 shadow-soft-sm">
        <h2 className="mb-3 text-sm font-semibold">Assumptions</h2>
        <div className="flex flex-wrap gap-4">
          <NumberField
            label="Well duration"
            value={assumptions.well_duration_days}
            min={1}
            max={730}
            onChange={(v) => setA({ well_duration_days: v })}
            suffix="days (76 ≈ 2.5 months)"
          />
          <NumberField
            label="Gap between wells"
            value={assumptions.inter_well_gap_days}
            max={365}
            onChange={(v) => setA({ inter_well_gap_days: v })}
            suffix="days"
          />
          <NumberField
            label="Batch size"
            value={assumptions.batch_size}
            min={1}
            max={50}
            onChange={(v) => setA({ batch_size: v })}
            suffix="wells"
          />
          <NumberField
            label="Gap after batch"
            value={assumptions.batch_gap_days}
            max={365}
            onChange={(v) => setA({ batch_gap_days: v })}
            suffix="days (replaces the well gap)"
          />
          <NumberField
            label="Project move (Land)"
            value={assumptions.project_move_days_land}
            max={365}
            onChange={(v) => setA({ project_move_days_land: v })}
            suffix="days"
          />
          <NumberField
            label="Project move (Swamp)"
            value={assumptions.project_move_days_swamp}
            max={365}
            onChange={(v) => setA({ project_move_days_swamp: v })}
            suffix="days"
          />
          <NumberField
            label="Project move (Offshore)"
            value={assumptions.project_move_days_swo}
            max={365}
            onChange={(v) => setA({ project_move_days_swo: v })}
            suffix="days"
          />
          <NumberField
            label="Rig availability"
            value={assumptions.rig_months_per_year}
            min={1}
            max={12}
            onChange={(v) => setA({ rig_months_per_year: v })}
            suffix="months/year"
          />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-5 border-t border-border/60 pt-3 text-xs text-muted-foreground">
          <label className="flex items-center gap-1.5">
            Delivery counts when
            <select
              value={options.delivery}
              onChange={(e) => setO({ delivery: e.target.value as "finished" | "spudded" })}
              className="h-7 rounded-md border border-border bg-background px-1.5 text-xs"
            >
              <option value="finished">finished in-year (strict)</option>
              <option value="spudded">spudded in-year</option>
            </select>
          </label>
          <label className="flex items-center gap-1.5">
            Slip allowance
            <NumericInput
              integer
              max={365}
              value={options.allow_slip_days}
              allowEmpty={false}
              onValueChange={(v) => {
                if (v !== "") setO({ allow_slip_days: v });
              }}
              className="h-7 w-16 text-xs"
            />
            days
          </label>
          <label className="flex cursor-pointer items-center gap-1.5">
            <input
              type="checkbox"
              checked={options.allow_drill_ahead}
              onChange={(e) => setO({ allow_drill_ahead: e.target.checked })}
              className="h-3.5 w-3.5 accent-primary"
            />
            Allow drilling ahead of the committed year
          </label>
          <label className="flex cursor-pointer items-center gap-1.5">
            <input
              type="checkbox"
              checked={options.batch_reset_on_new_year}
              onChange={(e) => setO({ batch_reset_on_new_year: e.target.checked })}
              className="h-3.5 w-3.5 accent-primary"
            />
            Reset batch counter on 1 January
          </label>
        </div>
      </div>

      {/* Demand grid */}
      <div className="rounded-xl border border-border/70 bg-card shadow-soft-sm">
        <div className="flex flex-wrap items-center gap-2 border-b border-border/70 px-4 py-3">
          <h2 className="text-sm font-semibold">Wells schedule</h2>
          <span className="text-xs text-muted-foreground">
            wells per project per year
          </span>
          <div className="ml-auto flex items-center gap-2">
            <input
              ref={fileInput}
              type="file"
              accept=".csv,.xlsx,.xlsm"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload(f);
                e.target.value = "";
              }}
            />
            <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
              <FileUp className="h-3.5 w-3.5" />
              Upload CSV / Excel
            </Button>
            {result && (
              <Button variant="outline" size="sm" onClick={downloadExcel} title="Download the result as an Excel workbook (summary, rig schedule, demand)">
                <FileDown className="h-3.5 w-3.5" />
                Download Excel
              </Button>
            )}
            <Button size="sm" onClick={run} disabled={running}>
              {running ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Calculator className="h-3.5 w-3.5" />
              )}
              Optimize
            </Button>
          </div>
        </div>

        {issues.length > 0 && (
          <div className="mx-4 mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
            <div className="mb-1 flex items-center gap-1.5 font-medium">
              <TriangleAlert className="h-3.5 w-3.5" />
              {issues.length} row{issues.length !== 1 ? "s" : ""} skipped during upload
            </div>
            <ul className="list-inside list-disc space-y-0.5 text-muted-foreground">
              {issues.map((msg, i) => (
                <li key={i}>{msg}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border/60 px-4 py-2">
          <span className="text-xs font-medium text-muted-foreground">
            Completion cutoff
            <span className="ml-1 font-normal text-muted-foreground/70">
              — each year's last well must finish by this month
            </span>
          </span>
          {years.map((y) => (
            <label key={y} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              {y}
              <select
                value={cutoffs[y] ?? 12}
                onChange={(e) =>
                  setCutoffs((c) => ({ ...c, [y]: Number(e.target.value) }))
                }
                className="rounded-md border border-border bg-background px-1.5 py-1 text-xs text-foreground"
                data-testid={`cutoff-${y}`}
              >
                {MONTHS.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}{i === 11 ? " (none)" : ""}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
        <div className="overflow-x-auto p-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="pb-2 pr-2">Terrain</th>
                <th className="pb-2 pr-2">Project</th>
                <th className="pb-2 pr-1 text-center" title="Oil volume (MMbbl)">Oil vol</th>
                <th className="pb-2 pr-1 text-center" title="Domestic gas volume (Bscf)">Dom gas</th>
                <th className="pb-2 pr-1 text-center" title="Export gas volume (Bscf)">Exp gas</th>
                {years.map((y) => (
                  <th key={y} className="pb-2 pr-1 text-center">
                    <span className="inline-flex items-center gap-1">
                      {y}
                      <button
                        type="button"
                        aria-label={`Remove year ${y}`}
                        onClick={() => removeYear(y)}
                        className="text-muted-foreground/50 hover:text-destructive"
                      >
                        ×
                      </button>
                    </span>
                  </th>
                ))}
                <th className="pb-2">
                  <Button variant="ghost" size="sm" onClick={addYear} title="Add a year column">
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-t border-border/50">
                  <td className="py-1.5 pr-2">
                    <select
                      value={row.terrain}
                      onChange={(e) => updateRow(i, { terrain: e.target.value as Terrain })}
                      className="h-8 rounded-md border border-border bg-background px-1.5 text-sm"
                    >
                      {TERRAINS.map((t) => (
                        <option key={t} value={t}>
                          {TERRAIN_LABEL[t]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-1.5 pr-2">
                    <Input
                      value={row.project}
                      placeholder="Project name"
                      onChange={(e) => updateRow(i, { project: e.target.value })}
                      className="h-8 min-w-36 text-sm"
                    />
                  </td>
                  {(["oil_volume", "domestic_gas_volume", "export_gas_volume"] as const).map(
                    (vk) => (
                      <td key={vk} className="px-1 py-1.5 text-center">
                        <NumericInput
                          max={1_000_000}
                          value={row[vk] ?? ""}
                          onValueChange={(v) => updateRow(i, { [vk]: v } as Partial<GridRow>)}
                          className="h-8 w-20 text-center text-sm"
                          data-testid={`${vk}-${i}`}
                        />
                      </td>
                    ),
                  )}
                  {years.map((y) => (
                    <td key={y} className="px-1 py-1.5 text-center">
                      <NumericInput
                        integer
                        max={100}
                        value={row.wells[y] ?? ""}
                        onValueChange={(v) => setWell(i, y, v)}
                        className="h-8 w-16 text-center text-sm"
                      />
                    </td>
                  ))}
                  <td className="py-1.5">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground"
                      onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                      title="Remove row"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => setRows((rs) => [...rs, emptyRow()])}
          >
            <Plus className="h-3.5 w-3.5" />
            Add project
          </Button>

          {/* Stream priority — which value stream the sequencing favours. Never
              changes the rig count; it only orders projects within each fleet. */}
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border/60 pt-3 text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">Value priority</span>
            {!perTerrainPriority && (
              <PrioritySelect
                value={priorityKey}
                onChange={setPriorityKey}
                disabled={!hasVolumes}
                testId="priority-global"
              />
            )}
            {perTerrainPriority &&
              TERRAINS.map((t) => (
                <label key={t} className="flex items-center gap-1.5">
                  {TERRAIN_LABEL[t]}
                  <PrioritySelect
                    value={terrainPriorityKeys[t]}
                    onChange={(v) =>
                      setTerrainPriorityKeys((m) => ({ ...m, [t]: v }))
                    }
                    disabled={!hasVolumes}
                    testId={`priority-${t}`}
                  />
                </label>
              ))}
            {hasVolumes ? (
              <label className="flex cursor-pointer items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={perTerrainPriority}
                  onChange={(e) => {
                    setPerTerrainPriority(e.target.checked);
                    if (e.target.checked) {
                      setTerrainPriorityKeys({
                        Land: priorityKey, Swamp: priorityKey, SWO: priorityKey,
                      });
                    }
                  }}
                  data-testid="priority-per-terrain-toggle"
                  className="h-3.5 w-3.5 accent-primary"
                />
                Adjust per terrain
              </label>
            ) : (
              <span data-testid="priority-hint">
                Enter oil or gas volumes above to enable value priority.
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Results */}
      {result && (
        <div className="space-y-4">
          <CreateCampaignPanel
            results={result.results}
            engine={result.engine ?? null}
            onCreated={(id) => navigate(`/projects/${id}/data`)}
          />
          {/* KPI bar: total rigs per terrain, at a glance */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {result.results.map((tr) => (
              <div
                key={tr.terrain}
                className="rounded-xl border border-border/70 bg-card p-4 shadow-soft-sm"
                style={{ borderTopColor: TERRAIN_COLOR[tr.terrain], borderTopWidth: 3 }}
              >
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {TERRAIN_LABEL[tr.terrain]}
                </div>
                {tr.feasible ? (
                  <>
                    <div className="mt-1 text-3xl font-semibold tabular-nums">
                      {tr.rig_count}
                      <span className="ml-1.5 text-sm font-normal text-muted-foreground">
                        rig{tr.rig_count !== 1 ? "s" : ""}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {tr.binding
                        ? `set by ${tr.binding.project} in ${tr.binding.year}`
                        : "single-rig terrain"}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      by year:{" "}
                      {Object.entries(tr.rigs_active_per_year)
                        .map(([y, n]) => `${y}: ${n}`)
                        .join(" · ")}
                    </div>
                    {tr.priority_used && (
                      <div className="mt-1 text-xs text-muted-foreground">
                        Priority: {priorityLabelOf(tr.priority_used)}
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div className="mt-1 text-2xl font-semibold text-destructive">
                      Infeasible
                    </div>
                    <div className="mt-1 text-xs text-destructive/90">
                      {tr.infeasible_wells
                        .map((w) => `${w.project} (${w.year})`)
                        .filter((v, i, a) => a.indexOf(v) === i)
                        .join(", ")}{" "}
                      cannot be met under the current rules — relax an assumption
                      (slip, spud-based delivery) or re-plan those years.
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>

          {/* Rig sequence — the same Gantt as the campaign sequence view */}
          {chartActivities.length > 0 && (
            <div className="rounded-xl border border-border/70 bg-card p-4 shadow-soft-sm">
              <h2 className="mb-2 text-sm font-semibold">Rig sequence</h2>
              <ErrorBoundary label="rig sequence chart">
                <DrillChart activities={chartActivities} enableFilters />
              </ErrorBoundary>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 border-t border-border/60 pt-2 text-xs text-muted-foreground">
                {result.results
                  .filter((tr) => tr.feasible)
                  .flatMap((tr) =>
                    Object.entries(tr.utilization_per_rig).map(([rig, u]) => (
                      <span key={rig}>
                        {rig}: {(u * 100).toFixed(0)}% utilized
                      </span>
                    )),
                  )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** The optimizer→campaign bridge: turn this run's schedule into a NEW Draft
 *  campaign (planner-refined afterwards; full governance applies). The rigs
 *  land in the fleet registry as planned slots. */
function CreateCampaignPanel({
  results,
  engine,
  onCreated,
}: {
  results: TerrainResult[];
  engine: string | null;
  onCreated: (projectId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [field, setField] = useState("");
  const [defaultType, setDefaultType] = useState("Oil Development");
  const [creating, setCreating] = useState(false);

  const feasible = results.filter((r) => r.feasible && r.rigs.some((rig) => rig.wells.length > 0));
  const wellTotal = feasible.reduce(
    (n, tr) => n + tr.rigs.reduce((m, rig) => m + rig.wells.length, 0),
    0,
  );
  if (feasible.length === 0) return null;

  async function create() {
    if (!name.trim()) {
      toast.error("Give the campaign a name.");
      return;
    }
    setCreating(true);
    try {
      const created = await optimizerApi.createCampaign({
        name: name.trim(),
        field: field.trim() || null,
        default_activity_type: defaultType.trim() || "Oil Development",
        engine,
        results: feasible,
      });
      toast.success(
        `Campaign "${created.name}" created — review activity types, wells and markets.`,
      );
      onCreated(created.id);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to create the campaign");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 shadow-soft-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            Turn this result into a campaign
          </h3>
          <p className="text-xs text-muted-foreground">
            Creates a Draft campaign with {wellTotal} scheduled wells; the optimizer's rigs join
            the fleet registry as planned slots. You refine types, wells and markets afterwards —
            the normal endorsement &amp; approval flow applies.
          </p>
        </div>
        {!open && (
          <Button size="sm" onClick={() => setOpen(true)} data-testid="create-campaign-open">
            <FolderPlus className="h-4 w-4" />
            <span className="ml-1.5">Create campaign…</span>
          </Button>
        )}
      </div>
      {open && (
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="space-y-1 text-xs font-medium text-muted-foreground">
            Campaign name *
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Q3 2027 Rig Sequence (optimized)"
              className="w-72"
              maxLength={256}
              data-testid="create-campaign-name"
            />
          </label>
          <label className="space-y-1 text-xs font-medium text-muted-foreground">
            Field (optional)
            <Input value={field} onChange={(e) => setField(e.target.value)} className="w-44" maxLength={256} />
          </label>
          <label className="space-y-1 text-xs font-medium text-muted-foreground">
            Default activity type
            <Input
              value={defaultType}
              onChange={(e) => setDefaultType(e.target.value)}
              className="w-52"
              maxLength={256}
            />
          </label>
          <div className="flex gap-2">
            <Button size="sm" onClick={create} disabled={creating} data-testid="create-campaign-submit">
              {creating ? "Creating…" : "Create Draft campaign"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={creating}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

