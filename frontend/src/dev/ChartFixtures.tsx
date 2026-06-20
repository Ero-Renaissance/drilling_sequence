import { useEffect } from "react";
import { DrillChart } from "@/components/chart/DrillChart";
import { useThemeStore } from "@/store/theme";
import { cn } from "@/lib/utils";
import {
  FIXTURE_ACTIVITIES,
  FIXTURE_READINESS,
  FIXTURE_CONTRACTS,
  FIXTURE_CONFLICT_IDS,
} from "@/dev/fixtures";

/**
 * Dev-only harness: renders the sequence chart from canned fixtures — no
 * backend, auth, or seeded data — so chart changes can be eyeballed (and, later,
 * snapshot-tested) in isolation. Reachable at /dev/fixtures, and only mounted
 * under `import.meta.env.DEV` (see App.tsx), so it never ships to production.
 */
export default function ChartFixtures() {
  const resolved = useThemeStore((s) => s.resolved);
  const setTheme = useThemeStore((s) => s.setTheme);
  // The shell normally syncs the .dark class to the resolved theme; outside it
  // (here) we init ourselves so the canvas theme matches the page, not drifts.
  useEffect(() => useThemeStore.getState().init(), []);

  const themeBtn = (mode: "light" | "dark") =>
    cn(
      "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
      resolved === mode
        ? "border-transparent bg-primary text-primary-foreground"
        : "border-border/70 text-muted-foreground hover:bg-muted",
    );

  return (
    <div className="min-h-screen bg-background p-6 text-foreground">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold">Chart fixtures</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Dev harness · {FIXTURE_ACTIVITIES.length} activities, no backend. Exercises the
            project filter, flood-risk droplets, the readiness-strip tiers, a rig
            double-booking (red outline), a completed bar (grey), and contract-expiry
            markers.
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setTheme("light")} className={themeBtn("light")}>
            Light
          </button>
          <button type="button" onClick={() => setTheme("dark")} className={themeBtn("dark")}>
            Dark
          </button>
        </div>
      </header>
      <DrillChart
        activities={FIXTURE_ACTIVITIES}
        readinessMap={FIXTURE_READINESS}
        contractsByRig={FIXTURE_CONTRACTS}
        conflictIds={FIXTURE_CONFLICT_IDS}
        enableProjectFilter
      />
    </div>
  );
}
