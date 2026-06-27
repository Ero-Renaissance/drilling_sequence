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
import type { HwuContract } from "@/api/hwu-contracts";
import { CHECK_CODES, type CheckCode, type CheckStatus } from "@/api/readiness";
import type { ReadinessMap } from "@/lib/chart-utils";
import type { RevisionDetail } from "@/api/revisions";
import type { PrintRow } from "@/components/revisions/RevisionPrintDoc";
import type { Project } from "@/types";

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
  // f6 opts out of readiness (readiness_required: false) → no gate icons on its bar.
  act({ id: "f6", activity_type: "Oil Development", well_name: "CHR-9", rig_name: "Rig-2", location: "LAND", well_project: "Charlie Deep", start_date: "2026-06-20", end_date: "2026-09-30", readiness_required: false }),
  // Rig-3 (offshore) — a completed (grey) bar and a flood-risk bar.
  act({ id: "f7", activity_type: "Water Injection", well_name: "CHR-4", rig_name: "Rig-3", location: "OFFSHORE", well_project: "Charlie Deep", start_date: "2026-03-01", end_date: "2026-07-31", completed_at: "2026-08-01T00:00:00Z" }),
  act({ id: "f8", activity_type: "Drilling", well_name: "ALP-8", rig_name: "Rig-3", location: "OFFSHORE", well_project: "Alpha Field", risk: "Flood Risk", start_date: "2026-09-01", end_date: "2026-12-20" }),
  // An HWU activity (no rig) — its own row, tagged "HWU · …", with its own contract.
  act({ id: "f9", activity_type: "Well Repair/Safety", well_name: "HWU-W1", hwu_name: "HWU-Alpha", location: "SWAMP", well_project: "Bravo Block", start_date: "2026-04-01", end_date: "2026-08-31" }),
];

/** f5 and f6 overlap on Rig-2 (Jun 20–25) — a double-booking. */
export const FIXTURE_CONFLICT_IDS = new Set(["f5", "f6"]);

function readiness(overrides: Partial<Record<CheckCode, CheckStatus>>): Record<CheckCode, { status: CheckStatus }> {
  const out = {} as Record<CheckCode, { status: CheckStatus }>;
  for (const c of CHECK_CODES) out[c] = { status: overrides[c] ?? "On Track" };
  return out;
}

export const FIXTURE_READINESS: ReadinessMap = new Map([
  ["f1", readiness({ FDP: "Completed", LLI: "Completed", LOC: "On Track", FE: "On Track", FID: "Completed", EIA: "On Track", BUD: "Completed", CON: "Completed" })],
  ["f4", readiness({ FDP: "Behind", LLI: "Behind", LOC: "On Track", FE: "Behind", FID: "On Track", EIA: "N/A", BUD: "On Track", CON: "Behind" })],
  ["f6", readiness({ FDP: "Completed", LLI: "On Track", LOC: "Completed", FE: "Completed", FID: "On Track", EIA: "Completed", BUD: "Completed", CON: "N/A" })],
  ["f7", readiness({ FDP: "Completed", LLI: "Completed", LOC: "Completed", FE: "Completed", FID: "Completed", EIA: "Completed", BUD: "Completed", CON: "Completed" })],
  ["f8", readiness({ FDP: "On Track", LLI: "On Track", LOC: "On Track", FE: "On Track", FID: "On Track", EIA: "On Track", BUD: "On Track", CON: "On Track" })],
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

function hwuContract(hwu: string, end: string): HwuContract {
  return {
    id: `hc-${hwu}`,
    project_id: PROJECT_ID,
    hwu_name: hwu,
    status: "Completed",
    contract_start: "2025-01-01",
    contract_end: end,
    notes: null,
    updated_at: "2026-06-01T08:00:00Z",
  };
}

export const FIXTURE_HWU_CONTRACTS: Map<string, HwuContract> = new Map([
  ["HWU-Alpha", hwuContract("HWU-Alpha", "2026-08-10")],
]);

// ── Print fixtures — for rendering RevisionPrintDoc in the harness ─────────────

/** The same activities as PrintRows, with readiness flattened to code→status and
 *  each rig's contract denormalised onto its rows (as the snapshot does). */
export const FIXTURE_PRINT_ROWS: PrintRow[] = FIXTURE_ACTIVITIES.map((a) => {
  const rd = FIXTURE_READINESS.get(a.id);
  const readiness = rd
    ? (Object.fromEntries(CHECK_CODES.map((c) => [c, rd[c].status])) as Record<string, CheckStatus>)
    : undefined;
  const c = a.rig_name
    ? FIXTURE_CONTRACTS.get(a.rig_name)
    : a.hwu_name
      ? FIXTURE_HWU_CONTRACTS.get(a.hwu_name)
      : undefined;
  return {
    id: a.id,
    activity_type: a.activity_type,
    start_date: a.start_date,
    end_date: a.end_date,
    well_name: a.well_name,
    well_project: a.well_project,
    rig_name: a.rig_name,
    hwu_name: a.hwu_name,
    location: a.location,
    plan_type: a.plan_type,
    risk: a.risk,
    readiness,
    readiness_required: a.readiness_required,
    rig_contract_status: c?.status ?? null,
    rig_contract_end: c?.contract_end ?? null,
  };
});

export const FIXTURE_PROJECT: Project = {
  id: PROJECT_ID,
  name: "Dev Fixtures Field",
  field: "Niger Delta",
  region: "OML-00",
  status: "active",
  review_policy: "optional",
  created_by: "u0",
  created_at: "2026-01-01T00:00:00Z",
  members: [],
  cloned_from_project_id: null,
};

export const FIXTURE_REVISION: RevisionDetail = {
  id: "rev-fixtures",
  project_id: PROJECT_ID,
  rev_number: 3,
  label: null,
  status: "approved",
  stage: "approval",
  review_required: true,
  review_skipped: false,
  created_by_name: "Dev Planner",
  created_at: "2026-06-01T08:00:00Z",
  signatures: [
    { id: "sig-1", user_id: "u1", user_name: "Asha Reviewer", role_label: "Technical Reviewer", signed_at: "2026-06-05T10:00:00Z" },
    { id: "sig-2", user_id: "u2", user_name: "Femi Approver", role_label: "Asset Manager", signed_at: "2026-06-10T14:00:00Z" },
  ],
  reviewer_status: [
    { email: "asha@example.com", name: "Asha Reviewer", role_label: "Technical Reviewer", signed: true, signed_at: "2026-06-05T10:00:00Z", signer_name: "Asha Reviewer" },
  ],
  approver_status: [
    { email: "femi@example.com", name: "Femi Approver", role_label: "Asset Manager", signed: true, signed_at: "2026-06-10T14:00:00Z", signer_name: "Femi Approver" },
  ],
  decision_reason: null,
  decision_by_name: null,
  decision_at: null,
  integrity_digest: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
  snapshot_json: "{}",
};
