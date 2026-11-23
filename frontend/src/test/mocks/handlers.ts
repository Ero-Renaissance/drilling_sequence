import { http, HttpResponse } from "msw";
import type { Project, User } from "@/types";
import type { Activity, ImportResult } from "@/api/activities";
import type {
  CatalogCheck,
  CheckCode,
  CheckStatus,
  ReadinessCatalog,
  RowFigures,
} from "@/api/readiness";
import { BUILTIN_PROJECT_GATES } from "@/components/readiness/catalog";
import { STATUS_SEVERITY } from "@/components/readiness/check-meta";

/** Gates saved through the mock PUT, per field project — cleared after each test
 *  (setup.ts) so tests don't leak into each other. */
export const savedGates = new Map<string, Record<string, CheckStatus>>();

/** A date inside every readiness window (the mock rows' focus_start). */
export const SOON = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);

/** The server's per-row rollup (spec §3.7), for fixtures. */
export function mockRowFigures(statuses: CheckStatus[]): RowFigures {
  const sev = statuses.map((s) => STATUS_SEVERITY[s] ?? "in_progress");
  const counted = sev.filter((x) => x !== "not_counted");
  const done = counted.filter((x) => x === "done").length;
  return {
    counted: counted.length,
    done,
    in_progress: counted.filter((x) => x === "in_progress").length,
    not_started: counted.filter((x) => x === "not_started").length,
    behind: counted.filter((x) => x === "blocked").length,
    na: sev.length - counted.length,
    ready: counted.length > 0 && done === counted.length,
  };
}
/**
 * The Projects team's read (`GET /readiness/teams/projects`) for fixtures — the
 * well execution readiness checks (phase 8): a row per field project and per
 * well, each well following its field project until it has its own value.
 * Statuses: `status` for everything (default: Not started), then a field
 * project's own (`projectStatuses`, plus `savedGates` under its name), then a
 * well's own (`wellStatuses` keyed "project\u0001well", plus `savedGates`
 * under that key — the mock PUT writes both).
 */
export function mockGateTeam({
  wells,
  status = "Not started",
  projectStatuses = {},
  wellStatuses = {},
  activityCounts = {},
  locked = false,
  checks = BUILTIN_PROJECT_GATES,
}: {
  wells: { well_project: string; well_name: string; activity_type?: string; start_date?: string }[];
  status?: CheckStatus;
  projectStatuses?: Record<string, Record<CheckCode, CheckStatus>>;
  wellStatuses?: Record<string, Record<CheckCode, CheckStatus>>;
  activityCounts?: Record<string, number>;
  locked?: boolean;
  checks?: readonly CatalogCheck[];
}) {
  const cell = (s: CheckStatus, source: "well" | "project" | "default") => ({
    status: s,
    notes: null,
    updated_at: null,
    applies: true,
    applies_source: "default" as const,
    source,
  });
  const ownOfProject = (wp: string): Record<CheckCode, CheckStatus> => ({
    ...(projectStatuses[wp] ?? {}),
    ...(savedGates.get(wp) ?? {}),
  });
  const projectCells = (wp: string) =>
    Object.fromEntries(
      checks.map(({ code }) => {
        const own = ownOfProject(wp);
        return [code, cell(own[code] ?? status, code in own ? "project" : "default")];
      }),
    );
  const projects = [...new Set(wells.map((w) => w.well_project).filter(Boolean))];
  const well_rows = wells.map((w) => {
    const key = `${w.well_project}\u0001${w.well_name}`;
    const own = { ...(wellStatuses[key] ?? {}), ...(savedGates.get(key) ?? {}) };
    const fromProject = w.well_project ? ownOfProject(w.well_project) : {};
    const cells = Object.fromEntries(
      checks.map(({ code }) => [
        code,
        code in own
          ? cell(own[code], "well")
          : code in fromProject
            ? cell(fromProject[code], "project")
            : cell(status, "default"),
      ]),
    );
    return {
      well_project: w.well_project,
      well_name: w.well_name,
      activity_type: w.activity_type ?? "Oil Development",
      activity_count: 1,
      location: "OFFSHORE",
      start_date: w.start_date ?? SOON,
      focus_start: w.start_date ?? SOON,
      focus_in_days: 30,
      checks: cells,
      figures: mockRowFigures(Object.values(cells).map((c) => c.status)),
    };
  });
  const project_rows = projects.map((wp) => {
    const cells = projectCells(wp);
    const figures = mockRowFigures(Object.values(cells).map((c) => c.status));
    return {
      well_project: wp,
      activity_count: activityCounts[wp] ?? wells.filter((w) => w.well_project === wp).length,
      checks: cells,
      focus_start: SOON,
      focus_in_days: 30,
      figures,
      figures_by_window: { "0": figures, "6": figures, "12": figures, "24": figures },
      wells_behind_by_window: { "0": 0, "6": 0, "12": 0, "24": 0 },
    };
  });
  return {
    team: { code: "projects", name: "Projects", editor_source: "planner" as const, icon_key: "land-plot", sort_order: 0 },
    checks: [...checks],
    project_rows,
    well_rows,
    locked,
  };
}

