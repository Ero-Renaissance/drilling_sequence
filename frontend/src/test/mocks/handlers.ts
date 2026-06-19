import { http, HttpResponse } from "msw";
import type { Project, User } from "@/types";
import type { Activity, ImportResult } from "@/api/activities";
import { CHECK_CODES, type CheckCode, type CheckStatus, type ActivityReadiness } from "@/api/readiness";
import type { AuditEntry } from "@/api/audit";
import type { Viewer } from "@/api/viewers";
import type { Revision, RevisionDetail } from "@/api/revisions";
import type { Approver } from "@/api/approvers";

export const mockUser: User = {
  id: "aaaaaaaa-0000-0000-0000-000000000001",
  name: "Test User",
  email: "test@company.com",
  is_admin: false,
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

  http.post("/api/projects/:projectId/activities/import", () => {
    const result: ImportResult = { imported: 2, replaced: true };
    return HttpResponse.json(result);
  }),

  http.get("/api/projects/:projectId/readiness", () => {
    const makeChecks = (): Record<CheckCode, { status: CheckStatus; notes: null; updated_at: null }> =>
      Object.fromEntries(
        CHECK_CODES.map((c) => [c, { status: "Not Started" as CheckStatus, notes: null, updated_at: null }]),
      ) as Record<CheckCode, { status: CheckStatus; notes: null; updated_at: null }>;

    const rows: ActivityReadiness[] = [
      {
        activity_id: "act-001",
        activity_type: "Oil Development",
        well_name: "Well-A1",
        rig_name: "Rig Alpha",
        start_date: "2026-01-01",
        end_date: "2026-03-31",
        checks: { ...makeChecks(), BUD: { status: "Completed", notes: null, updated_at: null } },
      },
      {
        activity_id: "act-002",
        activity_type: "Gas Development",
        well_name: "Well-B2",
        rig_name: "Rig Beta",
        start_date: "2026-04-01",
        end_date: "2026-06-30",
        checks: makeChecks(),
      },
    ];
    return HttpResponse.json(rows);
  }),

  http.put(
    "/api/projects/:projectId/activities/:activityId/readiness/:checkCode",
    async ({ request, params }) => {
      const body = (await request.json()) as { status: CheckStatus; notes: string | null };
      return HttpResponse.json({
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
