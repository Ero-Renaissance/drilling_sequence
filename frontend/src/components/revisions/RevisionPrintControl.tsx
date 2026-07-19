import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, FileSignature, Printer } from "lucide-react";

import { getRevision, type Revision, type RevisionDetail } from "@/api/revisions";
import type { Project } from "@/types";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/toaster";
import { RevisionPrintDoc, type PrintRow } from "@/components/revisions/RevisionPrintDoc";
import { buildDocRef } from "@/lib/doc-id";
import { readinessPageCss, readinessPaperSize, type PrintYears } from "@/lib/print-gantt";

// Only one revision's print document may be mounted at a time — a second
// instance claiming the printer tells every other instance to stand down.
const CLAIM_EVENT = "ds-revision-print-claim";

function statusLabel(status: Revision["status"]): string {
  switch (status) {
    case "approved":
      return "Approved";
    case "rejected":
      return "Rejected";
    case "changes_requested":
      return "Changes requested";
    case "discarded":
      return "Discarded";
    case "pending_review":
      return "Awaiting endorsement";
    default:
      return "Pending approval";
  }
}

/**
 * The revision print/export menu — document production, deliberately separate
 * from the signing workflow (the cockpit holds decisions only). Lives on the
 * Approvals tab beside each revision. Two outputs: the JV record with recorded
 * signatures (Export PDF) and the blank wet-ink form (Print for signature —
 * paper signing still happens). Fetches the full snapshot on demand.
 */
