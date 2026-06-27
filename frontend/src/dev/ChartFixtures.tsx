import { useEffect, useState } from "react";
import { DrillChart } from "@/components/chart/DrillChart";
import { RevisionPrintDoc } from "@/components/revisions/RevisionPrintDoc";
import { useThemeStore } from "@/store/theme";
import { cn } from "@/lib/utils";
import {
  FIXTURE_ACTIVITIES,
  FIXTURE_READINESS,
  FIXTURE_CONTRACTS,
  FIXTURE_CONFLICT_IDS,
  FIXTURE_PRINT_ROWS,
  FIXTURE_REVISION,
  FIXTURE_PROJECT,
} from "@/dev/fixtures";

type View = "chart" | "print-schedule" | "print-readiness";

/**
 * Dev-only harness: renders the sequence chart AND the print document from canned
 * fixtures — no backend, auth, or seeded data — so chart/print changes can be
 * eyeballed (and, later, snapshot-tested) in isolation. Reachable at /dev/fixtures
 * and only mounted under `import.meta.env.DEV` (App.tsx), so it never ships.
 *
 * The print doc is normally `hidden` on screen (print-only) and forces light
 * tokens via the page's print stylesheet; here we reveal it (`[&>div]:!block`)
 * and pin the light tokens locally so it looks like the real PDF in either theme.
 */
export default function ChartFixtures() {
  const resolved = useThemeStore((s) => s.resolved);
  const setTheme = useThemeStore((s) => s.setTheme);
  const [view, setView] = useState<View>("chart");
  // The shell normally syncs the .dark class to the resolved theme; outside it
  // (here) we init ourselves so the canvas theme matches the page, not drifts.
  useEffect(() => useThemeStore.getState().init(), []);

  const tab = (active: boolean) =>
    cn(
      "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
      active
        ? "border-transparent bg-primary text-primary-foreground"
        : "border-border/70 text-muted-foreground hover:bg-muted",
    );

  return (
    <div className="min-h-screen bg-background p-6 text-foreground">
      <style>{`.print-preview{--background:0 0% 100%;--foreground:222 24% 12%;--card:0 0% 100%;--card-foreground:222 24% 12%;--muted:220 14% 95%;--muted-foreground:220 9% 40%;--border:220 13% 85%;}`}</style>

      <header className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold">Chart fixtures</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Dev harness · {FIXTURE_ACTIVITIES.length} activities, no backend. The chart
            exercises the project + location filters, flood droplets, readiness tiers, a
            readiness opt-out, a conflict and a completed bar; the print views render
            RevisionPrintDoc from the same data.
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setTheme("light")} className={tab(resolved === "light")}>
            Light
          </button>
          <button type="button" onClick={() => setTheme("dark")} className={tab(resolved === "dark")}>
            Dark
          </button>
        </div>
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-1">
        <button type="button" onClick={() => setView("chart")} className={tab(view === "chart")}>
          Chart
        </button>
        <button type="button" onClick={() => setView("print-schedule")} className={tab(view === "print-schedule")}>
          Print · schedule
        </button>
        <button type="button" onClick={() => setView("print-readiness")} className={tab(view === "print-readiness")}>
          Print · readiness
        </button>
      </div>

      {view === "chart" ? (
        <DrillChart
          activities={FIXTURE_ACTIVITIES}
          readinessMap={FIXTURE_READINESS}
          contractsByRig={FIXTURE_CONTRACTS}
          conflictIds={FIXTURE_CONFLICT_IDS}
          enableFilters
        />
      ) : (
        <div className="print-preview overflow-x-auto rounded-lg border border-border bg-white p-3 shadow-sm [&>div]:!block">
          <RevisionPrintDoc
            revision={FIXTURE_REVISION}
            project={FIXTURE_PROJECT}
            rows={FIXTURE_PRINT_ROWS}
            chart={view === "print-readiness" ? "readiness" : "standard"}
            includeSchedule={view !== "print-readiness"}
          />
        </div>
      )}
    </div>
  );
}
