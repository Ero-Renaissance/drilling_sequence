"""Well-level readiness, team lenses, inheritance and rename carry-over
(Phase 3 of docs/readiness-framework-spec.md).

A well is identified by NAMES — campaign + field project + well + activity type —
never an activity id. A check that applies at both levels is inherited by each
well from its field project until the well overrides it ("Reset to project"
drops the override). Renaming an activity carries its readiness with it.
"""
import uuid
from datetime import date

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity
from app.models.audit import AuditLog
from app.models.readiness import ReadinessEntry
from app.models.user import User

WELL_CHECK = {
    "code": "LPR",
    "label": "Location Preparation",
    "team_code": "wells",
    "applies_project": False,
    "applies_well": True,
    "status_set": "standard",
    "icon_key": "map-pin",
    "locks_with_plan": False,
}
BOTH_CHECK = {
    "code": "L-BUD",
    "label": "Budget Availability",
    "team_code": "logistics",
    "applies_project": True,
    "applies_well": True,
    "status_set": "standard",
    "icon_key": "banknote",
    "locks_with_plan": False,
}


async def _user(client: AsyncClient, db: AsyncSession, email: str) -> User:
    await client.get("/api/projects")
    return (await db.execute(select(User).where(User.email == email))).scalar_one()


async def _setup(client: AsyncClient, db: AsyncSession) -> None:
    """As admin: Wells (well-only LPR) and Logistics (two-level L-BUD) teams."""
    me = await _user(client, db, "test@company.com")
    me.is_admin = True
    await db.commit()
    for code, name, icon in (("wells", "Wells", "map-pin"), ("logistics", "Logistics", "banknote")):
        r = await client.post(
            "/api/admin/readiness/teams", json={"code": code, "name": name, "icon_key": icon}
        )
        assert r.status_code == 201, r.text
    for check in (WELL_CHECK, BOTH_CHECK):
        r = await client.post("/api/admin/readiness/checks", json=check)
        assert r.status_code == 201, r.text


async def _campaign(client: AsyncClient) -> str:
    return (await client.post("/api/projects", json={"name": "Wells Test"})).json()["id"]


async def _activity(client: AsyncClient, pid: str, **over) -> dict:
    payload = {
        "activity_type": "Oil Development",
        "start_date": "2026-01-01",
        "end_date": "2026-03-31",
        "well_name": "W-1",
        "rig_name": "Rig Alpha",
        "location": "OFFSHORE",
        "plan_type": "Firm",
        "risk": "No Flood Risk",
        "well_project": "Bonga Phase 3",
        **over,
    }
    r = await client.post(f"/api/projects/{pid}/activities", json=payload)
    assert r.status_code == 201, r.text
    return r.json()


def _well(well="W-1", project="Bonga Phase 3", activity_type="Oil Development") -> dict:
    return {
        "scope": "well",
        "well_project": project,
        "well_name": well,
        "activity_type": activity_type,
    }


async def _put(client: AsyncClient, pid: str, code: str, target: dict, status="Completed", notes=None):
    return await client.put(
        f"/api/projects/{pid}/readiness/{code}", json={**target, "status": status, "notes": notes}
    )


async def _lens(client: AsyncClient, pid: str, team: str) -> dict:
    r = await client.get(f"/api/projects/{pid}/readiness/teams/{team}")
    assert r.status_code == 200, r.text
    return r.json()


def _row(lens: dict, well: str = "W-1") -> dict:
    return next(r for r in lens["well_rows"] if r["well_name"] == well)


# ── Well-level writes ───────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_grantee_sets_a_well_check(
    client: AsyncClient, noplan_client: AsyncClient, db: AsyncSession
) -> None:
    await _setup(client, db)
    pid = await _campaign(client)
    await _activity(client, pid)
    grantee = await _user(noplan_client, db, "noplan@company.com")
    await client.put(f"/api/admin/users/{grantee.id}/teams", json={"teams": ["wells"]})

    r = await _put(noplan_client, pid, "LPR", _well())
    assert r.status_code == 200, r.text
    assert r.json()["scope"] == "well" and r.json()["well_name"] == "W-1"

    lpr = _row(await _lens(noplan_client, pid, "wells"))["checks"]["LPR"]
    assert lpr["status"] == "Completed" and lpr["source"] == "well"


