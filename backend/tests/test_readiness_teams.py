"""Readiness teams, global team grants and catalog administration
(Phase 2 of docs/readiness-framework-spec.md).

Who may write a readiness check depends on its team (assert_can_edit_check):
planners for the field-project gates, holders of a GLOBAL team grant for
Wells/Logistics…, admins for everything. A grant covers every campaign and
confers nothing beyond writing that team's checks.
"""
import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit import AuditLog
from app.models.user import User

LOGISTICS_CHECK = {
    "code": "L-BUD",
    "label": "Budget Availability",
    "team_code": "logistics",
    "applies_project": True,
    "applies_well": True,
    "status_set": "standard",
    "icon_key": "banknote",
    "locks_with_plan": False,
    "sort_order": 100,
}


async def _user(client: AsyncClient, db: AsyncSession, email: str) -> User:
    await client.get("/api/projects")  # the auth dependency materialises the user
    return (await db.execute(select(User).where(User.email == email))).scalar_one()


async def _make_admin(client: AsyncClient, db: AsyncSession) -> User:
    me = await _user(client, db, "test@company.com")
    me.is_admin = True
    await db.commit()
    return me


async def _campaign(client: AsyncClient, name: str = "Teams Test") -> str:
    project = (await client.post("/api/projects", json={"name": name})).json()
    resp = await client.post(
        f"/api/projects/{project['id']}/activities",
        json={
            "activity_type": "Oil Development",
            "start_date": "2026-01-01",
            "end_date": "2026-03-31",
            "well_name": "Well-A1",
            "rig_name": "Rig Alpha",
            "location": "OFFSHORE",
            "plan_type": "Firm",
            "risk": "No Flood Risk",
            "well_project": "Bonga Phase 3",
        },
    )
    assert resp.status_code == 201, resp.text
    return project["id"]


async def _put(client: AsyncClient, pid: str, code: str, status: str = "Completed", notes=None):
    return await client.put(
        f"/api/projects/{pid}/readiness/{code}",
        json={"well_project": "Bonga Phase 3", "status": status, "notes": notes},
    )


async def _setup_logistics(client: AsyncClient) -> None:
    """As admin: create the Logistics team and its L-BUD check."""
    r = await client.post(
        "/api/admin/readiness/teams",
        json={"code": "logistics", "name": "Logistics", "icon_key": "banknote", "sort_order": 20},
    )
    assert r.status_code == 201, r.text
    r = await client.post("/api/admin/readiness/checks", json=LOGISTICS_CHECK)
    assert r.status_code == 201, r.text


async def _grant(client: AsyncClient, user: User, teams: list[str]):
    return await client.put(f"/api/admin/users/{user.id}/teams", json={"teams": teams})


# ── Admin-only surface ──────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_catalog_admin_and_grants_are_admin_only(
    client: AsyncClient, noplan_client: AsyncClient, db: AsyncSession
) -> None:
    target = await _user(client, db, "test@company.com")
    assert (await noplan_client.get("/api/admin/readiness/catalog")).status_code == 403
    assert (
        await noplan_client.post(
            "/api/admin/readiness/teams",
            json={"code": "logistics", "name": "Logistics", "icon_key": "banknote"},
        )
    ).status_code == 403
    assert (await noplan_client.post("/api/admin/readiness/checks", json=LOGISTICS_CHECK)).status_code == 403
    assert (await noplan_client.post("/api/admin/readiness/checks/FID/retire")).status_code == 403
    assert (await _grant(noplan_client, target, ["logistics"])).status_code == 403


# ── Grants decide who may write a team's checks ─────────────────────────────


@pytest.mark.asyncio
async def test_grantee_writes_their_team_checks_in_any_campaign(
    client: AsyncClient, noplan_client: AsyncClient, db: AsyncSession
) -> None:
    await _make_admin(client, db)
    pid = await _campaign(client)  # the grantee is NOT a member of this campaign
    await _setup_logistics(client)
    grantee = await _user(noplan_client, db, "noplan@company.com")

    assert (await _put(noplan_client, pid, "L-BUD")).status_code == 403  # no grant yet
    assert (await _grant(client, grantee, ["logistics"])).json() == {"teams": ["logistics"]}
    assert (await _put(noplan_client, pid, "L-BUD")).status_code == 200

    # …and nothing else: not the planner-owned project gates.
    assert (await _put(noplan_client, pid, "FID")).status_code == 403


