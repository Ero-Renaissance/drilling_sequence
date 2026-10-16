import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { WINDOW_MONTHS, parseWindow } from "@/lib/readiness-window";

/** The Readiness page's window, carried in `?horizon=` — shared by every lens,
 *  and set by the Overview tiles' links so the tab opens on the tile's window. */
export function useReadinessWindow(): [number, (months: number) => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  const months = parseWindow(searchParams.get("horizon"));
  const setMonths = useCallback(
    (next: number) =>
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          if (next === 0) params.delete("horizon");
          else params.set("horizon", String(next));
          return params;
        },
        { replace: true },
      ),
    [setSearchParams],
  );
  return [months, setMonths];
}

/** The window picker — the same choices as the Overview tiles. */
export function ReadinessWindowSelect({
  value,
  onChange,
  allLabel,
}: {
  value: number;
  onChange: (months: number) => void;
  /** What "All" covers, e.g. "All field projects". */
  allLabel: string;
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className="whitespace-nowrap">Window</span>
      <select
        aria-label="Readiness time window"
        value={String(value)}
        onChange={(e) => onChange(Number(e.target.value))}
        className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
      >
        {WINDOW_MONTHS.map((m) => (
          <option key={m} value={m}>
            {m === 0 ? allLabel : `Next ${m} months`}
          </option>
        ))}
      </select>
    </label>
  );
}
