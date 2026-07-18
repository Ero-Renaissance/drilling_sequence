import { useEffect, useRef, useState } from "react";
import { StickyNote } from "lucide-react";
import { useOutletContext } from "react-router-dom";

import { projectsApi } from "@/api/projects";
import { Button } from "@/components/ui/button";
import { NoteText } from "@/components/ui/note-text";
import { NoteToolbar } from "@/components/ui/note-toolbar";
import { toast } from "@/components/ui/toaster";
import { relativeTime } from "@/lib/time";
import type { CampaignOutletContext } from "@/pages/ProjectDetail";
import type { ProjectKeyNotes } from "@/types";

/**
 * The planner's campaign bulletin — the "read this first" slot on Overview.
 * Org-wide readable; planner-only writable; locked with the plan (the
 * communicated story holds still during approval — the revision's discussion
 * thread is the live channel then). Formatting is the notes lists subset.
 */
export function KeyNotesCard({ projectId }: { projectId: string }) {
  const ctx = useOutletContext<CampaignOutletContext | null>();
  const canEdit = !!ctx?.canEditPlan && !ctx?.locked;
  const [notes, setNotes] = useState<ProjectKeyNotes | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    let active = true;
    projectsApi
      .get(projectId)
      .then((p) => {
        if (!active) return;
        setNotes(p.key_notes ?? null);
        setLoaded(true);
      })
      .catch(() => active && setLoaded(true));
    return () => {
      active = false;
    };
  }, [projectId]);

  async function save() {
    setSaving(true);
    try {
      const saved = await projectsApi.updateKeyNotes(projectId, draft);
      setNotes(saved.body.trim() ? saved : null);
      setEditing(false);
      toast.success(saved.body.trim() ? "Key notes saved." : "Key notes cleared.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save key notes");
    } finally {
      setSaving(false);
    }
  }

  // Nothing to say and nobody who could say it → no empty box on the page.
  if (!loaded || (!notes && !canEdit && !editing)) return null;

  return (
    <div
      data-testid="key-notes-card"
      className="rounded-xl border border-border/70 bg-card p-4 shadow-soft-sm"
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <StickyNote className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold text-foreground">Key notes</h3>
        {notes?.updated_at && (
          <span className="text-xs text-muted-foreground">
            Updated{notes.updated_by_name ? ` by ${notes.updated_by_name}` : ""} ·{" "}
            {relativeTime(notes.updated_at)}
          </span>
        )}
        {canEdit && !editing && (
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={() => {
              setDraft(notes?.body ?? "");
              setEditing(true);
            }}
          >
            {notes ? "Edit" : "Add key notes"}
          </Button>
        )}
      </div>

      {editing ? (
        <div className="space-y-2">
          <NoteToolbar
            textareaRef={textareaRef}
            value={draft}
            onChange={setDraft}
            disabled={saving}
          />
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={5}
            maxLength={4000}
            placeholder={"Key information for everyone reading this campaign…\n- use bullet lines\n1. or numbered lines"}
            className="w-full resize-y rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
            disabled={saving}
          />
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
              Cancel
            </Button>
          </div>
        </div>
      ) : notes ? (
        <NoteText body={notes.body} className="text-sm text-foreground/90" />
      ) : (
        <p className="text-sm text-muted-foreground">
          No key notes yet — share the headline story for this campaign.
        </p>
      )}
    </div>
  );
}