@pytest.mark.asyncio
async def test_check_must_apply_at_the_requested_level(client: AsyncClient, db: AsyncSession) -> None:
    await _setup(client, db)
    pid = await _campaign(client)
    await _activity(client, pid)
    assert (await _put(client, pid, "FID", _well())).status_code == 422  # project-only
    project_target = {"well_project": "Bonga Phase 3"}
    assert (await _put(client, pid, "LPR", project_target)).status_code == 422  # well-only


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "target",
    [
        {"scope": "well", "well_project": "Bonga Phase 3", "activity_type": "Oil Development"},
        {"scope": "well", "well_project": "Bonga Phase 3", "well_name": "W-1"},
        {"scope": "project", "well_project": "Bonga Phase 3", "well_name": "W-1"},
        {"scope": "project", "well_project": ""},
        {"scope": "county", "well_project": "Bonga Phase 3"},
        {**_well(), "well_name": "x" * 257},
    ],
)
async def test_target_validation(client: AsyncClient, db: AsyncSession, target: dict) -> None:
    await _setup(client, db)
    pid = await _campaign(client)
    await _activity(client, pid)
    assert (await _put(client, pid, "LPR", target)).status_code == 422


@pytest.mark.asyncio
async def test_unknown_well_in_this_campaign_is_404(client: AsyncClient, db: AsyncSession) -> None:
    """BOLA: only wells that exist in THIS campaign can carry readiness."""
    await _setup(client, db)
    pid = await _campaign(client)
    other = await _campaign(client)
    await _activity(client, pid)
    await _activity(client, other, well_name="W-ELSEWHERE")
    assert (await _put(client, pid, "LPR", _well(well="W-ELSEWHERE"))).status_code == 404
    assert (await _put(client, pid, "LPR", _well(activity_type="Gas Workover"))).status_code == 404
    assert (await _put(client, pid, "LPR", _well(project="Egina North"))).status_code == 404


@pytest.mark.asyncio
async def test_names_with_url_significant_characters_and_no_field_project(
    client: AsyncClient, db: AsyncSession
) -> None:
    await _setup(client, db)
    pid = await _campaign(client)
    await _activity(client, pid, well_name="EGB-12 + 13/A", well_project="Egbema Node FOD + IOGD")
    await _activity(client, pid, well_name="LONE-1", well_project=None)

    target = _well(well="EGB-12 + 13/A", project="Egbema Node FOD + IOGD")
    assert (await _put(client, pid, "LPR", target)).status_code == 200
    # A well with no field project is addressed with well_project "".
    assert (await _put(client, pid, "LPR", _well(well="LONE-1", project=""))).status_code == 200

    lens = await _lens(client, pid, "wells")
    assert _row(lens, "EGB-12 + 13/A")["checks"]["LPR"]["source"] == "well"
    lone = _row(lens, "LONE-1")
    assert lone["well_project"] == "" and lone["checks"]["LPR"]["status"] == "Completed"


@pytest.mark.asyncio
async def test_operational_well_check_ignores_the_plan_lock(
    client: AsyncClient, db: AsyncSession
) -> None:
    await _setup(client, db)
    pid = await _campaign(client)
    await _activity(client, pid)
    assert (await client.post(f"/api/projects/{pid}/revisions", json={})).status_code in (200, 201)
    assert (await _put(client, pid, "FID", {"well_project": "Bonga Phase 3"})).status_code == 423
    assert (await _put(client, pid, "LPR", _well())).status_code == 200
    assert (await _lens(client, pid, "wells"))["locked"] is True


@pytest.mark.asyncio
async def test_well_write_is_audited_with_the_well_named(client: AsyncClient, db: AsyncSession) -> None:
    await _setup(client, db)
    pid = await _campaign(client)
    await _activity(client, pid)
    await _put(client, pid, "LPR", _well())
    detail = (
        await db.execute(
            select(AuditLog.new_value).where(
                AuditLog.entity_type == "readiness", AuditLog.project_id == uuid.UUID(pid)
            )
        )
    ).scalar_one()
    assert detail == "LPR for W-1 (Bonga Phase 3, Oil Development): On Track -> Completed"


# ── Inheritance: project value → well, with override and reset ──────────────