import type { AuditEntry } from "@/api/audit";
import type { Viewer } from "@/api/viewers";
import type { Revision, RevisionDetail } from "@/api/revisions";
import type { Approver } from "@/api/approvers";

export const mockUser: User = {
  id: "aaaaaaaa-0000-0000-0000-000000000001",
  name: "Test User",
  email: "test@company.com",
  is_admin: false,
  can_plan: true,
};

export const mockProject: Project = {
  id: "cccccccc-0000-0000-0000-000000000001",
  name: "North Sea Campaign",
  field: "Bonga",
  region: "Offshore",
  status: "active",
  review_policy: "optional",
  created_by: mockUser.id,
  created_at: "2026-05-24T10:00:00Z",
  cloned_from_project_id: null,
  members: [
    {
      user_id: mockUser.id,
      role: "planner",
      user_name: mockUser.name,
      user_email: mockUser.email,
    },
  ],
};

export const handlers = [
  http.get("/api/auth/me", () => HttpResponse.json(mockUser)),

  http.get("/api/projects", () => HttpResponse.json([mockProject])),

  http.get("/api/projects/:projectId", ({ params }) =>
    params.projectId === mockProject.id
      ? HttpResponse.json(mockProject)
      : new HttpResponse(null, { status: 404 }),
  ),

  http.post("/api/projects", async ({ request }) => {
    const body = (await request.json()) as { name: string; field?: string; region?: string };
    const created: Project = {
      ...mockProject,
      id: "dddddddd-0000-0000-0000-000000000002",
      name: body.name,
      field: body.field ?? null,
      region: body.region ?? null,
      created_at: new Date().toISOString(),
    };
    return HttpResponse.json(created, { status: 201 });
  }),

  http.delete("/api/projects/:id", () => new HttpResponse(null, { status: 204 })),

  http.get("/api/projects/:projectId/activities", () => {
    const activities: Activity[] = [
      {
        id: "act-001",
        project_id: mockProject.id,
        activity_type: "Oil Development",
        start_date: "2026-01-01",
        end_date: "2026-03-31",
        well_name: "Well-A1",
        rig_name: "Rig Alpha",
        location: "OFFSHORE",
        well_project: null,
        project_group: null,
        risk: null,
        comment: null,
        plan_type: "Firm",
        completed_at: null,
        updated_at: "2026-05-25T08:00:00Z",
        updated_by_name: "Test User",
        locked_by_revision_id: null,
      },
      {
        id: "act-002",
        project_id: mockProject.id,
        activity_type: "Gas Development",
        start_date: "2026-04-01",
        end_date: "2026-06-30",
        well_name: "Well-B2",
        rig_name: "Rig Beta",
        location: "LAND",
        well_project: null,
        project_group: null,
        risk: null,
        comment: null,
        plan_type: "Option",
        completed_at: null,
        updated_at: "2026-05-25T09:00:00Z",
        updated_by_name: null,
        locked_by_revision_id: null,
      },
    ];
    return HttpResponse.json(activities);
  }),

  http.post("/api/projects/:projectId/activities", async ({ request }) => {
    const body = (await request.json()) as Partial<Activity>;
    const created: Activity = {
      id: "act-new-001",
      project_id: mockProject.id,
      activity_type: body.activity_type ?? "Unknown",
      start_date: body.start_date ?? "2026-01-01",
      end_date: body.end_date ?? "2026-12-31",
      well_name: body.well_name ?? null,
      rig_name: body.rig_name ?? null,
      location: body.location ?? null,
      well_project: null,
      project_group: null,
      risk: body.risk ?? null,
      comment: body.comment ?? null,
      plan_type: body.plan_type ?? null,
      completed_at: null,
      updated_at: new Date().toISOString(),
      updated_by_name: mockUser.name,
      locked_by_revision_id: null,
    };
    return HttpResponse.json(created, { status: 201 });
  }),

  http.patch("/api/projects/:projectId/activities/:activityId", async ({ request, params }) => {
    const body = (await request.json()) as Partial<Activity>;
    const updated: Activity = {
      id: params.activityId as string,
      project_id: mockProject.id,
      activity_type: "Oil Development",
      start_date: "2026-01-01",
      end_date: "2026-03-31",
      well_name: "Well-A1",
      rig_name: "Rig Alpha",
      location: "OFFSHORE",
      well_project: null,
      project_group: null,
      risk: null,
      comment: null,
      plan_type: "Firm",
      updated_at: new Date().toISOString(),
      updated_by_name: mockUser.name,
      locked_by_revision_id: null,
      ...body,
      completed_at: body.completed_at ?? null,
    };
    return HttpResponse.json(updated);
  }),

  http.delete("/api/projects/:projectId/activities/:activityId", () =>
    new HttpResponse(null, { status: 204 }),
  ),

  http.post("/api/projects/:projectId/activities/import", ({ request }) => {
    // The dialog does a dry_run pass first, then commits; both hit this route.
    // With no unknown types either way, the dry run flows straight to commit.
    const dryRun = new URL(request.url).searchParams.get("dry_run") === "true";
    const result: ImportResult = {
      imported: 2,
      replaced: !dryRun,
      skipped: 0,
      skipped_rows: [],
      warnings: [],
      dry_run: dryRun,
      unknown_types: [],
      applied_mappings: [],
    };
    return HttpResponse.json(result);
  }),

  http.get("/api/readiness/catalog", () => {
    const catalog: ReadinessCatalog = {
      teams: [
        { code: "projects", name: "Projects", editor_source: "planner", icon_key: "land-plot", sort_order: 0 },
      ],
      checks: [...BUILTIN_PROJECT_GATES],
      status_sets: {
        standard: {
          statuses: [
            { status: "On Track", severity: "in_progress" },
            { status: "Completed", severity: "done" },
            { status: "Behind", severity: "blocked" },
            { status: "N/A", severity: "not_counted" },
          ],
          default: "On Track",
          history_only: false,
        },
        execution: {
          statuses: [
            { status: "Not started", severity: "not_started" },
            { status: "On Track", severity: "in_progress" },
            { status: "Completed", severity: "done" },
            { status: "Behind", severity: "blocked" },
            { status: "N/A", severity: "not_counted" },
          ],
          default: "Not started",
          history_only: false,
        },
      },
    };
    return HttpResponse.json(catalog);
  }),

  // The well execution readiness checks through the team read (phase 8) — see
  // `mockGateTeam`: two field projects, one well each, every check Not started
  // except Bonga's BUD, plus whatever a test saved through the mock PUT.
  http.get("/api/projects/:projectId/readiness/teams/projects", () =>
    HttpResponse.json(
      mockGateTeam({
        wells: [
          { well_project: "Bonga Phase 3", well_name: "Bonga-1" },
          { well_project: "Egina North", well_name: "Egina-1" },
        ],
        projectStatuses: { "Bonga Phase 3": { BUD: "Completed" } },
        activityCounts: { "Bonga Phase 3": 3, "Egina North": 2 },
      }),
    ),
  ),

  http.put(
    "/api/projects/:projectId/readiness/:checkCode",
    async ({ request, params }) => {
      const body = (await request.json()) as {
        scope?: "project" | "well";
        well_project: string;
        well_name?: string;
        status: CheckStatus;
        notes: string | null;
      };
      // A well's own value is kept apart from its field project's.
      const key =
        body.scope === "well" ? `${body.well_project}\u0001${body.well_name}` : body.well_project;
      savedGates.set(key, {
        ...(savedGates.get(key) ?? {}),
        [String(params.checkCode)]: body.status,
      });
      return HttpResponse.json({
        well_project: body.well_project,
        check_code: params.checkCode,
        status: body.status,
        notes: body.notes,
        updated_at: new Date().toISOString(),
      });
    },
  ),

  http.get("/api/projects/:projectId/contracts", () => HttpResponse.json([])),

  http.get("/api/projects/:projectId/viewers", () => {
    const viewers: Viewer[] = [
      { user_id: mockUser.id, user_name: mockUser.name, last_seen_at: new Date().toISOString() },
    ];
    return HttpResponse.json(viewers);
  }),

  http.get("/api/projects/:projectId/activities/:activityId/history", () => {
    const entries: AuditEntry[] = [
      {
        id: "audit-001",
        field: "well_name",
        old_value: "Well-Old",
        new_value: "Well-A1",
        user_name: mockUser.name,
        timestamp: "2026-05-25T08:00:00Z",
      },
    ];
    return HttpResponse.json(entries);
  }),

  http.get("/api/projects/:projectId/approvers", () => {
    const approvers: Approver[] = [
      {
        id: "app-001",
        project_id: mockProject.id,
        email: "approver@company.com",
        name: "Jane Approver",
        role_label: "Project Manager",
      },
    ];
    return HttpResponse.json(approvers);
  }),

  http.post("/api/projects/:projectId/approvers", async ({ request }) => {
    const body = (await request.json()) as { email: string; name?: string; role_label?: string };
    const approver: Approver = {
      id: "app-new-001",
      project_id: mockProject.id,
      email: body.email,
      name: body.name ?? null,
      role_label: body.role_label ?? "Approver",
    };
    return HttpResponse.json(approver, { status: 201 });
  }),

  http.delete("/api/projects/:projectId/approvers/:approverId", () =>
    new HttpResponse(null, { status: 204 }),
  ),

  http.get("/api/projects/:projectId/revisions", () => {
    const revisions: Revision[] = [
      {
        id: "rev-001",
        project_id: mockProject.id,
        rev_number: 1,
        label: "Rev. 01",
        status: "pending_approval",
        stage: "approval",
        review_required: false,
        review_skipped: false,
        decision_reason: null,
        decision_by_name: null,
        decision_at: null,
        integrity_digest: "",
        reviewer_status: [],
        created_by_name: mockUser.name,
        created_at: "2026-05-25T10:00:00Z",
        signatures: [],
        approver_status: [
          {
            email: "approver@company.com",
            name: "Jane Approver",
            role_label: "Project Manager",
            signed: false,
            signed_at: null,
            signer_name: null,
          },
        ],
      },
    ];
    return HttpResponse.json(revisions);
  }),

  http.get("/api/projects/:projectId/revisions/:revisionId", ({ params }) => {
    const detail: RevisionDetail = {
      id: params.revisionId as string,
      project_id: mockProject.id,
      rev_number: 1,
      label: "Rev. 01",
      status: "pending_approval",
      stage: "approval",
      review_required: false,
      review_skipped: false,
      decision_reason: null,
      decision_by_name: null,
      decision_at: null,
      integrity_digest: "",
      reviewer_status: [],
      created_by_name: mockUser.name,
      created_at: "2026-05-25T10:00:00Z",
      signatures: [],
      approver_status: [
        {
          email: "approver@company.com",
          name: "Jane Approver",
          role_label: "Project Manager",
          signed: false,
          signed_at: null,
          signer_name: null,
        },
      ],
      snapshot_json: JSON.stringify([
        {
          id: "act-001",
          activity_type: "Oil Development",
          start_date: "2026-01-01",
          end_date: "2026-03-31",
          well_name: "Well-A1",
          rig_name: "Rig Alpha",
          location: "OFFSHORE",
          plan_type: "Firm",
          risk: null,
          comment: null,
          readiness: { FDP: "Not Started", LLI: "In Progress", LOC: "Not Started", FE: "N/A", FID: "Not Started", EIA: "Not Started", BUD: "Completed" },
        },
      ]),
      change_notes: [],
    };
    return HttpResponse.json(detail);
  }),

  http.post("/api/projects/:projectId/revisions", async ({ request }) => {
    const body = (await request.json()) as { label?: string | null };
    const revision: Revision = {
      id: "rev-new-001",
      project_id: mockProject.id,
      rev_number: 2,
      label: body.label ?? "Rev. 02",
      status: "pending_approval",
      stage: "approval",
      review_required: false,
      review_skipped: false,
      decision_reason: null,
      decision_by_name: null,
      decision_at: null,
      integrity_digest: "",
      reviewer_status: [],
      created_by_name: mockUser.name,
      created_at: new Date().toISOString(),
      signatures: [],
      approver_status: [],
    };
    return HttpResponse.json(revision, { status: 201 });
  }),

  http.put("/api/projects/:projectId/revisions/:revisionId/sign", async ({ request, params }) => {
    const body = (await request.json()) as { role_label: string };
    const revision: Revision = {
      id: params.revisionId as string,
      project_id: mockProject.id,
      rev_number: 1,
      label: "Rev. 01",
      status: "approved",
      stage: "approval",
      review_required: false,
      review_skipped: false,
      decision_reason: null,
      decision_by_name: null,
      decision_at: null,
      integrity_digest: "",
      reviewer_status: [],
      created_by_name: mockUser.name,
      created_at: "2026-05-25T10:00:00Z",
      signatures: [
        {
          id: "sig-001",
          user_id: mockUser.id,
          user_name: mockUser.name,
          role_label: body.role_label,
          stage: "approval" as const,
          signed_at: new Date().toISOString(),
        },
      ],
      approver_status: [
        {
          email: "approver@company.com",
          name: "Jane Approver",
          role_label: "Project Manager",
          signed: true,
          signed_at: new Date().toISOString(),
          signer_name: mockUser.name,
        },
      ],
    };
    return HttpResponse.json(revision);
  }),

  http.delete("/api/projects/:projectId/revisions/:revisionId", () =>
    new HttpResponse(null, { status: 204 }),
  ),
];