@pytest.mark.asyncio
async def test_one_teams_grant_does_not_open_another_teams_checks(
    client: AsyncClient, noplan_client: AsyncClient, db: AsyncSession
) -> None:
    await _make_admin(client, db)
    pid = await _campaign(client)
    await _setup_logistics(client)
    await client.post(
        "/api/admin/readiness/teams",
        json={"code": "wells", "name": "Wells", "icon_key": "map-pin"},
    )
    grantee = await _user(noplan_client, db, "noplan@company.com")
    await _grant(client, grantee, ["wells"])
    assert (await _put(noplan_client, pid, "L-BUD")).status_code == 403


@pytest.mark.asyncio
async def test_campaign_planner_without_the_grant_cannot_write_team_checks(
    client: AsyncClient, other_client: AsyncClient, db: AsyncSession
) -> None:
    await _make_admin(client, db)
    await _setup_logistics(client)
    pid = await _campaign(other_client, "Other's campaign")  # other_client is its planner
    assert (await _put(other_client, pid, "FID")).status_code == 200
    assert (await _put(other_client, pid, "L-BUD")).status_code == 403


@pytest.mark.asyncio
async def test_revoking_the_grant_removes_access_and_both_are_audited(
    client: AsyncClient, noplan_client: AsyncClient, db: AsyncSession
) -> None:
    admin = await _make_admin(client, db)
    pid = await _campaign(client)
    await _setup_logistics(client)
    grantee = await _user(noplan_client, db, "noplan@company.com")
    await _grant(client, grantee, ["logistics"])
    assert (await _grant(client, grantee, [])).json() == {"teams": []}
    assert (await _put(noplan_client, pid, "L-BUD")).status_code == 403

    events = (
        await db.execute(
            select(AuditLog.field, AuditLog.user_id, AuditLog.project_id)
            .where(AuditLog.entity_type == "user", AuditLog.entity_id == grantee.id)
            .order_by(AuditLog.timestamp)
        )
    ).all()
    assert [e.field for e in events] == ["team_grant_granted", "team_grant_revoked"]
    assert all(e.user_id == admin.id and e.project_id is None for e in events)


@pytest.mark.asyncio
async def test_operational_team_check_stays_writable_while_the_plan_is_locked(
    client: AsyncClient, noplan_client: AsyncClient, db: AsyncSession
) -> None:
    await _make_admin(client, db)
    pid = await _campaign(client)
    await _setup_logistics(client)
    grantee = await _user(noplan_client, db, "noplan@company.com")
    await _grant(client, grantee, ["logistics"])
    assert (await client.post(f"/api/projects/{pid}/revisions", json={})).status_code in (200, 201)

    assert (await _put(client, pid, "FID")).status_code == 423  # governed gate
    assert (await _put(noplan_client, pid, "L-BUD")).status_code == 200  # operational


@pytest.mark.asyncio
async def test_only_active_grant_edited_teams_can_be_granted(
    client: AsyncClient, noplan_client: AsyncClient, db: AsyncSession
) -> None:
    await _make_admin(client, db)
    await _setup_logistics(client)
    grantee = await _user(noplan_client, db, "noplan@company.com")

    # The project gates belong to campaign planners, not a grant.
    assert (await _grant(client, grantee, ["projects"])).status_code == 422
    assert (await _grant(client, grantee, ["supply-chain"])).status_code == 422
    assert (await _grant(client, grantee, ["Not A Code"])).status_code == 422

    # An inactive team can't be granted, but an existing grant can still be revoked.
    await _grant(client, grantee, ["logistics"])
    await client.patch("/api/admin/readiness/teams/logistics", json={"is_active": False})
    assert (await _grant(client, grantee, [])).status_code == 200
    assert (await _grant(client, grantee, ["logistics"])).status_code == 422


@pytest.mark.asyncio
async def test_grants_show_on_me_and_the_admin_user_list(
    client: AsyncClient, noplan_client: AsyncClient, db: AsyncSession
) -> None:
    await _make_admin(client, db)
    await _setup_logistics(client)
    grantee = await _user(noplan_client, db, "noplan@company.com")
    await _grant(client, grantee, ["logistics"])

    assert (await noplan_client.get("/api/auth/me")).json()["teams"] == ["logistics"]
    users = {u["email"]: u for u in (await client.get("/api/admin/users")).json()}
    assert users["noplan@company.com"]["teams"] == ["logistics"]
    assert users["test@company.com"]["teams"] == []


