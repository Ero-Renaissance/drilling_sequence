import { useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, Upload } from "lucide-react";
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
import { importActivities, type ImportResult } from "@/api/activities";

interface ImportDialogProps {
  projectId: string;
  onImported: (count: number) => void;
}

// How many skipped rows to list inline before collapsing to a "+N more" + download.
const MAX_INLINE_SKIPPED = 10;

// A sample of the long schedule format offered for download — one row per readiness
// check per well. Column names/values mirror the backend importer
// (backend/app/services/data_processor.py).
const IMPORT_TEMPLATE_CSV = [
  "Location,Rig Name,Activity Type,Plan Type,Project,Well Name,Start Date,End Date,Rig Contract Expiry Date,Risk,Readiness Check,Readiness Check Status,Comment",
  "LAND,Rig 1,Gas Development,In Plan (Firm),Project Alpha,Well-1,2026-01-15,2026-06-30,2030-12-31,No Flood Risk,FDP,Completed,First development well",
  "LAND,Rig 1,Gas Development,In Plan (Firm),Project Alpha,Well-1,2026-01-15,2026-06-30,2030-12-31,No Flood Risk,LLI,On track,",
  "LAND,Rig 1,Gas Development,In Plan (Firm),Project Alpha,Well-1,2026-01-15,2026-06-30,2030-12-31,No Flood Risk,LOC,On track,",
  "LAND,Rig 1,Gas Development,In Plan (Firm),Project Alpha,Well-1,2026-01-15,2026-06-30,2030-12-31,No Flood Risk,FE,On track,",
  "LAND,Rig 1,Gas Development,In Plan (Firm),Project Alpha,Well-1,2026-01-15,2026-06-30,2030-12-31,No Flood Risk,FID,On track,",
  "LAND,Rig 1,Gas Development,In Plan (Firm),Project Alpha,Well-1,2026-01-15,2026-06-30,2030-12-31,No Flood Risk,EIA,On track,",
  "LAND,Rig 1,Gas Development,In Plan (Firm),Project Alpha,Well-1,2026-01-15,2026-06-30,2030-12-31,No Flood Risk,BUD,On track,",
  "",
].join("\n");

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function downloadCsv(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function ImportDialog({ projectId, onImported }: ImportDialogProps) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [replace, setReplace] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function resetState() {
    setFile(null);
    setError(null);
    setResult(null);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setFile(e.target.files?.[0] ?? null);
    setError(null);
  }

  async function handleSubmit() {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const r = await importActivities(projectId, file, replace);
      onImported(r.imported); // refresh the sequence behind the dialog
      setResult(r); // flip to the results view (success + any skipped rows)
      setFile(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setLoading(false);
    }
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

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Upload className="mr-2 h-4 w-4" />
          Import CSV / Excel
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        {result ? (
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
                <p className="text-xs text-muted-foreground">
                  {result.warnings.length} readiness{" "}
                  {result.warnings.length === 1 ? "cell was" : "cells were"} dropped
                  (non-standard status).
                </p>
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
                Upload the drilling-schedule export (CSV or Excel). One row per readiness
                check per well — the importer groups them into wells and reads Project,
                readiness, risk and rig-contract expiry. (Older one-row-per-activity files
                still import.)
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <button
                type="button"
                onClick={() => downloadCsv("schedule-import-template.csv", IMPORT_TEMPLATE_CSV)}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
              >
                <Download className="h-3.5 w-3.5" />
                Download a blank template
              </button>

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