@pytest.mark.asyncio
async def test_well_inherits_the_project_value_until_it_overrides(
    client: AsyncClient, db: AsyncSession
) -> None:
    await _setup(client, db)
    pid = await _campaign(client)
    await _activity(client, pid)
    await _activity(client, pid, well_name="W-2", start_date="2026-04-01", end_date="2026-05-01")

    # Nothing set → the default.
    assert _row(await _lens(client, pid, "logistics"))["checks"]["L-BUD"]["source"] == "default"

    # Set once for the field project → every well follows it.
    await _put(client, pid, "L-BUD", {"well_project": "Bonga Phase 3"}, "Completed")
    lens = await _lens(client, pid, "logistics")
    assert lens["project_rows"][0]["checks"]["L-BUD"]["status"] == "Completed"
    for well in ("W-1", "W-2"):
        state = _row(lens, well)["checks"]["L-BUD"]
        assert (state["status"], state["source"]) == ("Completed", "project")

    # One well differs → override it alone.
    await _put(client, pid, "L-BUD", _well(well="W-2"), "Behind")
    lens = await _lens(client, pid, "logistics")
    assert _row(lens, "W-2")["checks"]["L-BUD"] == {
        **_row(lens, "W-2")["checks"]["L-BUD"],
        "status": "Behind",
        "source": "well",
    }
    assert _row(lens, "W-1")["checks"]["L-BUD"]["source"] == "project"

    # A later project change doesn't rewrite the override. (Not N/A: a team check
    # that doesn't apply is unticked instead since phase 6, spec §3.8.)
    r = await _put(client, pid, "L-BUD", {"well_project": "Bonga Phase 3"}, "On Track")
    assert r.status_code == 200, r.text
    lens = await _lens(client, pid, "logistics")
    assert _row(lens, "W-1")["checks"]["L-BUD"]["status"] == "On Track"
    assert _row(lens, "W-2")["checks"]["L-BUD"]["status"] == "Behind"


@pytest.mark.asyncio
async def test_reset_to_project_drops_the_override_and_is_audited(
    client: AsyncClient, db: AsyncSession
) -> None:
    await _setup(client, db)
    pid = await _campaign(client)
    await _activity(client, pid)
    await _put(client, pid, "L-BUD", {"well_project": "Bonga Phase 3"}, "Completed")
    await _put(client, pid, "L-BUD", _well(), "Behind")

    r = await client.post(f"/api/projects/{pid}/readiness/L-BUD/reset", json=_well())
    assert r.status_code == 200
    assert (r.json()["status"], r.json()["source"]) == ("Completed", "project")
    assert _row(await _lens(client, pid, "logistics"))["checks"]["L-BUD"]["source"] == "project"
    # Idempotent.
    again = await client.post(f"/api/projects/{pid}/readiness/L-BUD/reset", json=_well())
    assert again.status_code == 200

    actions = (
        await db.execute(
            select(AuditLog.field)
            .where(AuditLog.entity_type == "readiness", AuditLog.project_id == uuid.UUID(pid))
            .order_by(AuditLog.timestamp)
        )
    ).scalars().all()
    assert actions[-1] == "readiness_reset"


@pytest.mark.asyncio
async def test_reset_only_applies_to_two_level_checks_at_well_scope(
    client: AsyncClient, db: AsyncSession
) -> None:
    await _setup(client, db)
    pid = await _campaign(client)
    await _activity(client, pid)
    base = f"/api/projects/{pid}/readiness"
    assert (await client.post(f"{base}/LPR/reset", json=_well())).status_code == 422  # well-only
    assert (await client.post(f"{base}/FID/reset", json=_well())).status_code == 422  # project-only
    project = {"well_project": "Bonga Phase 3"}
    assert (await client.post(f"{base}/L-BUD/reset", json=project)).status_code == 422


@pytest.mark.asyncio
async def test_reset_requires_the_teams_grant(
    client: AsyncClient, other_client: AsyncClient, db: AsyncSession
) -> None:
    await _setup(client, db)
    pid = await _campaign(other_client)  # other_client plans it, without a grant
    await _activity(other_client, pid)
    r = await other_client.post(f"/api/projects/{pid}/readiness/L-BUD/reset", json=_well())
    assert r.status_code == 403


# ── The lens read model ─────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_lens_rows_and_shapes(
    client: AsyncClient, noplan_client: AsyncClient, db: AsyncSession
) -> None:
    await _setup(client, db)
    pid = await _campaign(client)
    await _activity(client, pid)
    # Two activities sharing project + well + activity type share one row.
    await _activity(client, pid, start_date="2026-06-01", end_date="2026-07-01")
    # No well name (only CSV import can produce one, e.g. "Rig Idle") → no well row.
    db.add(
        Activity(
            project_id=uuid.UUID(pid),
            activity_type="Rig Idle",
            start_date=date(2026, 8, 1),
            end_date=date(2026, 9, 1),
            well_project="Bonga Phase 3",
        )
    )
    await db.commit()

    # Reads are org-wide.
    wells = await _lens(noplan_client, pid, "wells")
    assert [c["code"] for c in wells["checks"]] == ["LPR"]
    assert wells["project_rows"] == []  # Wells has no project-level checks
    assert [(r["well_name"], r["activity_count"]) for r in wells["well_rows"]] == [("W-1", 2)]

    # The built-in team through the same endpoint: project rows only.
    projects = await _lens(client, pid, "projects")
    assert projects["well_rows"] == []
    assert list(projects["project_rows"][0]["checks"]) == ["FDP", "LLI", "LOC", "FE", "FID", "EIA", "BUD"]

    assert (await client.get(f"/api/projects/{pid}/readiness/teams/nope")).status_code == 404