# ── Catalog administration ──────────────────────────────────────────────────


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("override", "expected"),
    [
        ({"code": "l-bud"}, 422),  # codes are upper-case
        ({"code": "TOOLONGCODE"}, 422),
        ({"code": "CON"}, 409),  # reserved (the retired derived contract gate)
        ({"code": "FID"}, 409),  # already in use
        ({"team_code": "nope"}, 422),  # unknown team
        ({"icon_key": "skull"}, 422),  # not in the owned icon registry
        ({"status_set": "freeform"}, 422),
        ({"applies_project": False, "applies_well": False}, 422),
        ({"locks_with_plan": True}, 422),  # governed + well scope
        ({"label": "   "}, 422),
        ({"label": "x" * 65}, 422),
        ({"tag_list": "nope"}, 422),  # tag lists are a code-defined allow-list
    ],
)
async def test_create_check_validation(
    client: AsyncClient, db: AsyncSession, override: dict, expected: int
) -> None:
    await _make_admin(client, db)
    await client.post(
        "/api/admin/readiness/teams",
        json={"code": "logistics", "name": "Logistics", "icon_key": "banknote"},
    )
    resp = await client.post("/api/admin/readiness/checks", json={**LOGISTICS_CHECK, **override})
    assert resp.status_code == expected, resp.text


@pytest.mark.asyncio
async def test_project_gates_must_lock_with_the_plan(client: AsyncClient, db: AsyncSession) -> None:
    await _make_admin(client, db)
    base = {**LOGISTICS_CHECK, "code": "PRM", "label": "Permits", "team_code": "projects"}
    live = {**base, "applies_well": False, "locks_with_plan": False}
    assert (await client.post("/api/admin/readiness/checks", json=live)).status_code == 422
    governed = {**base, "applies_well": False, "locks_with_plan": True}
    assert (await client.post("/api/admin/readiness/checks", json=governed)).status_code == 201
    # A new project gate shows up on the project-gates grid without a code change.
    pid = await _campaign(client)
    rows = (await client.get(f"/api/projects/{pid}/readiness")).json()
    assert list(rows[0]["checks"])[-1] == "PRM"


@pytest.mark.asyncio
async def test_retired_code_cannot_be_reused(client: AsyncClient, db: AsyncSession) -> None:
    await _make_admin(client, db)
    await _setup_logistics(client)
    assert (await client.post("/api/admin/readiness/checks/L-BUD/retire")).status_code == 200
    resp = await client.post("/api/admin/readiness/checks", json=LOGISTICS_CHECK)
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_check_edit_is_audited_and_immutable_fields_are_refused(
    client: AsyncClient, db: AsyncSession
) -> None:
    admin = await _make_admin(client, db)
    resp = await client.patch("/api/admin/readiness/checks/LOC", json={"label": "Location Prep"})
    assert resp.status_code == 200
    assert resp.json()["label"] == "Location Prep"

    event = (
        await db.execute(
            select(AuditLog).where(
                AuditLog.entity_type == "readiness_catalog",
                AuditLog.field == "readiness_check_updated",
            )
        )
    ).scalar_one()
    assert event.user_id == admin.id and event.project_id is None
    assert "label: Location -> Location Prep" in event.new_value

    # Team, status set, scope and lock behaviour are fixed at creation.
    for field, value in (
        ("team_code", "logistics"),
        ("status_set", "standard"),
        ("locks_with_plan", False),
        ("applies_well", True),
        ("code", "LOX"),
    ):
        r = await client.patch("/api/admin/readiness/checks/LOC", json={field: value})
        assert r.status_code == 422, field
    assert (await client.patch("/api/admin/readiness/checks/LOC", json={})).status_code == 422
    assert (await client.patch("/api/admin/readiness/checks/NOPE", json={"label": "x"})).status_code == 404


