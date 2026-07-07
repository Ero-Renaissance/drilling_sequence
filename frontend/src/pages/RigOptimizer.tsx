import { useRef, useState } from "react";
import { Calculator, FileDown, FileUp, Loader2, Plus, Trash2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import {
  optimizerApi,
  type DemandRow,
  type OptimizerAssumptions,
  type OptimizerOptions,
  type OptimizationResponse,
  type Terrain,
} from "@/api/optimizer";
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
  SWO: "Shallow Offshore",
};

const DEFAULT_ASSUMPTIONS: OptimizerAssumptions = {
  well_duration_days: 76,
  inter_well_gap_days: 14,
  batch_size: 3,
  batch_gap_days: 28,
  project_move_days: 45,
  rig_months_per_year: 12,
};

const DEFAULT_OPTIONS: OptimizerOptions = {
  delivery: "finished",
  allow_slip_days: 0,
  allow_drill_ahead: false,
  batch_reset_on_new_year: false,
};

const DEFAULT_YEARS = [2027, 2028, 2029, 2030, 2031];

interface GridRow {
  terrain: Terrain;
  project: string;
  wells: Record<number, number | "">;
}

function emptyRow(): GridRow {
  return { terrain: "Land", project: "", wells: {} };
}


/** Assumption field with a label — numbers only, bounds enforced server-side too. */
function NumberField({
  label,
  value,
  onChange,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  suffix?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      <span>{label}</span>
      <span className="flex items-center gap-1.5">
        <Input
          type="number"
          value={value}
          min={0}
          onChange={(e) => onChange(Number(e.target.value))}
          className="h-8 w-24 text-sm"
        />
        {suffix && <span className="text-[11px]">{suffix}</span>}
      </span>
    </label>
  );
}

export function RigOptimizer() {
  const [assumptions, setAssumptions] = useState(DEFAULT_ASSUMPTIONS);
  const [options, setOptions] = useState(DEFAULT_OPTIONS);
  const [years, setYears] = useState<number[]>(DEFAULT_YEARS);
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

  function setWell(i: number, year: number, value: string) {
    const parsed = value === "" ? "" : Math.max(0, Math.floor(Number(value)));
    setRows((rs) =>
      rs.map((r, j) =>
        j === i ? { ...r, wells: { ...r.wells, [year]: parsed as number | "" } } : r,
      ),
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
        wells_by_year: Object.fromEntries(
          years
            .filter((y) => Number(r.wells[y]) > 0)
            .map((y) => [String(y), Number(r.wells[y])]),
        ),
      }))
      .filter((r) => Object.keys(r.wells_by_year).length > 0);
  }

  async function run() {
    const demand = buildDemand();
    if (demand.length === 0) {
      toast.error("Add at least one project row with wells in a year");
      return;
    }
    setRunning(true);
    try {
      const res = await optimizerApi.run({ demand, assumptions, options });
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
      const blob = await optimizerApi.exportExcel({ demand, assumptions, options });
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
            onChange={(v) => setA({ well_duration_days: v })}
            suffix="days (76 ≈ 2.5 months)"
          />
          <NumberField
            label="Gap between wells"
            value={assumptions.inter_well_gap_days}
            onChange={(v) => setA({ inter_well_gap_days: v })}
            suffix="days"
          />
          <NumberField
            label="Batch size"
            value={assumptions.batch_size}
            onChange={(v) => setA({ batch_size: v })}
            suffix="wells"
          />
          <NumberField
            label="Gap after batch"
            value={assumptions.batch_gap_days}
            onChange={(v) => setA({ batch_gap_days: v })}
            suffix="days (replaces the well gap)"
          />
          <NumberField
            label="Move between projects"
            value={assumptions.project_move_days}
            onChange={(v) => setA({ project_move_days: v })}
            suffix="days"
          />
          <NumberField
            label="Rig availability"
            value={assumptions.rig_months_per_year}
            onChange={(v) => setA({ rig_months_per_year: Math.min(12, v) })}
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
            <Input
              type="number"
              min={0}
              value={options.allow_slip_days}
              onChange={(e) => setO({ allow_slip_days: Math.max(0, Number(e.target.value)) })}
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

        <div className="overflow-x-auto p-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="pb-2 pr-2">Terrain</th>
                <th className="pb-2 pr-2">Project</th>
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
                        <option key={t}>{t}</option>
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
                  {years.map((y) => (
                    <td key={y} className="px-1 py-1.5 text-center">
                      <Input
                        type="number"
                        min={0}
                        value={row.wells[y] ?? ""}
                        onChange={(e) => setWell(i, y, e.target.value)}
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
        </div>
      </div>

      {/* Results */}
      {result && (
        <div className="space-y-4">
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
