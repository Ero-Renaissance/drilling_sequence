import { useCallback, useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import {
  MAX_RANGE_YEARS,
  clampYearRange,
  defaultYearRange,
  parseYearRange,
  rangePhrase,
  type YearRange,
} from "@/lib/readiness-window";

/** The Readiness page's year range, carried in `?from=` and `?years=` — shared
 *  by every lens, and set by the Overview tiles' links so the tab opens on the
 *  tile's years. The default (this year and the next two) leaves the link bare. */
export function useReadinessYears(): [YearRange, (next: YearRange) => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  const from = searchParams.get("from");
  const years = searchParams.get("years");
  const range = useMemo(() => parseYearRange(from, years), [from, years]);
  const setRange = useCallback(
    (next: YearRange) =>
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          const clamped = clampYearRange(next);
          const fallback = defaultYearRange();
          if (clamped.from === fallback.from) params.delete("from");
          else params.set("from", String(clamped.from));
          if (clamped.years === fallback.years) params.delete("years");
          else params.set("years", String(clamped.years));
          return params;
        },
        { replace: true },
      ),
    [setSearchParams],
  );
  return [range, setRange];
}

/**
 * The year picker — the same on every readiness page and the Overview: step the
 * range back or forward a year, and choose how many years to show (1 to 3).
 */
export function ReadinessYearsPicker({
  value,
  onChange,
}: {
  value: YearRange;
  onChange: (next: YearRange) => void;
}) {
  const step = (by: number) => onChange(clampYearRange({ ...value, from: value.from + by }));
  const arrow =
    "inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent/50 hover:text-foreground";
  return (
    <div
      className="flex items-center gap-1.5 text-xs text-muted-foreground"
      role="group"
      aria-label="Years shown"
    >
      <span className="whitespace-nowrap">Years</span>
      <div className="inline-flex items-center rounded-md border border-border bg-background">
        <button type="button" className={arrow} onClick={() => step(-1)} aria-label="Earlier years">
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <span
          className="min-w-[72px] px-1 text-center font-medium tabular-nums text-foreground"
          data-testid="readiness-years"
        >
          {rangePhrase(value)}
        </span>
        <button type="button" className={arrow} onClick={() => step(1)} aria-label="Later years">
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
      <select
        aria-label="How many years to show"
        value={String(value.years)}
        onChange={(e) => onChange(clampYearRange({ ...value, years: Number(e.target.value) }))}
        className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
      >
        {Array.from({ length: MAX_RANGE_YEARS }, (_, i) => i + 1).map((n) => (
          <option key={n} value={n}>
            {n === 1 ? "1 year" : `${n} years`}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Says how many targets with work left the years shown leave out — so a short
 *  list never reads as "that's everything". */
export function OutsideYears({ count, unit }: { count: number; unit: string }) {
  if (count <= 0) return null;
  return (
    <p className="text-xs text-muted-foreground" data-testid="outside-years">
      {count} more {count === 1 ? unit : `${unit}s`} with work left{" "}
      {count === 1 ? "starts" : "start"} outside these years — move the years to see{" "}
      {count === 1 ? "it" : "them"}.
    </p>
  );
}
