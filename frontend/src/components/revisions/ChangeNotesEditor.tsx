import { useState } from "react";

import { upsertChangeNote, type ChangeNote, type ChangeNoteKind } from "@/api/change-notes";
import type { ActivityDiff } from "@/api/compare";
import { toast } from "@/components/ui/toaster";
import { cn } from "@/lib/utils";

interface ResourceGroup {
  kind: ChangeNoteKind;
  resourceName: string | null;
  label: string;
  activities: ActivityDiff[];
}

function resourceOf(a: ActivityDiff): { kind: ChangeNoteKind; name: string | null; label: string } {
  if (a.rig_name) return { kind: "rig", name: a.rig_name, label: a.rig_name };
  if (a.hwu_name) return { kind: "hwu", name: a.hwu_name, label: `HWU · ${a.hwu_name}` };
  return { kind: "general", name: null, label: "No resource" };
}

const groupKey = (kind: ChangeNoteKind, name: string | null) => `${kind}:${name ?? ""}`;

const labelFor = (kind: ChangeNoteKind, name: string | null) =>
  kind === "hwu" ? `HWU · ${name ?? ""}` : kind === "general" ? "No resource" : name ?? "";

/**
 * Per-resource "what changed and why" editor, shown under the Compare diff. The
 * planner summarises a rig's changes into one note; it's displayed on the Sequence
 * chart and presentation view (the Excel's per-rig change blocks).
 */
export function ChangeNotesEditor({
  projectId,
  activities,
  notes,
  canEdit,
}: {
  projectId: string;
  activities: ActivityDiff[];
  notes: ChangeNote[];
  canEdit: boolean;
}) {
  // Group the changed activities by resource, then fold in any resource that
  // already has a note but no change this comparison (so a stale note stays editable).
  const groups = new Map<string, ResourceGroup>();
  for (const a of activities) {
    const r = resourceOf(a);
    const k = groupKey(r.kind, r.name);
    if (!groups.has(k))
      groups.set(k, { kind: r.kind, resourceName: r.name, label: r.label, activities: [] });
    groups.get(k)!.activities.push(a);
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

  const bodyFor = (g: ResourceGroup) =>
    notes.find((n) => n.kind === g.kind && (n.resource_name ?? null) === g.resourceName)?.body ?? "";

  return (
    <div className="space-y-2 rounded-lg border border-border/70 bg-muted/20 p-3">
      <div>
        <h3 className="text-sm font-semibold text-foreground">Change notes</h3>
        <p className="text-xs text-muted-foreground">
          Summarise what changed for each resource vs the last sequence — these appear on the
          Sequence chart and the presentation view.
        </p>
      </div>
      {ordered.map((g) => (
        <ResourceNote
          key={groupKey(g.kind, g.resourceName)}
          projectId={projectId}
          group={g}
          initial={bodyFor(g)}
          canEdit={canEdit}
        />
      ))}
    </div>
  );
}

const CHANGE_TONE: Record<string, string> = {
  added: "text-emerald-600 dark:text-emerald-400",
  removed: "text-red-600 dark:text-red-400",
  modified: "text-amber-600 dark:text-amber-400",
};

function ResourceNote({
  projectId,
  group,
  initial,
  canEdit,
}: {
  projectId: string;
  group: ResourceGroup;
  initial: string;
  canEdit: boolean;
}) {
  const [body, setBody] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [saving, setSaving] = useState(false);

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
      <div className="mb-1 text-xs font-semibold text-foreground">{group.label}</div>
      {group.activities.length > 0 && (
        <ul className="mb-1.5 space-y-0.5 text-[11px] text-muted-foreground">
          {group.activities.map((a) => (
            <li key={`${a.change}-${a.activity_id}`} className="flex flex-wrap items-baseline gap-1.5">
              <span className={cn("font-semibold uppercase", CHANGE_TONE[a.change])}>{a.change}</span>
              <span className="text-foreground/80">
                {[a.well_name, a.activity_type].filter(Boolean).join(" · ")}
              </span>
              {a.comment && <span className="italic">— {a.comment}</span>}
            </li>
          ))}
        </ul>
      )}
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onBlur={save}
        readOnly={!canEdit}
        disabled={saving}
        rows={2}
        maxLength={4000}
        placeholder={canEdit ? "What changed for this resource, and why…" : "No note"}
        className="w-full resize-y rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring read-only:opacity-70 disabled:opacity-60"
      />
    </div>
  );
}