@pytest.mark.asyncio
async def test_retire_and_restore_through_the_api(client: AsyncClient, db: AsyncSession) -> None:
    await _make_admin(client, db)
    pid = await _campaign(client)
    assert (await client.post("/api/admin/readiness/checks/EIA/retire")).json()["retired_at"]
    assert "EIA" not in [c["code"] for c in (await client.get("/api/readiness/catalog")).json()["checks"]]
    assert (await _put(client, pid, "EIA")).status_code == 422
    # Still listed for admins (retired), and restorable.
    admin_codes = {c["code"]: c for c in (await client.get("/api/admin/readiness/catalog")).json()["checks"]}
    assert admin_codes["EIA"]["retired_at"] is not None
    assert (await client.post("/api/admin/readiness/checks/EIA/restore")).json()["retired_at"] is None
    assert (await _put(client, pid, "EIA")).status_code == 200

    actions = (
        await db.execute(
            select(AuditLog.field)
            .where(AuditLog.entity_type == "readiness_catalog")
            .order_by(AuditLog.timestamp)
        )
    ).scalars().all()
    assert actions == ["readiness_check_retired", "readiness_check_restored"]


@pytest.mark.asyncio
async def test_team_rules(client: AsyncClient, db: AsyncSession) -> None:
    await _make_admin(client, db)
    pid = await _campaign(client)
    await _setup_logistics(client)

    dup = await client.post(
        "/api/admin/readiness/teams",
        json={"code": "logistics", "name": "Again", "icon_key": "banknote"},
    )
    assert dup.status_code == 409
    bad = await client.post(
        "/api/admin/readiness/teams", json={"code": "Logistics!", "name": "x", "icon_key": "banknote"}
    )
    assert bad.status_code == 422
    # New teams are always grant-edited — the client can't choose planner editing.
    sneaky = await client.post(
        "/api/admin/readiness/teams",
        json={"code": "supply", "name": "Supply", "icon_key": "banknote", "editor_source": "planner"},
    )
    assert sneaky.status_code == 422

    assert (
        await client.patch("/api/admin/readiness/teams/projects", json={"is_active": False})
    ).status_code == 400

    # Deactivating a team hides its checks and stops writes to them.
    await client.patch("/api/admin/readiness/teams/logistics", json={"is_active": False})
    public = (await client.get("/api/readiness/catalog")).json()
    assert "L-BUD" not in [c["code"] for c in public["checks"]]
    assert "logistics" not in [t["code"] for t in public["teams"]]
    assert (await _put(client, pid, "L-BUD")).status_code == 422


# ── Every readiness change is on the record ─────────────────────────────────


async def _readiness_events(db: AsyncSession, pid: str) -> list[AuditLog]:
    return list(
        (
            await db.execute(
                select(AuditLog)
                .where(AuditLog.entity_type == "readiness", AuditLog.project_id == uuid.UUID(pid))
                .order_by(AuditLog.timestamp)
            )
        ).scalars()
    )


@pytest.mark.asyncio
async def test_readiness_changes_are_audited_in_the_campaign_feed(
    client: AsyncClient, db: AsyncSession
) -> None:
    pid = await _campaign(client)
    await _put(client, pid, "FID", "Behind")

    events = await _readiness_events(db, pid)
    assert len(events) == 1
    assert events[0].field == "readiness_updated"
    assert events[0].old_value == "On Track"
    assert events[0].new_value == "FID for Bonga Phase 3: On Track -> Behind"

    feed = (await client.get(f"/api/projects/{pid}/audit")).json()
    assert any(e["field"] == "readiness_updated" for e in feed)


@pytest.mark.asyncio
async def test_no_audit_noise_for_unchanged_saves(client: AsyncClient, db: AsyncSession) -> None:
    """The chart edit dialog saves every gate on Save — unchanged gates (including
    an unset gate saved as its default) must not flood the trail."""
    pid = await _campaign(client)
    await _put(client, pid, "FDP", "On Track")  # unset → its default: no change
    await _put(client, pid, "FID", "Behind")
    await _put(client, pid, "FID", "Behind")  # same again: no change
    await _put(client, pid, "FID", "Behind", notes="Board slipped to Q3")

    events = await _readiness_events(db, pid)
    assert [e.new_value for e in events] == [
        "FID for Bonga Phase 3: On Track -> Behind",
        "FID for Bonga Phase 3: Behind -> Behind; notes changed",
    ]
