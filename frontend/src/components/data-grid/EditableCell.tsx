import { useEffect, useRef, useState } from "react";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";

interface EditableCellProps {
  value: string | null;
  onSave: (value: string | null) => void;
  type?: "text" | "date";
  options?: readonly string[];
  placeholder?: string;
  required?: boolean;
  readOnly?: boolean;
  className?: string;
  /** Optional custom renderer for the display state (e.g. to show a colored chip). */
  renderValue?: (value: string | null) => React.ReactNode;
}

export function EditableCell({
  value,
  onSave,
  type = "text",
  options,
  placeholder = "—",
  required,
  readOnly = false,
  className,
  renderValue,
}: EditableCellProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const inputRef = useRef<HTMLInputElement | HTMLSelectElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  useEffect(() => {
    if (!editing) setDraft(value ?? "");
  }, [value, editing]);

  function commit() {
    setEditing(false);
    const trimmed = draft.trim();
    const next = trimmed === "" ? null : trimmed;
    if (next !== value) onSave(next);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") commit();
    if (e.key === "Escape") {
      setDraft(value ?? "");
      setEditing(false);
    }
  }

  const baseInput =
    "w-full rounded-md border border-ring/60 bg-background px-2 py-1 text-sm outline-none ring-2 ring-ring/30 focus:ring-ring/50";

  if (readOnly) {
    return (
      <div
        className={cn(
          "flex w-full items-center gap-1 rounded px-2 py-1 text-sm text-muted-foreground",
          className,
        )}
        title="Locked — included in a pending revision"
      >
        <Lock className="h-3 w-3 shrink-0 text-muted-foreground/60" />
        <span className={value ? "text-foreground/80" : "italic text-muted-foreground/60"}>
          {value ?? placeholder}
        </span>
      </div>
    );
  }

  if (editing) {
    if (options) {
      return (
        <select
          ref={inputRef as React.RefObject<HTMLSelectElement>}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={handleKeyDown}
          className={cn(baseInput, className)}
        >
          {!required && <option value="">—</option>}
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    }
    return (
      <input
        ref={inputRef as React.RefObject<HTMLInputElement>}
        type={type}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={handleKeyDown}
        className={cn(baseInput, className)}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className={cn(
        "w-full rounded-md px-2 py-1 text-left text-sm transition-colors",
        "hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
        !renderValue && (value ? "text-foreground" : "text-muted-foreground/60 italic"),
        className,
      )}
      title="Click to edit"
    >
      {renderValue ? renderValue(value) : (value ?? placeholder)}
    </button>
  );
}
