import { useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
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
import { importActivities } from "@/api/activities";

interface ImportDialogProps {
  projectId: string;
  onImported: (count: number) => void;
}

// A blank import template offered for download from the dialog. Keep in sync with
// docs/activity-import-template.csv; the canonical column names/values come from the
// backend importer (backend/app/services/data_processor.py).
const IMPORT_TEMPLATE_CSV = [
  "Activity Type,Start Date,End Date,Well Name,Rig Name,Location,Plan Type,Risk,Comment",
  "Oil Development,2026-01-15,2026-06-30,W-A1,Land Rig 1,LAND,Firm,Medium,First development well",
  "Gas Appraisal,2026-07-01,2026-10-15,W-B2,Swamp Rig 2,SWAMP,Option,Low,",
  "Water Injection,2026-11-01,2027-02-28,W-C3,Offshore Rig 1,OFFSHORE,Out of Plan,High,Pending contract",
  "",
].join("\n");

function downloadImportTemplate() {
  const blob = new Blob([IMPORT_TEMPLATE_CSV], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "activity-import-template.csv";
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
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setError(null);
  }

  async function handleSubmit() {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const result = await importActivities(projectId, file, replace);
      onImported(result.imported);
      setOpen(false);
      setFile(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setLoading(false);
    }
  }

  function handleOpenChange(val: boolean) {
    setOpen(val);
    if (!val) {
      setFile(null);
      setError(null);
    }
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
        <DialogHeader>
          <DialogTitle>Import Activities</DialogTitle>
          <DialogDescription>
            Upload a CSV or Excel file. Required columns: Activity Type, Start
            Date, End Date.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <button
            type="button"
            onClick={downloadImportTemplate}
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
              <p className="text-sm text-muted-foreground">
                Click to select a file
              </p>
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
            <p className="text-sm text-destructive" role="alert">
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
      </DialogContent>
    </Dialog>
  );
}
