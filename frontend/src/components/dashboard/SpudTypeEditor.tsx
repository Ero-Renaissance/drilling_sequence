import { resolveSpudClass, type SpudClass, type SpudMap } from "@/lib/spud-classification";
import { cn } from "@/lib/utils";

const CHOICES: { key: SpudClass; label: string; active: string }[] = [
  { key: "oil", label: "Oil", active: "bg-red-600 text-white" },
  { key: "gas", label: "Gas", active: "bg-green-600 text-white" },
  { key: "exclude", label: "Exclude", active: "bg-muted-foreground/80 text-white" },
];

/**
 * Lets the planner classify each activity type as an oil or gas well spud (or
 * exclude it). Controlled — the parent owns the {@link SpudMap} and persists it.
 */
export function SpudTypeEditor({
  types,
  value,
  onChange,
}: {
  types: string[];
  value: SpudMap;
  onChange: (next: SpudMap) => void;
}) {
  if (types.length === 0) {
    return <p className="text-xs text-muted-foreground">No activity types to classify yet.</p>;
  }
  return (
    <div className="space-y-1.5 rounded-md border border-border/60 bg-muted/20 p-2.5">
      <p className="text-xs text-muted-foreground">
        Choose which activity types count as an oil or gas <strong>well spud</strong>. Workovers and
        other non-drilling work stay excluded. Saved in your browser.
      </p>
      <div className="divide-y divide-border/60 rounded-md border border-border/60 bg-background">
        {types.map((t) => {
          const current = resolveSpudClass(t, value);
          return (
            <div key={t} className="flex items-center justify-between gap-2 px-2.5 py-1.5">
              <span className="truncate text-xs text-foreground" title={t}>
                {t}
              </span>
              <div className="flex shrink-0 overflow-hidden rounded-md border border-border">
                {CHOICES.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    aria-pressed={current === c.key}
                    onClick={() => onChange({ ...value, [t]: c.key })}
                    className={cn(
                      "px-2 py-0.5 text-[11px] font-medium transition-colors",
                      current === c.key
                        ? c.active
                        : "bg-background text-muted-foreground hover:bg-muted",
                    )}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
