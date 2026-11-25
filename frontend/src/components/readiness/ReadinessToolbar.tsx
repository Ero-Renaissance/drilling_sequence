import type { ReactNode } from "react";
import { Lock, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/search-input";
import { cn } from "@/lib/utils";
import type { YearRange } from "@/lib/readiness-window";
import { ReadinessYearsPicker } from "./ReadinessWindow";

/**
 * The toolbar above a readiness page — the same for every team's sheet and the
 * All view: its title, an optional filter (the sheet's value stream) and
 * Refresh, then the years shown, the search and how many targets are listed
 * ("6 wells", or "2 of 6" while filtering).
 */
export function ReadinessToolbar({
  loading,
  onRefresh,
  locked = false,
  viewSwitch,
  years,
  search,
  count,
}: {
  loading: boolean;
  onRefresh: () => void;
  /** The campaign's plan is locked. Readiness stays editable — the chip says
   *  so, and that changes don't alter the revision's frozen record. */
  locked?: boolean;
  /** A control beside the title — the sheet's value-stream filter. */
  viewSwitch?: ReactNode;
  /** The years shown (1–3 at a time) — the page lists what spuds within them. */
  years: { value: YearRange; onChange: (next: YearRange) => void };
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
          title="The plan is locked, but readiness can still be updated. Changes are recorded in the audit log and don't alter what the revision recorded."
        >
          <Lock className="h-3 w-3" />
          Plan locked · readiness stays editable
        </span>
      )}

      <div className="ml-auto flex items-center gap-3">
        <ReadinessYearsPicker value={years.value} onChange={years.onChange} />
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
