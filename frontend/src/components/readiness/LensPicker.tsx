import { cn } from "@/lib/utils";
import { checkIcon } from "./icon-registry";
import { lensLabel, useReadinessTeams, type Lens } from "./catalog";

/**
 * Pick which team's readiness a view shows — Project gates · Wells · Logistics…
 * One team at a time keeps the chart and grid uncluttered. Renders nothing
 * while the project gates are the only team (nothing to choose).
 */
export function LensPicker({
  value,
  onChange,
  className,
}: {
  value: Lens;
  onChange: (lens: Lens) => void;
  className?: string;
}) {
  const teams = useReadinessTeams();
  if (teams.length < 2) return null;
  return (
    <div
      role="radiogroup"
      aria-label="Readiness view"
      className={cn(
        "inline-flex items-center gap-0.5 rounded-md border border-border bg-background p-0.5",
        className,
      )}
    >
      {teams.map((team) => {
        const Icon = checkIcon(team.icon_key);
        const selected = team.code === value;
        return (
          <button
            key={team.code}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(team.code)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors",
              selected
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {lensLabel(team)}
          </button>
        );
      })}
    </div>
  );
}
