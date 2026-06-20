/**
 * Canned chart fixtures for the dev harness (see ChartFixtures.tsx). They let us
 * render DrillChart with no backend, auth, or seeded data — covering the cases
 * that have actually needed eyeballing: multiple projects (filter), flood-risk
 * wells (droplet), a year-crossing span, narrow vs wide bars (readiness tiers +
 * tag fit/truncate), a rig double-booking (conflict outline), a completed bar,
 * and contract-expiry markers. This is also the surface a future Playwright
 * visual-regression test would point at.
 */
import type { Activity } from "@/api/activities";
import type { RigContract } from "@/api/contracts";
import { CHECK_CODES, type CheckCode, type CheckStatus } from "@/api/readiness";
import type { ReadinessMap } from "@/lib/chart-utils";

const PROJECT_ID = "dev-fixtures";

function act(a: Partial<Activity> & Pick<Activity, "id" | "activity_type" | "start_date" | "end_date">): Activity {
  return {
    project_id: PROJECT_ID,
    well_name: null,
    rig_name: null,
    well_project: null,
    project_group: null,
    location: null,
    risk: null,
    comment: null,
    plan_type: "Firm",
    completed_at: null,
    updated_at: "2026-06-01T08:00:00Z",
    updated_by_name: null,
    locked_by_revision_id: null,
    ...a,
  };
}

export const FIXTURE_ACTIVITIES: Activity[] = [
  // Rig-1 — a wide flood-risk bar, a medium non-flood bar, and a year-crossing bar.
  act({ id: "f1", activity_type: "Gas Development", well_name: "ALP-1", rig_name: "Rig-1", location: "LAND", well_project: "Alpha Field", risk: "Flood Risk", start_date: "2026-01-15", end_date: "2026-08-31" }),
  act({ id: "f2", activity_type: "Oil Development", well_name: "BRV-3", rig_name: "Rig-1", location: "LAND", well_project: "Bravo Block", risk: "No Flood Risk", start_date: "2026-10-01", end_date: "2026-11-15" }),
  act({ id: "f3", activity_type: "Gas Workover", well_name: "ALP-5", rig_name: "Rig-1", location: "LAND", well_project: "Alpha Field", start_date: "2026-12-10", end_date: "2027-03-01" }),
  // Rig-2 — a flood-risk "Behind" bar, plus a narrow + wide pair that double-book (conflict).
  act({ id: "f4", activity_type: "Oil Development", well_name: "BRV-7", rig_name: "Rig-2", location: "LAND", well_project: "Bravo Block", risk: "Flood Risk", start_date: "2026-02-01", end_date: "2026-05-15" }),
  act({ id: "f5", activity_type: "Oil Exploration", well_name: "CHR-2", rig_name: "Rig-2", location: "LAND", well_project: "Charlie Deep", start_date: "2026-06-10", end_date: "2026-06-25" }),
  act({ id: "f6", activity_type: "Oil Development", well_name: "CHR-9", rig_name: "Rig-2", location: "LAND", well_project: "Charlie Deep", start_date: "2026-06-20", end_date: "2026-09-30" }),
  // Rig-3 (offshore) — a completed (grey) bar and a flood-risk bar.
  act({ id: "f7", activity_type: "Water Injection", well_name: "CHR-4", rig_name: "Rig-3", location: "OFFSHORE", well_project: "Charlie Deep", start_date: "2026-03-01", end_date: "2026-07-31", completed_at: "2026-08-01T00:00:00Z" }),
  act({ id: "f8", activity_type: "Drilling", well_name: "ALP-8", rig_name: "Rig-3", location: "OFFSHORE", well_project: "Alpha Field", risk: "Flood Risk", start_date: "2026-09-01", end_date: "2026-12-20" }),
];

/** f5 and f6 overlap on Rig-2 (Jun 20–25) — a double-booking. */
export const FIXTURE_CONFLICT_IDS = new Set(["f5", "f6"]);

function readiness(overrides: Partial<Record<CheckCode, CheckStatus>>): Record<CheckCode, { status: CheckStatus }> {
  const out = {} as Record<CheckCode, { status: CheckStatus }>;
  for (const c of CHECK_CODES) out[c] = { status: overrides[c] ?? "Not Started" };
  return out;
}

export const FIXTURE_READINESS: ReadinessMap = new Map([
  ["f1", readiness({ FDP: "Completed", LLI: "Completed", LOC: "In Progress", FE: "Not Started", FID: "Completed", EIA: "In Progress", BUD: "Completed", CON: "Completed" })],
  ["f4", readiness({ FDP: "Behind", LLI: "Behind", LOC: "Not Started", FE: "Behind", FID: "Not Started", EIA: "N/A", BUD: "In Progress", CON: "Behind" })],
  ["f6", readiness({ FDP: "Completed", LLI: "In Progress", LOC: "Completed", FE: "Completed", FID: "In Progress", EIA: "Completed", BUD: "Completed", CON: "N/A" })],
  ["f7", readiness({ FDP: "Completed", LLI: "Completed", LOC: "Completed", FE: "Completed", FID: "Completed", EIA: "Completed", BUD: "Completed", CON: "Completed" })],
  ["f8", readiness({ FDP: "In Progress", LLI: "Not Started", LOC: "In Progress", FE: "Not Started", FID: "Not Started", EIA: "Not Started", BUD: "In Progress", CON: "Not Started" })],
]);

function contract(rig: string, end: string): RigContract {
  return {
    id: `c-${rig}`,
    project_id: PROJECT_ID,
    rig_name: rig,
    status: "Completed",
    contract_start: "2025-01-01",
    contract_end: end,
    notes: null,
    updated_at: "2026-06-01T08:00:00Z",
  };
}

// End dates spread across urgencies relative to mid-2026 (critical / soon / healthy).
export const FIXTURE_CONTRACTS: Map<string, RigContract> = new Map([
  ["Rig-1", contract("Rig-1", "2026-07-15")],
  ["Rig-2", contract("Rig-2", "2027-01-01")],
  ["Rig-3", contract("Rig-3", "2026-06-25")],
]);
