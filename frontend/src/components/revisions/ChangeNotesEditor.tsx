import { useState } from "react";

import { upsertChangeNote, type ChangeNote, type ChangeNoteKind } from "@/api/change-notes";
import type { ActivityDiff, ContractDiff } from "@/api/compare";
import { PaginationFooter } from "@/components/ui/pagination-footer";
import { toast } from "@/components/ui/toaster";
import { cn } from "@/lib/utils";

interface ResourceGroup {
  kind: ChangeNoteKind;
  resourceName: string | null;
  label: string;
  activities: ActivityDiff[];
}

const groupKey = (kind: ChangeNoteKind, name: string | null) => `${kind}:${name ?? ""}`;

const labelFor = (kind: ChangeNoteKind, name: string | null) =>
  kind === "hwu" ? `HWU · ${name ?? ""}` : kind === "general" ? "No resource" : name ?? "";

function resourceOf(a: ActivityDiff): { kind: ChangeNoteKind; name: string | null; label: string } {
  if (a.rig_name) return { kind: "rig", name: a.rig_name, label: a.rig_name };
  if (a.hwu_name) return { kind: "hwu", name: a.hwu_name, label: `HWU · ${a.hwu_name}` };
  return { kind: "general", name: null, label: "No resource" };
}

/** A ContractDiff.resource is the rig name, or "HWU · <name>". */
function parseContractResource(resource: string): { kind: ChangeNoteKind; name: string } {
  return resource.startsWith("HWU · ")
    ? { kind: "hwu", name: resource.slice("HWU · ".length) }
    : { kind: "rig", name: resource };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fmtMonth(iso: string | null): string | null {
  if (!iso) return null;
  const [y, m] = iso.split("-");
  return MONTHS[Number(m) - 1] ? `${MONTHS[Number(m) - 1]} ${y.slice(2)}` : iso;
}

function fmtRange(start: string | null, end: string | null): string {
  const s = fmtMonth(start);
  const e = fmtMonth(end);
  return s || e ? `${s ?? "?"} – ${e ?? "?"}` : "—";
}

const prevOf = (a: ActivityDiff, label: "Start date" | "End date") =>
  a.fields.find((f) => f.field === label)?.old ?? null;

function previousRange(a: ActivityDiff): string {
  if (a.change === "added") return "—";
  if (a.change === "removed") return fmtRange(a.start_date, a.end_date);
  return fmtRange(prevOf(a, "Start date") ?? a.start_date, prevOf(a, "End date") ?? a.end_date);
}

const currentRange = (a: ActivityDiff) =>
  a.change === "removed" ? "—" : fmtRange(a.start_date, a.end_date);

function changeLabel(a: ActivityDiff): string {
  if (a.change === "added") return "Added";
  if (a.change === "modified") return "Modified";
  return a.removal_reason === "completed" ? "Completed" : "Removed";
}

function changeTone(a: ActivityDiff): string {
  if (a.change === "added") return "text-emerald-600 dark:text-emerald-400";
  if (a.change === "modified") return "text-amber-600 dark:text-amber-400";
  if (a.removal_reason === "completed") return "text-sky-600 dark:text-sky-400";
  return "text-red-600 dark:text-red-400";
}

/**
 * Per-resource change-note authoring under the Compare diff. Each rig/HWU shows a
 * paginated table of its changed activities (+ any contract change) and a note box
 * the planner fills — that note is what shows on the Sequence + presentation view.
 */
export function ChangeNotesEditor({
  projectId,
  activities,
  contracts,
  notes,
  canEdit,
  locked,
}: {
  projectId: string;
  activities: ActivityDiff[];
  contracts: ContractDiff[];
  notes: ChangeNote[];
  canEdit: boolean;
  locked: boolean;
}) {
  // Group by resource: changed activities, then fold in resources that only have a
  // contract change or a (stale) note, so nothing relevant is hidden.
  const groups = new Map<string, ResourceGroup>();
  for (const a of activities) {
    const r = resourceOf(a);
    const k = groupKey(r.kind, r.name);
    if (!groups.has(k))
      groups.set(k, { kind: r.kind, resourceName: r.name, label: r.label, activities: [] });
    groups.get(k)!.activities.push(a);
  }
  for (const c of contracts) {
    const { kind, name } = parseContractResource(c.resource);
    const k = groupKey(kind, name);
    if (!groups.has(k)) groups.set(k, { kind, resourceName: name, label: c.resource, activities: [] });
  }
  for (const n of notes) {
    const k = groupKey(n.kind, n.resource_name);
    if (!groups.has(k))
      groups.set(k, {
        kind: n.kind,
        resourceName: n.resource_name,
        label: labelFor(n.kind, n.resource_name),
        activities: [],
      });
  }
  const ordered = [...groups.values()].sort((a, b) => a.label.localeCompare(b.label));
  if (ordered.length === 0) return null;

  const noteFor = (g: ResourceGroup) =>
    notes.find((n) => n.kind === g.kind && (n.resource_name ?? null) === g.resourceName)?.body ?? "";
  const contractFor = (g: ResourceGroup) =>
    contracts.find((c) => c.resource === labelFor(g.kind, g.resourceName));

  return (
    <div className="space-y-2 rounded-lg border border-border/70 bg-muted/20 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Change notes</h3>
          <p className="text-xs text-muted-foreground">
            What changed for each resource vs the last sequence — your note shows on the Sequence
            chart and the presentation view.
          </p>
        </div>
        {!canEdit && (
          <span className="rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700">
            {locked ? "Locked with the plan — reopen to edit" : "Read-only"}
          </span>
        )}
      </div>
      {ordered.map((g) => (
        <ResourceBlock
          key={groupKey(g.kind, g.resourceName)}
          projectId={projectId}
          group={g}
          contract={contractFor(g)}
          initial={noteFor(g)}
          canEdit={canEdit}
          locked={locked}
        />
      ))}
    </div>
  );
}

const PAGE_SIZE = 8;

function ResourceBlock({
  projectId,
  group,
  contract,
  initial,
  canEdit,
  locked,
}: {
  projectId: string;
  group: ResourceGroup;
  contract: ContractDiff | undefined;
  initial: string;
  canEdit: boolean;
  locked: boolean;
}) {
  const [body, setBody] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);

  const pageCount = Math.max(1, Math.ceil(group.activities.length / pageSize));
  const safeIndex = Math.min(pageIndex, pageCount - 1);
  const rows = group.activities.slice(safeIndex * pageSize, safeIndex * pageSize + pageSize);

  async function save() {
    if (body === saved) return;
    setSaving(true);
    try {
      await upsertChangeNote(projectId, {
        kind: group.kind,
        resource_name: group.resourceName,
        body,
      });
      setSaved(body);
      toast.success(`Saved note for ${group.label}.`);
    } catch (err) {
      setBody(saved); // revert to the last persisted value
      toast.error(err instanceof Error ? err.message : "Failed to save change note");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-md border border-border/60 bg-background/50 p-2.5">
      <div className="mb-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-xs font-semibold text-foreground">{group.label}</span>
        {contract && (
          <span className="text-[11px] text-muted-foreground">
            · contract {contract.fields.map((f) => `${f.field} ${f.old ?? "—"} → ${f.new ?? "—"}`).join(", ")}
          </span>
        )}
      </div>

      {group.activities.length > 0 && (
        <div className="mb-1.5 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-[11px]">
            <thead className="text-muted-foreground">
              <tr className="border-b border-border/60">
                <th className="py-1 pr-2 font-medium">Change</th>
                <th className="py-1 pr-2 font-medium">Project</th>
                <th className="py-1 pr-2 font-medium">Well</th>
                <th className="py-1 pr-2 font-medium">Activity</th>
                <th className="py-1 pr-2 font-medium">Previous</th>
                <th className="py-1 pr-2 font-medium">Current</th>
                <th className="py-1 font-medium">Comment</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={`${a.change}-${a.activity_id}`} className="border-b border-border/30 align-top">
                  <td className={cn("py-1 pr-2 font-semibold", changeTone(a))}>{changeLabel(a)}</td>
                  <td className="py-1 pr-2 text-foreground/80">{a.well_project ?? "—"}</td>
                  <td className="py-1 pr-2 text-foreground/80">{a.well_name ?? "—"}</td>
                  <td className="py-1 pr-2 text-foreground/80">{a.activity_type}</td>
                  <td className="py-1 pr-2 tabular-nums text-muted-foreground">{previousRange(a)}</td>
                  <td className="py-1 pr-2 tabular-nums text-foreground/80">{currentRange(a)}</td>
                  <td className="py-1 text-muted-foreground">{a.comment ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <PaginationFooter
            pageIndex={safeIndex}
            pageCount={pageCount}
            pageSize={pageSize}
            onPageChange={setPageIndex}
            onPageSizeChange={(s) => {
              setPageSize(s);
              setPageIndex(0);
            }}
            pageSizeOptions={[8, 16, 32]}
          />
        </div>
      )}

      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onBlur={save}
        readOnly={!canEdit}
        disabled={saving}
        rows={2}
        maxLength={4000}
        placeholder={
          canEdit ? "What changed for this resource, and why…" : locked ? "Locked with the plan" : "No note"
        }
        className="w-full resize-y rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring read-only:opacity-70 disabled:opacity-60"
      />
    </div>
  );
}
