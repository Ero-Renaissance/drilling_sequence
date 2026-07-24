import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Printer } from "lucide-react";

import { projectsApi } from "@/api/projects";
import type { Activity } from "@/api/activities";
import type { RigContract } from "@/api/contracts";
import type { CheckStatus } from "@/api/readiness";
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
import { WorkingCopyPrintDoc, type PrintRow } from "@/components/revisions/RevisionPrintDoc";
import { PRINT_CLAIM_EVENT, printDocCss } from "@/lib/print-css";
import { readinessPageCss, readinessPaperSize, type PrintYears } from "@/lib/print-gantt";
import { rigLaneKey } from "@/lib/resource-identity";
import type { ReadinessMap } from "@/lib/chart-utils";

/**
 * "Print" on the Sequence tab — a working copy of the LIVE plan, no revision
 * required. Deliberately the whole plan (never the chart's active filters) so
 * two people's printouts of "the sequence" can't differ silently; the formal
 * signed record stays on the Approvals tab per revision.
 */
export function SequencePrintControl({
  projectId,
  activities,
  readinessMap,
  rigContractsByLane,
}: {
  projectId: string;
  activities: Activity[];
  readinessMap?: ReadinessMap;
  rigContractsByLane?: Map<string, RigContract>;
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
  const [project, setProject] = useState<Project | null>(null);
  const [fetching, setFetching] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [asOf, setAsOf] = useState<Date>(() => new Date());
  const [nonce, setNonce] = useState(0);

  // Same persisted paper habit as the revision control.
  const setYears = (y: PrintYears) => {
    setYearsState(y);
    try {
      window.localStorage.setItem("ds.print-years", String(y));
    } catch {
      // storage unavailable — the in-session choice still applies
    }
  };

  // One printer: a revision control (or another sequence control) claiming the
  // print unmounts our document, and vice versa.
  const claimId = `sequence:${projectId}`;
  useEffect(() => {
    const onClaim = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== claimId) setPrinting(false);
    };
    window.addEventListener(PRINT_CLAIM_EVENT, onClaim);
    return () => window.removeEventListener(PRINT_CLAIM_EVENT, onClaim);
  }, [claimId]);

  const print = useCallback(async () => {
    window.dispatchEvent(new CustomEvent(PRINT_CLAIM_EVENT, { detail: claimId }));
    let p = project;
    if (!p) {
      setFetching(true);
      try {
        p = await projectsApi.get(projectId);
        setProject(p);
      } catch {
        toast.error("Failed to load the campaign details for printing");
        return;
      } finally {
        setFetching(false);
      }
    }
    setAsOf(new Date());
    setPrinting(true);
    setNonce((n) => n + 1);
  }, [claimId, project, projectId]);

  useEffect(() => {
    if (!printing) return;
    document.body.classList.add("ds-printing-revision");
    return () => document.body.classList.remove("ds-printing-revision");
  }, [printing]);

  // Print once the document has painted; restore afterwards.
  useEffect(() => {
    if (nonce === 0) return;
    const prevTitle = document.title;
    if (project?.name) document.title = `Renaissance — ${project.name} — Working copy`;
    const done = () => {
      document.title = prevTitle;
      setPrinting(false);
    };
    window.addEventListener("afterprint", done, { once: true });
    const id = requestAnimationFrame(() => window.print());
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener("afterprint", done);
      document.title = prevTitle;
    };
  }, [nonce, project]);

  // Live activities → print rows: denormalise each activity's project gates and
  // its rig's contract end, mirroring what a revision snapshot stores. Live
  // contracts are binding (no legacy "Draft" workflow), so status stays null.
  const rows: PrintRow[] = useMemo(
    () =>
      activities.map((a) => {
        const gates = a.well_project ? readinessMap?.get(a.well_project) : undefined;
        const readiness = gates
          ? Object.fromEntries(
              Object.entries(gates).map(([code, v]) => [code, v.status as CheckStatus]),
            )
          : undefined;
        const contract =
          a.rig_name && rigContractsByLane
            ? rigContractsByLane.get(rigLaneKey(a.location, a.rig_name))
            : undefined;
        return {
          id: a.id,
          activity_type: a.activity_type,
          start_date: a.start_date,
          end_date: a.end_date,
          well_name: a.well_name,
          well_project: a.well_project,
          rig_name: a.rig_name,
          hwu_name: a.hwu_name,
          location: a.location,
          plan_type: a.plan_type,
          risk: a.risk,
          readiness,
          readiness_required: a.readiness_required,
          rig_contract_status: null,
          rig_contract_end: contract?.contract_end ?? null,
          completed_at: a.completed_at,
        };
      }),
    [activities, readinessMap, rigContractsByLane],
  );

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            disabled={fetching}
            className="text-muted-foreground"
            data-testid="sequence-print"
            title="Print the live plan as a working copy — no revision needed"
          >
            <Printer className="h-4 w-4" />
            <span className="ml-1.5">{fetching ? "Loading…" : "Print"}</span>
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
          <DropdownMenuItem onSelect={() => print()}>
            <Printer className="h-4 w-4" />
            Print working copy
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {printing &&
        createPortal(
          <div className="ds-print-doc hidden print:block">
            <style>
              {printDocCss(chart === "readiness" ? readinessPageCss(years) : "A4 landscape")}
            </style>

            <WorkingCopyPrintDoc
              project={project}
              rows={rows}
              chart={chart}
              readinessYears={years}
              includeSchedule={schedule}
              asOf={asOf}
            />

            {/* Print-only footer — clearly a working copy, never the record. */}
            <div className="fixed inset-x-0 bottom-0 hidden items-center justify-between border-t border-border/60 bg-white px-3 pt-1 text-[8px] text-muted-foreground print:flex">
              <span>Renaissance Africa Energy Company Limited — Confidential</span>
              <span>Working copy · unapproved · uncontrolled when printed</span>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
