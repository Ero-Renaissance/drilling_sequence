import { useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, Upload, Wand2 } from "lucide-react";
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
import {
  downloadImportTemplate,
  importActivities,
  type ImportResult,
  type TypeMappingChoice,
  type UnknownActivityType,
} from "@/api/activities";
import { CATALOGUE_ACTIVITY_TYPES } from "@/lib/chart-colors";

const KEEP_AS_IS = ""; // sentinel: leave the value verbatim (charts grey, warned)

/** The manual-mapping step: shown only when a dry-run finds sheet activity
 *  types outside the catalogue. Maps values (not rows), offers "keep as-is",
 *  and a per-mapping "remember" so next quarter's upload resolves it silently. */
interface MappingState {
  file: File;
  unknowns: UnknownActivityType[];
  choices: Record<string, string>; // value → canonical, or KEEP_AS_IS
  remember: Record<string, boolean>;
}

interface ImportDialogProps {
  projectId: string;
  onImported: (count: number) => void;
  /** When the campaign is locked (a revision awaiting approval), the trigger is
   *  disabled — the backend would 423 the import anyway. */
  locked?: boolean;
}

// How many skipped rows to list inline before collapsing to a "+N more" + download.
const MAX_INLINE_SKIPPED = 10;

// Exported for tests. Beyond RFC-4180 quoting, a leading = + - @ (or tab/CR)
// is prefixed with ' so a cell like "=cmd|..." arriving from an imported sheet
// re-exports as inert text instead of executing as a formula when the CSV is
// opened in Excel (CSV/formula injection).
export function csvCell(value: string): string {
  const deFormula = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n]/.test(deFormula) ? `"${deFormula.replace(/"/g, '""')}"` : deFormula;
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function downloadCsv(filename: string, content: string) {
  downloadBlob(filename, new Blob([content], { type: "text/csv;charset=utf-8" }));
}

