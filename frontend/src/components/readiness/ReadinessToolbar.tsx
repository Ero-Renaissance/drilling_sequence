import type { ReactNode } from "react";
import { Lock, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/search-input";
import { cn } from "@/lib/utils";
import { ReadinessWindowSelect } from "./ReadinessWindow";

/**
 * The toolbar above a readiness grid — the same on the Project gates page and
 * every team's grid: its title (and a team grid's Projects | Wells switch) and
 * Refresh, then the window, the search and how many targets are listed
 * ("6 wells", or "2 of 6" while filtering).
 */
export function ReadinessToolbar({
  loading,
  onRefresh,
  locked = false,
  viewSwitch,
  window,
  search,
  count,
}: {
  loading: boolean;
  onRefresh: () => void;
  /** The campaign's plan is locked (the Project gates freeze with it). */
  locked?: boolean;
  /** A team grid's Projects | Wells switch (spec §8.8); the gates page has none. */
  viewSwitch?: ReactNode;
  window: { value: number; onChange: (months: number) => void; allLabel: string };
  search: {
    value: string;
    onChange: (value: string) => void;
    placeholder: string;
    ariaLabel: string;
    testId?: string;
  };
  count: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/70 bg-card px-3 py-2 shadow-soft-sm">
      <span className="text-sm font-medium text-foreground">Readiness Tracker</span>
      <div className="mx-1 h-4 w-px bg-border" />
      {viewSwitch}
      <Button
        variant="ghost"
        size="sm"
        onClick={onRefresh}
        disabled={loading}
        className="text-muted-foreground"
      >
        <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
        <span className="ml-1.5">Refresh</span>
      </Button>

      {locked && (
        <span
          className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700"
          title="The campaign's plan is locked."
        >
          <Lock className="h-3 w-3" />
          Plan locked
        </span>
      )}

      <div className="ml-auto flex items-center gap-3">
        <ReadinessWindowSelect
          value={window.value}
          onChange={window.onChange}
          allLabel={window.allLabel}
        />
        <SearchInput
          value={search.value}
          onChange={search.onChange}
          placeholder={search.placeholder}
          ariaLabel={search.ariaLabel}
          testId={search.testId}
        />
        <span className="text-xs tabular-nums text-muted-foreground" data-testid="readiness-count">
          {count}
        </span>
      </div>
    </div>
  );
}
