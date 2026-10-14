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
import { loadLensReadiness, type LensReadiness } from "@/lib/readiness-lens";
import {
  ALL_LENS,
  PROJECTS_TEAM,
  ReadinessLensProvider,
  lensLabel,
  useReadinessTeams,
  type Lens,
} from "@/components/readiness/catalog";

/**
 * "Print" on the Sequence tab — a working copy of the LIVE plan, no revision
 * required. Deliberately the whole plan (never the chart's active filters) so
 * two people's printouts of "the sequence" can't differ silently; the formal
 * signed record stays on the Approvals tab per revision.
 */
export function SequencePrintControl({
  projectId,
  activities,
  lens = PROJECTS_TEAM,
  rigContractsByLane,
}: {
  projectId: string;
  activities: Activity[];
  /** The chart's current lens — the default for the readiness icons printed. */
  lens?: Lens;
  rigContractsByLane?: Map<string, RigContract>;
}) {
  const [chart, setChart] = useState<"standard" | "readiness">("standard");
  // Which team's icons the readiness print shows: a planner prints the project
  // gates, the Wells / Logistics teams their own. Follows the chart's lens.
  const teams = useReadinessTeams();
  const [printLens, setPrintLens] = useState<Lens>(lens);
  useEffect(() => setPrintLens(lens), [lens]);
  const [lensData, setLensData] = useState<LensReadiness | null>(null);
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
    setFetching(true);
    try {
      if (!p) {
        p = await projectsApi.get(projectId);
        setProject(p);
      }
      // Readiness is captured at print time, for the chosen lens — the working
      // copy shows live status as of this moment. Best-effort: a failed load
      // prints the sequence without icons rather than not at all.
      setLensData(
        await loadLensReadiness(projectId, printLens, { activities, teams }).catch(() => ({
          map: new Map(),
          keyOf: () => null,
        })),
      );
    } catch {
      toast.error("Failed to load the campaign details for printing");
      return;
    } finally {
      setFetching(false);
    }
    setAsOf(new Date());
    setPrinting(true);
    setNonce((n) => n + 1);
  }, [claimId, project, projectId, printLens, activities, teams]);

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

  // Live activities → print rows: denormalise each activity's readiness under
  // the print lens and its rig's contract end, mirroring what a revision
  // snapshot stores. Live contracts are binding (no legacy "Draft" workflow),
  // so status stays null.
  const rows: PrintRow[] = useMemo(
    () =>
      activities.map((a) => {
        const key = lensData?.keyOf(a) ?? null;
        const gates = key !== null ? lensData?.map.get(key) : undefined;
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
          // Under a team lens a row with no entry (e.g. no well name for a
          // well-level lens) prints no strip; the project-gates lens keeps the
          // existing per-project behaviour (no explicit key).
          readiness_required:
            printLens !== PROJECTS_TEAM && !gates ? false : a.readiness_required,
          readiness_key: printLens === PROJECTS_TEAM ? undefined : key,
          rig_contract_status: null,
          rig_contract_end: contract?.contract_end ?? null,
          completed_at: a.completed_at,
        };
      }),
    [activities, lensData, printLens, rigContractsByLane],
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
          {chart === "readiness" && teams.length > 1 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Readiness icons</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={printLens} onValueChange={setPrintLens}>
                {teams.map((t) => (
                  <DropdownMenuRadioItem
                    key={t.code}
                    value={t.code}
                    onSelect={(e) => e.preventDefault()}
                  >
                    {lensLabel(t)}
                  </DropdownMenuRadioItem>
                ))}
                <DropdownMenuRadioItem value={ALL_LENS} onSelect={(e) => e.preventDefault()}>
                  All teams (one badge each)
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </>
          )}
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

            <ReadinessLensProvider lens={printLens}>
              <WorkingCopyPrintDoc
                project={project}
                rows={rows}
                chart={chart}
                readinessYears={years}
                includeSchedule={schedule}
                asOf={asOf}
                readinessLabel={lensLabel(
                  teams.find((t) => t.code === printLens) ?? { code: printLens, name: printLens },
                )}
              />
            </ReadinessLensProvider>

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