export function ImportDialog({ projectId, onImported, locked }: ImportDialogProps) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [replace, setReplace] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [mapping, setMapping] = useState<MappingState | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function resetState() {
    setFile(null);
    setError(null);
    setResult(null);
    setMapping(null);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setFile(e.target.files?.[0] ?? null);
    setError(null);
  }

  /** Commit the import (optionally with the resolved mapping) and show results. */
  async function commit(f: File, choice?: TypeMappingChoice) {
    setLoading(true);
    setError(null);
    try {
      const r = await importActivities(projectId, f, replace, { mapping: choice });
      onImported(r.imported); // refresh the sequence behind the dialog
      setResult(r); // flip to the results view
      setMapping(null);
      setFile(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit() {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      // Dry run first: validate + resolve types, write NOTHING. Only if the
      // sheet carries unrecognised types do we interrupt with the mapping step;
      // a clean sheet commits straight through with no extra clicks.
      const preview = await importActivities(projectId, file, replace, { dryRun: true });
      if (preview.unknown_types.length > 0) {
        setMapping({
          file,
          unknowns: preview.unknown_types,
          choices: Object.fromEntries(preview.unknown_types.map((u) => [u.value, KEEP_AS_IS])),
          remember: {},
        });
        setLoading(false);
        return;
      }
      await commit(file); // nothing to map — go straight to the real import
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
      setLoading(false);
    }
  }

  function confirmMapping() {
    if (!mapping) return;
    const mappings: Record<string, string> = {};
    const remember: string[] = [];
    for (const u of mapping.unknowns) {
      const target = mapping.choices[u.value];
      if (target && target !== KEEP_AS_IS) {
        mappings[u.value] = target;
        if (mapping.remember[u.value]) remember.push(u.value);
      }
    }
    void commit(mapping.file, { mappings, remember });
  }

  function handleOpenChange(val: boolean) {
    setOpen(val);
    if (!val) resetState();
  }

  function downloadSkipped() {
    if (!result) return;
    const rows = result.skipped_rows.map((r) => `${csvCell(r.well)},${csvCell(r.reason)}`);
    downloadCsv("skipped-wells.csv", ["Well Name,Reason", ...rows].join("\n"));
  }

  async function downloadTemplate() {
    try {
      const blob = await downloadImportTemplate(projectId);
      downloadBlob("schedule-import-template.xlsx", blob);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Template download failed");
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={locked}
          title={locked ? "A revision is awaiting approval — the plan is locked." : undefined}
        >
          <Upload className="mr-2 h-4 w-4" />
          Import CSV / Excel
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        {mapping ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Wand2 className="h-4 w-4 text-primary" />
                Map unrecognised activity types
              </DialogTitle>
              <DialogDescription>
                {mapping.unknowns.length}{" "}
                {mapping.unknowns.length === 1 ? "value isn't" : "values aren't"} in the
                catalogue. Map each to a canonical type, or keep it as-is (it imports and
                charts grey until an admin adds it). Nothing has been imported yet.
              </DialogDescription>
            </DialogHeader>

            <div className="max-h-[22rem] space-y-3 overflow-y-auto py-2">
              {mapping.unknowns.map((u) => {
                const choice = mapping.choices[u.value] ?? KEEP_AS_IS;
                return (
                  <div key={u.value} className="rounded-md border border-border px-3 py-2.5">
                    <div className="mb-1.5 flex items-baseline justify-between gap-2">
                      <span className="font-mono text-[13px] font-medium text-foreground">
                        {u.value}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {u.rows} {u.rows === 1 ? "row" : "rows"}
                      </span>
                    </div>
                    <select
                      value={choice}
                      onChange={(e) =>
                        setMapping((m) =>
                          m ? { ...m, choices: { ...m.choices, [u.value]: e.target.value } } : m,
                        )
                      }
                      aria-label={`Map ${u.value}`}
                      data-testid={`map-select-${u.value}`}
                      className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    >
                      <option value={KEEP_AS_IS}>Keep as-is (charts grey)</option>
                      {CATALOGUE_ACTIVITY_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                    {choice !== KEEP_AS_IS && (
                      <label className="mt-1.5 flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={!!mapping.remember[u.value]}
                          onChange={(e) =>
                            setMapping((m) =>
                              m
                                ? { ...m, remember: { ...m.remember, [u.value]: e.target.checked } }
                                : m,
                            )
                          }
                          data-testid={`remember-${u.value}`}
                        />
                        Remember this mapping for future imports
                      </label>
                    )}
                  </div>
                );
              })}
            </div>

            {error && (
              <p className="whitespace-pre-line text-sm text-destructive" role="alert">
                {error}
              </p>
            )}

            <DialogFooter>
              <Button variant="ghost" onClick={() => setMapping(null)} disabled={loading}>
                Back
              </Button>
              <Button onClick={confirmMapping} disabled={loading} data-testid="confirm-mapping">
                {loading ? "Importing…" : "Apply & import"}
              </Button>
            </DialogFooter>
          </>
        ) : result ? (
          <>
            <DialogHeader>
              <DialogTitle>Import results</DialogTitle>
              <DialogDescription>
                Your sequence has been updated. Any rows that couldn't be imported are
                listed below.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="flex items-start gap-2.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
                  {result.imported} {result.imported === 1 ? "well" : "wells"} imported
                </p>
              </div>

              {result.applied_mappings.length > 0 && (
                <div className="space-y-1.5">
                  <p className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                    <Wand2 className="h-3.5 w-3.5 text-primary" />
                    Activity types mapped:
                  </p>
                  <ul className="space-y-1 text-xs text-muted-foreground">
                    {result.applied_mappings.map((m, i) => (
                      <li key={i}>
                        <span className="font-mono">{m.source}</span> →{" "}
                        <span className="font-medium text-foreground">{m.target}</span>{" "}
                        <span className="text-muted-foreground/70">
                          ({m.rows} {m.rows === 1 ? "row" : "rows"})
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {result.skipped > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 text-sm">
                    <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
                    <span className="font-medium">
                      {result.skipped} {result.skipped === 1 ? "well" : "wells"} skipped
                    </span>
                    <span className="text-muted-foreground">— fix these rows and re-upload</span>
                  </div>

                  <div className="divide-y divide-border rounded-md border border-border">
                    {result.skipped_rows.slice(0, MAX_INLINE_SKIPPED).map((r, i) => (
                      <div key={i} className="flex gap-2.5 px-3 py-2">
                        <span className="min-w-[68px] shrink-0 font-mono text-[13px] font-medium">
                          {r.well}
                        </span>
                        <span className="text-[13px] text-muted-foreground">{r.reason}</span>
                      </div>
                    ))}
                    {result.skipped_rows.length > MAX_INLINE_SKIPPED && (
                      <div className="px-3 py-2 text-[13px] text-muted-foreground">
                        +{result.skipped_rows.length - MAX_INLINE_SKIPPED} more — download for
                        the full list
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={downloadSkipped}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Download skipped (.csv)
                  </button>
                </div>
              )}

              {result.warnings.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-foreground">
                    {result.warnings.length}{" "}
                    {result.warnings.length === 1 ? "notice" : "notices"} — imported fine,
                    worth a look:
                  </p>
                  <ul className="max-h-32 space-y-1 overflow-y-auto text-xs text-muted-foreground">
                    {result.warnings.slice(0, 8).map((w, i) => (
                      <li key={i}>• {w}</li>
                    ))}
                    {result.warnings.length > 8 && (
                      <li>…and {result.warnings.length - 8} more.</li>
                    )}
                  </ul>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="ghost" onClick={resetState}>
                Import another
              </Button>
              <Button onClick={() => handleOpenChange(false)}>Done — view sequence</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Import Activities</DialogTitle>
              <DialogDescription>
                Upload the drilling schedule (CSV or Excel), one row per activity — the
                importer reads Project, Market, plan type, risk and rig-contract expiry. Readiness
                is managed on the Readiness tab in the app, not in the upload, so
                re-importing never resets gate statuses. (Older file layouts still import.)
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <button
                type="button"
                onClick={downloadTemplate}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
              >
                <Download className="h-3.5 w-3.5" />
                Download a blank template (.xlsx)
              </button>

              <p className="text-xs text-muted-foreground">
                The template's <strong>Guidance</strong> sheet lists the canonical activity
                types and every rule. Key ones: dates are <strong>day-first</strong>{" "}
                (DD/MM/YYYY); <strong>one row per activity</strong>; a rig is identified by{" "}
                <strong>Location + Rig Name</strong> — the same name on land and in swamp is
                two physical rigs, which the import confirms with a notice.
              </p>

              <div
                className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 cursor-pointer hover:bg-muted/50 transition-colors"
                onClick={() => inputRef.current?.click()}
                onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
                role="button"
                tabIndex={0}
              >
                <Upload className="mb-2 h-6 w-6 text-muted-foreground" />
                {file ? (
                  <p className="text-sm font-medium">{file.name}</p>
                ) : (
                  <p className="text-sm text-muted-foreground">Click to select a file</p>
                )}
                <p className="text-xs text-muted-foreground mt-1">.csv, .xlsx, .xls</p>
              </div>

              <input
                ref={inputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                onChange={handleFileChange}
                data-testid="file-input"
              />

              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={replace}
                  onChange={(e) => setReplace(e.target.checked)}
                  className="rounded"
                />
                Replace all existing activities
              </label>

              {error && (
                <p
                  className="max-h-44 overflow-auto whitespace-pre-line text-sm text-destructive"
                  role="alert"
                >
                  {error}
                </p>
              )}
            </div>

            <DialogFooter>
              <Button variant="ghost" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={handleSubmit} disabled={!file || loading}>
                {loading ? "Importing..." : "Import"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
