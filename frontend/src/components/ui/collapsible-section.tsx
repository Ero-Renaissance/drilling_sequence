import { useId, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

function readOpen(storageKey: string | undefined, fallback: boolean): boolean {
  if (!storageKey) return fallback;
  try {
    const saved = window.localStorage.getItem(storageKey);
    return saved === null ? fallback : saved === "1";
  } catch {
    return fallback;
  }
}

/**
 * A card whose body folds away behind its header — the same pattern as the
 * Overview's "Breakdown" and "Rigs & well spuds" sections. The header's toggle
 * holds the title, optional count and chevron; `actions` (search, Add…) sit
 * beside it and only show while the section is open. With `storageKey` the
 * open/closed choice is remembered per browser (a viewing habit, like the
 * horizon pickers); it falls back to `defaultOpen` when storage is unavailable.
 */
export function CollapsibleSection({
  title,
  icon: Icon,
  count,
  actions,
  defaultOpen = true,
  storageKey,
  children,
  className,
}: {
  title: string;
  icon?: LucideIcon;
  count?: ReactNode;
  actions?: ReactNode;
  defaultOpen?: boolean;
  storageKey?: string;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpenState] = useState(() => readOpen(storageKey, defaultOpen));
  const bodyId = useId();

  const toggle = () =>
    setOpenState((prev) => {
      const next = !prev;
      if (storageKey) {
        try {
          window.localStorage.setItem(storageKey, next ? "1" : "0");
        } catch {
          // storage unavailable — the in-session choice still applies
        }
      }
      return next;
    });

  return (
    <section
      aria-label={title}
      className={cn("rounded-xl border border-border/70 bg-card shadow-soft-sm", className)}
    >
      <div
        className={cn(
          "flex flex-wrap items-center gap-2 px-4 py-2.5",
          open && "border-b border-border/70",
        )}
      >
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-controls={bodyId}
          className="-mx-1 flex min-w-0 items-center gap-2 rounded-md px-1 py-1 text-left hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {Icon && <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />}
          <h2 className="text-sm font-semibold">
            {title}
            {count !== undefined && count !== "" && (
              <span className="ml-2 font-normal text-muted-foreground">{count}</span>
            )}
          </h2>
          {open ? (
            <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
        </button>
        {open && actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
      </div>
      {open && <div id={bodyId}>{children}</div>}
    </section>
  );
}