# ── Rename carry-over ───────────────────────────────────────────────────────


async def _patch(client: AsyncClient, pid: str, aid: str, **fields):
    r = await client.patch(f"/api/projects/{pid}/activities/{aid}", json=fields)
    assert r.status_code == 200, r.text


@pytest.mark.asyncio
async def test_well_values_follow_a_renamed_well(client: AsyncClient, db: AsyncSession) -> None:
    await _setup(client, db)
    pid = await _campaign(client)
    a = await _activity(client, pid)
    await _put(client, pid, "LPR", _well())

    await _patch(client, pid, a["id"], well_name="W-1A")
    row = _row(await _lens(client, pid, "wells"), "W-1A")
    assert (row["checks"]["LPR"]["status"], row["checks"]["LPR"]["source"]) == ("Completed", "well")

    event = (
        await db.execute(select(AuditLog).where(AuditLog.field == "readiness_rekeyed"))
    ).scalar_one()
    assert "W-1 (Bonga Phase 3, Oil Development) -> W-1A" in event.new_value


@pytest.mark.asyncio
async def test_project_values_follow_the_last_activity_out(client: AsyncClient, db: AsyncSession) -> None:
    pid = await _campaign(client)
    a1 = await _activity(client, pid)
    a2 = await _activity(client, pid, well_name="W-2", start_date="2026-04-01", end_date="2026-05-01")
    await _put(client, pid, "FID", {"well_project": "Bonga Phase 3"}, "Behind")

    # One of two activities leaves: the project still exists, nothing moves.
    await _patch(client, pid, a1["id"], well_project="Bonga Phase 3B")
    rows = {r["well_project"]: r for r in (await client.get(f"/api/projects/{pid}/readiness")).json()}
    assert rows["Bonga Phase 3"]["checks"]["FID"]["status"] == "Behind"
    assert rows["Bonga Phase 3B"]["checks"]["FID"]["status"] == "On Track"

    # The last one leaves: the gates go with it.
    await _patch(client, pid, a2["id"], well_project="Bonga Phase 3B")
    rows = {r["well_project"]: r for r in (await client.get(f"/api/projects/{pid}/readiness")).json()}
    assert rows["Bonga Phase 3B"]["checks"]["FID"]["status"] == "Behind"


@pytest.mark.asyncio
async def test_shared_well_key_stays_while_another_activity_uses_it(
    client: AsyncClient, db: AsyncSession
) -> None:
    await _setup(client, db)
    pid = await _campaign(client)
    a1 = await _activity(client, pid)
    await _activity(client, pid, start_date="2026-06-01", end_date="2026-07-01")  # same key
    await _put(client, pid, "LPR", _well())

    await _patch(client, pid, a1["id"], well_name="W-9")
    lens = await _lens(client, pid, "wells")
    assert _row(lens, "W-1")["checks"]["LPR"]["source"] == "well"
    assert _row(lens, "W-9")["checks"]["LPR"]["source"] == "default"


@pytest.mark.asyncio
async def test_existing_value_at_the_new_name_wins(client: AsyncClient, db: AsyncSession) -> None:
    await _setup(client, db)
    pid = await _campaign(client)
    a1 = await _activity(client, pid)
    a2 = await _activity(client, pid, well_name="W-2", start_date="2026-04-01", end_date="2026-05-01")
    await _put(client, pid, "LPR", _well(), "Completed")
    await _put(client, pid, "LPR", _well(well="W-2"), "Behind")
    await client.delete(f"/api/projects/{pid}/activities/{a2['id']}")  # W-2's value lingers

    await _patch(client, pid, a1["id"], well_name="W-2")
    assert _row(await _lens(client, pid, "wells"), "W-2")["checks"]["LPR"]["status"] == "Behind"
    # The old value is kept (orphaned), never merged or lost.
    orphan = (
        await db.execute(select(ReadinessEntry).where(ReadinessEntry.well_name == "W-1"))
    ).scalar_one()
    assert orphan.status == "Completed"
