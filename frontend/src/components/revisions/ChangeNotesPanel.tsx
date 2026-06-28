import type { ChangeNote } from "@/api/change-notes";

function label(n: ChangeNote): string {
  if (n.kind === "hwu") return `HWU · ${n.resource_name ?? ""}`;
  if (n.kind === "general") return "General";
  return n.resource_name ?? "";
}

/**
 * Read-only display of the planner's per-resource change notes — just the resource
 * name and the note. Used on the Sequence tab and the presentation view; the
 * detailed diff lives on the Compare page where the notes are authored.
 */
export function ChangeNotesPanel({
  notes,
  emptyText,
}: {
  notes: ChangeNote[];
  emptyText?: string;
}) {
  const withNotes = notes
    .filter((n) => n.body.trim())
    .sort((a, b) => label(a).localeCompare(label(b)));

  if (withNotes.length === 0) {
    return emptyText ? <p className="text-sm text-muted-foreground">{emptyText}</p> : null;
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {withNotes.map((n) => (
        <div
          key={`${n.kind}:${n.resource_name ?? ""}`}
          className="rounded-lg border border-border/70 bg-card p-3 shadow-soft-sm"
        >
          <div className="mb-1 text-xs font-semibold text-foreground">{label(n)}</div>
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">{n.body}</p>
        </div>
      ))}
    </div>
  );
}