export function RevisionPrintControl({
  projectId,
  revision,
  project,
}: {
  projectId: string;
  /** List-level revision (no snapshot); the control fetches detail on print. */
  revision: Revision;
  project: Project | null;
}) {
  const [chart, setChart] = useState<"standard" | "readiness">("standard");
  const [years, setYearsState] = useState<PrintYears>(() => {
    try {
      const v = Number(window.localStorage.getItem("ds.print-years"));
      return v === 1 || v === 2 || v === 3 ? (v as PrintYears) : 3;
    } catch {
      return 3;
    }
  });
  const [schedule, setSchedule] = useState(true);
  const [detail, setDetail] = useState<RevisionDetail | null>(null);
  const [fetching, setFetching] = useState(false);
  // Non-null while THIS control owns the print document.
  const [printing, setPrinting] = useState<"system" | "wetink" | null>(null);
  const [nonce, setNonce] = useState(0);

  const setYears = (y: PrintYears) => {
    setYearsState(y);
    try {
      window.localStorage.setItem("ds.print-years", String(y));
    } catch {
      // storage unavailable — the in-session choice still applies
    }
  };

  // Another revision's control claimed the printer → unmount our document.
  useEffect(() => {
    const onClaim = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== revision.id) setPrinting(null);
    };
    window.addEventListener(CLAIM_EVENT, onClaim);
    return () => window.removeEventListener(CLAIM_EVENT, onClaim);
  }, [revision.id]);

  const print = useCallback(
    async (mode: "system" | "wetink") => {
      window.dispatchEvent(new CustomEvent(CLAIM_EVENT, { detail: revision.id }));
      let d = detail;
      if (!d) {
        setFetching(true);
        try {
          d = await getRevision(projectId, revision.id);
          setDetail(d);
        } catch {
          toast.error("Failed to load the revision snapshot for printing");
          return;
        } finally {
          setFetching(false);
        }
      }
      setPrinting(mode);
      setNonce((n) => n + 1);
    },
    [projectId, revision.id, detail],
  );

  // While this control owns the print, mark <body> so the print stylesheet can
  // hide EVERY other body child (the app root, Radix portals, toasts). The
  // "only the document prints" rule is structural — it cannot depend on the
  // host page sprinkling print:hidden on its own sections.
  useEffect(() => {
    if (!printing) return;
    document.body.classList.add("ds-printing-revision");
    return () => document.body.classList.remove("ds-printing-revision");
  }, [printing]);

  // Print once the chosen document has painted; restore afterwards.
  useEffect(() => {
    if (nonce === 0) return;
    const prevTitle = document.title;
    if (project?.name)
      document.title = `Renaissance — ${project.name} — Rev. ${String(revision.rev_number).padStart(2, "0")}`;
    const done = () => {
      document.title = prevTitle;
      setPrinting(null);
    };
    window.addEventListener("afterprint", done, { once: true });
    const id = requestAnimationFrame(() => window.print());
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener("afterprint", done);
      document.title = prevTitle;
    };
  }, [nonce, project, revision.rev_number]);

  const rows: PrintRow[] = printing && detail ? JSON.parse(detail.snapshot_json) : [];
  const docRef = buildDocRef(project?.name, revision.rev_number);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" disabled={fetching} data-testid="revision-print">
            <Printer className="h-3.5 w-3.5" />
            <span className="ml-1">{fetching ? "Loading…" : "Print"}</span>
            <ChevronDown className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel>Chart</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={chart}
            onValueChange={(v) => {
              const c = v as "standard" | "readiness";
              setChart(c);
              // Readiness leads with the chart only; standard keeps the schedule.
              setSchedule(c === "standard");
            }}
          >
            <DropdownMenuRadioItem value="standard" onSelect={(e) => e.preventDefault()}>
              Standard Sequence
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="readiness" onSelect={(e) => e.preventDefault()}>
              Sequence with Readiness Icons
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          {chart === "readiness" && (
            <>
              <DropdownMenuSeparator />
              {/* Paper auto-matches the span (A4/A3/A2) so the month density —
                  and gate-icon legibility — stays near the 1-year baseline. */}
              <DropdownMenuLabel>Years per page</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={String(years)}
                onValueChange={(v) => setYears(Number(v) as PrintYears)}
              >
                {([1, 2, 3] as const).map((y) => (
                  <DropdownMenuRadioItem
                    key={y}
                    value={String(y)}
                    onSelect={(e) => e.preventDefault()}
                  >
                    {y} {y === 1 ? "year" : "years"} · {readinessPaperSize(y)}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuCheckboxItem
            checked={schedule}
            onCheckedChange={setSchedule}
            onSelect={(e) => e.preventDefault()}
          >
            Include Activity Schedule
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => print("system")}>
            <Printer className="h-4 w-4" />
            Export PDF (with signatures)
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => print("wetink")}>
            <FileSignature className="h-4 w-4" />
            Print for signature
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {printing && detail && createPortal(
        <div className="ds-print-doc hidden print:block">
          {/* Print stylesheet — mounted only while this control owns the print. */}
          <style>{`
            @media print {
              /* Exclusivity: everything except this document disappears —
                 whatever page hosts the control, including portal'd menus. */
              body.ds-printing-revision > *:not(.ds-print-doc) { display: none !important; }
              .ds-print-doc { padding-bottom: 12mm; }
              @page { size: ${
                chart === "readiness" ? readinessPageCss(years) : "A4 landscape"
              }; margin: 14mm 12mm; }
              /* Force light document tokens so a dark-mode user still gets a clean,
                 readable PDF (dark text on white), not light text on white. */
              :root, .dark {
                --background: 0 0% 100%;
                --foreground: 222 24% 12%;
                --card: 0 0% 100%;
                --card-foreground: 222 24% 12%;
                --muted: 220 14% 95%;
                --muted-foreground: 220 9% 40%;
                --border: 220 13% 85%;
              }
              body { background: white !important; }
              aside, header, .print\\:hidden { display: none !important; }
              main { overflow: visible !important; }
              /* Unclip scroll containers + height caps so content paginates across
                 pages and the chart legend (below the Gantt) isn't cut off. */
              .overflow-auto, .overflow-y-auto { overflow: visible !important; }
              .h-full, .h-screen { height: auto !important; }
              .shadow-soft-sm, .shadow-soft-md, .shadow-soft-lg { box-shadow: none !important; }
              /* Preserve brand colours (gradient linebar, status badges) in print. */
              * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
              /* Room for the fixed confidentiality footer. */
              main > div { padding-bottom: 12mm; }
              /* The schedule table: repeat the header on every page, keep rows whole,
                 and give clean horizontal rules so it reads as a formal schedule. */
              thead { display: table-header-group; }
              tbody tr { break-inside: avoid; }
              th, td { border-bottom: 1px solid hsl(220 13% 88%) !important; }
              h2 { break-after: avoid; }
            }
          `}</style>

          <RevisionPrintDoc
            revision={detail}
            project={project}
            rows={rows}
            chart={chart}
            readinessYears={years}
            includeSchedule={schedule}
            signatures={printing}
          />

          {/* Print-only confidentiality footer (repeats per page in Chrome). Only the
              JV record (standard chart + recorded signatures) carries the system refs. */}
          <div className="fixed inset-x-0 bottom-0 hidden items-center justify-between border-t border-border/60 bg-white px-3 pt-1 text-[8px] text-muted-foreground print:flex">
            <span>
              Renaissance Africa Energy Company Limited — Confidential
              {chart === "standard" && printing === "system"
                ? " · For JV partner distribution only"
                : ""}
            </span>
            {chart === "standard" && printing === "system" && (
              <span className="tabular-nums">
                {docRef} · {statusLabel(detail.status)} · Uncontrolled when printed
              </span>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
