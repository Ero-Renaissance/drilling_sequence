import { List, ListOrdered } from "lucide-react";
import type { RefObject } from "react";

import { applyLinePrefix } from "@/lib/note-markup";

/**
 * Two-button formatting toolbar for note textareas: prefixes (or unprefixes)
 * the selected lines with the lists subset. Keeps the textarea focused and
 * the rewritten lines selected so repeated toggles feel direct.
 */
export function NoteToolbar({
  textareaRef,
  value,
  onChange,
  disabled = false,
}: {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  const apply = (kind: "bullets" | "numbers") => {
    const el = textareaRef.current;
    if (!el) return;
    const next = applyLinePrefix(value, el.selectionStart, el.selectionEnd, kind);
    onChange(next.value);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(next.selStart, next.selEnd);
    });
  };
  const btn =
    "rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40";
  return (
    <div className="flex items-center gap-0.5">
      <button
        type="button"
        title="Bullet list"
        aria-label="Bullet list"
        className={btn}
        disabled={disabled}
        onClick={() => apply("bullets")}
      >
        <List className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        title="Numbered list"
        aria-label="Numbered list"
        className={btn}
        disabled={disabled}
        onClick={() => apply("numbers")}
      >
        <ListOrdered className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
