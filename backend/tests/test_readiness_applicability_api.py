"""Checks that apply — the API (phase 6 of docs/readiness-framework-spec.md,
§3.8, §5.1–§5.3, §7.9–§7.12, §9 "Phase 6 adds").

``PUT /api/projects/{id}/readiness/teams/{team}/applicability`` lets a team say,
per field project or well, which of its checks apply. The Project gates have no
tick list (decision 31): they keep N/A, the status PUT still accepts it for
them, and the applicability write refuses them (422). A team check never takes
N/A (422 — untick it instead) and takes no status where it doesn't apply (409 —
tick it first). Ticks stay live: never refused with 423.
"""
import uuid

import pytest
from httpx import AsyncClient, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit import AuditLog
from app.models.readiness import ReadinessApplicability, ReadinessCheck
from app.models.user import User

FP = "Bonga Phase 3"
ACT = "Oil Development"
PROJECT = {"scope": "project", "well_project": FP}
GATES = ["FDP", "LLI", "LOC", "FE", "FID", "EIA", "BUD"]

# Logistics: two two-level checks and a project-only one; Wells: a well-only one.
CHECKS = (
    ("NAV", "Naval Clearance", "logistics", True, True, "ship", 10),
    ("PO", "Purchase Order", "logistics", True, True, "receipt", 20),
    ("L-PRJ", "Project Permit", "logistics", True, False, "truck", 30),
    ("LPR", "Location Preparation", "wells", False, True, "map-pin", 10),
)


# ── Fixtures ────────────────────────────────────────────────────────────────


async def _user(client: AsyncClient, db: AsyncSession, email: str) -> User:
    await client.get("/api/projects")  # the auth dependency materialises the user
    return (await db.execute(select(User).where(User.email == email))).scalar_one()


async def _catalog(client: AsyncClient, db: AsyncSession) -> None:
    """As admin (test@): the Wells and Logistics teams and their checks."""
    me = await _user(client, db, "test@company.com")
    me.is_admin = True
    await db.commit()
    for code, name, icon in (("wells", "Wells", "map-pin"), ("logistics", "Logistics", "truck")):
        r = await client.post(
            "/api/admin/readiness/teams", json={"code": code, "name": name, "icon_key": icon}
        )
        assert r.status_code == 201, r.text
    for code, label, team, at_project, at_well, icon, order in CHECKS:
        r = await client.post(
            "/api/admin/readiness/checks",
            json={
                "code": code,
                "label": label,
                "team_code": team,
                "applies_project": at_project,
                "applies_well": at_well,
                "status_set": "standard",
                "icon_key": icon,
                "locks_with_plan": False,
                "sort_order": order,
            },
        )
        assert r.status_code == 201, r.text


async def _activity(client: AsyncClient, pid: str, well: str, project: str | None = FP) -> None:
    r = await client.post(
        f"/api/projects/{pid}/activities",
        json={
            "activity_type": ACT,
            "start_date": "2026-11-01",
            "end_date": "2027-01-31",
            "well_name": well,
            "rig_name": f"Rig {well}",
            "location": "SWAMP",
            "plan_type": "Firm",
            "risk": "No Flood Risk",
            "well_project": project,
        },
    )
    assert r.status_code == 201, r.text


async def _campaign(client: AsyncClient, name: str = "Applies") -> str:
    """W-1 and W-2 under one field project, and LONE-1 with no field project."""
    pid = (await client.post("/api/projects", json={"name": name})).json()["id"]
    await _activity(client, pid, "W-1")
    await _activity(client, pid, "W-2")
    await _activity(client, pid, "LONE-1", project=None)
    return pid


async def _setup(client: AsyncClient, db: AsyncSession) -> str:
    await _catalog(client, db)
    return await _campaign(client)


def _well(name: str = "W-1", project: str = FP) -> dict:
    return {"scope": "well", "well_project": project, "well_name": name, "activity_type": ACT}


async def _apply(
    client: AsyncClient, pid: str, target: dict, applies: dict, team: str = "logistics"
) -> Response:
    return await client.put(
        f"/api/projects/{pid}/readiness/teams/{team}/applicability",
        json={**target, "applies": applies},
    )


async def _put(client: AsyncClient, pid: str, code: str, target: dict, status: str) -> Response:
    return await client.put(f"/api/projects/{pid}/readiness/{code}", json={**target, "status": status})


async def _lens(client: AsyncClient, pid: str, team: str = "logistics") -> dict:
    r = await client.get(f"/api/projects/{pid}/readiness/teams/{team}")
    assert r.status_code == 200, r.text
    return r.json()


def _well_row(rows: dict, name: str = "W-1") -> dict:
    return next(r for r in rows["well_rows"] if r["well_name"] == name)


def _cell(rows: dict, code: str, well: str | None = None) -> dict:
    """One cell of a lens (or of an applicability response): the field project's
    row, or a well's."""
    if well is None:
        return next(r for r in rows["project_rows"] if r["well_project"] == FP)["checks"][code]
    return _well_row(rows, well)["checks"][code]


async def _events(db: AsyncSession, pid: str, action: str) -> list[AuditLog]:
    return list(
        (
            await db.execute(
                select(AuditLog)
                .where(AuditLog.project_id == uuid.UUID(pid), AuditLog.field == action)
                .order_by(AuditLog.timestamp)
            )
        ).scalars()
    )


async def _details(db: AsyncSession, pid: str, action: str = "readiness_applicability_changed") -> list[str]:
    return [e.new_value for e in await _events(db, pid, action)]


async def _rows(db: AsyncSession, pid: str) -> list[tuple]:
    return sorted(
        (r.check_code, r.scope, r.well_project, r.well_name, r.applies)
        for r in (
            await db.execute(
                select(ReadinessApplicability).where(
                    ReadinessApplicability.project_id == uuid.UUID(pid)
                )
            )
        ).scalars()
    )


async def _grant(admin: AsyncClient, user: User, teams: list[str]) -> None:
    r = await admin.put(f"/api/admin/users/{user.id}/teams", json={"teams": teams})
    assert r.status_code == 200, r.text


async def _approve(client: AsyncClient, approver: AsyncClient, pid: str) -> None:
    """Submit (client) and approve (approver = other@) — approval keeps the plan
    locked."""
    r = await client.post(
        f"/api/projects/{pid}/approvers", json={"email": "other@company.com", "role_label": "Approver"}
    )
    assert r.status_code in (200, 201), r.text
    rev = await client.post(f"/api/projects/{pid}/revisions", json={})
    assert rev.status_code in (200, 201), rev.text
    signed = await approver.put(
        f"/api/projects/{pid}/revisions/{rev.json()['id']}/sign",
        json={"role_label": "Manager", "attested": True},
    )
    assert signed.status_code == 200 and signed.json()["status"] == "approved", signed.text


# ── Who (spec §5.2) ─────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_only_the_teams_editors_tick_its_checks(
    client: AsyncClient,
    other_client: AsyncClient,
    third_client: AsyncClient,
    noplan_client: AsyncClient,
    db: AsyncSession,
) -> None:
    await _catalog(client, db)
    pid = await _campaign(other_client)  # other@ plans the campaign, without a grant
    wells_grantee = await _user(third_client, db, "third@company.com")
    await _grant(client, wells_grantee, ["wells"])
    untick = {"NAV": False}

    # A non-grantee, another team's grantee and the campaign's own planner: 403,
    # with nothing written or audited.
    assert (await _apply(noplan_client, pid, PROJECT, untick)).status_code == 403
    assert (await _apply(third_client, pid, PROJECT, untick)).status_code == 403
    assert (await _apply(other_client, pid, PROJECT, untick)).status_code == 403
    assert await _rows(db, pid) == []
    assert await _details(db, pid) == []

    # The team's grantee, and an admin.
    await _grant(client, await _user(noplan_client, db, "noplan@company.com"), ["logistics"])
    assert (await _apply(noplan_client, pid, PROJECT, untick)).status_code == 200
    assert (await _apply(client, pid, PROJECT, {"PO": False})).status_code == 200
    # A Wells grantee ticks the Wells team's checks.
    assert (await _apply(third_client, pid, _well(), {"LPR": False}, team="wells")).status_code == 200
    assert len(await _details(db, pid)) == 3


# ── Locks ───────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_ticks_stay_live_while_the_plan_is_locked(
    client: AsyncClient, other_client: AsyncClient, db: AsyncSession
) -> None:
    """Pending or approved, a tick is never refused with 423 — like the team
    statuses (spec §3.2, §5.2) — and each one is really written: the stored row,
    the lens cell, and one audit event per 200."""
    pid = await _setup(client, db)
    rev = await client.post(f"/api/projects/{pid}/revisions", json={})
    assert rev.status_code in (200, 201), rev.text
    assert (await _lens(client, pid))["locked"] is True
    assert (await _apply(client, pid, PROJECT, {"NAV": False})).status_code == 200
    assert await _rows(db, pid) == [("NAV", "project", FP, "", False)]
    nav = _cell(await _lens(client, pid), "NAV")
    assert (nav["applies"], nav["applies_source"]) == (False, "project")
    assert await _details(db, pid) == ["NAV: applies -> does not apply; for Bonga Phase 3"]
    discard = await client.delete(f"/api/projects/{pid}/revisions/{rev.json()['id']}")
    assert discard.status_code == 204

    await _approve(client, other_client, pid)
    assert (await _lens(client, pid))["locked"] is True
    assert (await _apply(client, pid, PROJECT, {"NAV": True})).status_code == 200
    assert await _rows(db, pid) == []
    nav = _cell(await _lens(client, pid), "NAV")
    assert (nav["applies"], nav["applies_source"]) == (True, "default")
    assert (await _details(db, pid))[1:] == ["NAV: does not apply -> applies; for Bonga Phase 3"]

    assert (await _apply(client, pid, _well(), {"PO": False})).status_code == 200
    assert await _rows(db, pid) == [("PO", "well", FP, "W-1", False)]
    po = _cell(await _lens(client, pid), "PO", "W-1")
    assert (po["applies"], po["applies_source"]) == (False, "well")
    assert (await _details(db, pid))[2:] == [
        "PO: follows field project -> does not apply; for W-1 (Bonga Phase 3, Oil Development)"
    ]


@pytest.mark.asyncio
async def test_a_project_gate_status_write_while_approved_is_423(
    client: AsyncClient, other_client: AsyncClient, db: AsyncSession
) -> None:
    """Approval keeps the plan locked (the approved snapshot is the record), so a
    Project-gate status write is refused — nothing written, nothing audited —
    while a team check's status stays writable."""
    pid = await _setup(client, db)
    assert (await _put(client, pid, "FID", PROJECT, "Behind")).status_code == 200
    await _approve(client, other_client, pid)
    before = await _details(db, pid, "readiness_updated")

    refused = await _put(client, pid, "FID", PROJECT, "Completed")
    assert refused.status_code == 423
    assert "locked by a revision (pending or approved)" in refused.json()["detail"]
    refused_na = await _put(client, pid, "FID", PROJECT, "N/A")
    assert refused_na.status_code == 423
    rows = (await client.get(f"/api/projects/{pid}/readiness")).json()
    assert rows[0]["checks"]["FID"]["status"] == "Behind" and rows[0]["locked"] is True
    assert await _details(db, pid, "readiness_updated") == before

    assert (await _put(client, pid, "PO", _well(), "Completed")).status_code == 200


# ── Refusals ────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("target", "applies", "detail"),
    [
        # Another team's code, an unknown one.
        (PROJECT, {"LPR": False}, "Unknown or retired readiness check for this team"),
        (PROJECT, {"FID": False}, "Unknown or retired readiness check for this team"),
        (PROJECT, {"ZZZ": False}, "Unknown or retired readiness check for this team"),
        # A check not enabled at the target's level.
        (_well(), {"L-PRJ": False}, "This readiness check isn't used at that level"),
    ],
)
async def test_codes_outside_the_teams_ticks_are_422(
    client: AsyncClient, db: AsyncSession, target: dict, applies: dict, detail: str
) -> None:
    pid = await _setup(client, db)
    r = await _apply(client, pid, target, applies)
    assert r.status_code == 422 and r.json()["detail"] == detail
    assert await _rows(db, pid) == []


@pytest.mark.asyncio
async def test_a_well_only_check_is_not_ticked_on_a_field_project(
    client: AsyncClient, db: AsyncSession
) -> None:
    pid = await _setup(client, db)
    r = await _apply(client, pid, PROJECT, {"LPR": False}, team="wells")
    assert r.status_code == 422
    assert r.json()["detail"] == "This readiness check isn't used at that level"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "body",
    [
        {**PROJECT, "applies": {"NAV": None}},  # a field project has nothing to follow
        {**PROJECT, "applies": {}},  # 1–50 entries
        {**PROJECT, "applies": {f"C{i}": False for i in range(51)}},
        {**PROJECT, "applies": {"NAV": "false"}},  # never coerced into a choice
        {**PROJECT, "applies": {"NAV": 0}},
        {**PROJECT, "applies": {"X" * 17: False}},  # bounded like the code column
        {**PROJECT, "applies": {"NAV": False}, "reason": "no swamp"},  # no untick reason
        {"well_project": FP, "well_name": "W-1", "applies": {"NAV": False}},  # target shape
        {"scope": "well", "well_project": FP, "applies": {"NAV": False}},
        {**PROJECT},
    ],
)
async def test_the_body_is_validated(client: AsyncClient, db: AsyncSession, body: dict) -> None:
    pid = await _setup(client, db)
    r = await client.put(f"/api/projects/{pid}/readiness/teams/logistics/applicability", json=body)
    assert r.status_code == 422, r.text


@pytest.mark.asyncio
async def test_retired_and_withdrawn_checks_are_422(client: AsyncClient, db: AsyncSession) -> None:
    pid = await _setup(client, db)
    assert (await client.post("/api/admin/readiness/checks/PO/retire")).status_code == 200
    assert (await _apply(client, pid, PROJECT, {"PO": False})).status_code == 422
    # NEQ as migration 036 seeded it — withdrawn, retired or not (spec §4.4).
    db.add(
        ReadinessCheck(
            code="NEQ",
            label="Nominated Equipment",
            team_code="logistics",
            applies_project=True,
            applies_well=True,
            status_set="availability",
            icon_key="forklift",
            locks_with_plan=False,
            tag_list="equipment",
        )
    )
    await db.commit()
    assert (await _apply(client, pid, PROJECT, {"NEQ": False})).status_code == 422
    assert (await _apply(client, pid, _well(), {"NEQ": True})).status_code == 422
    assert await _rows(db, pid) == []


@pytest.mark.asyncio
async def test_the_project_gates_use_n_a(client: AsyncClient, db: AsyncSession) -> None:
    """No tick list for checks that lock with the plan (decision 31): the Projects
    team, or a governed check an admin created elsewhere before 2026-10-16."""
    pid = await _setup(client, db)
    r = await _apply(client, pid, PROJECT, {"FID": False}, team="projects")
    assert r.status_code == 422 and r.json()["detail"] == "The Project gates use N/A"

    db.add(
        ReadinessCheck(
            code="GOV",
            label="Governed Legacy",
            team_code="logistics",
            applies_project=True,
            applies_well=False,
            status_set="standard",
            icon_key="truck",
            locks_with_plan=True,
        )
    )
    await db.commit()
    r = await _apply(client, pid, PROJECT, {"GOV": False})
    assert r.status_code == 422 and r.json()["detail"] == "The Project gates use N/A"
    # …and it keeps N/A, like a gate.
    assert (await _put(client, pid, "GOV", PROJECT, "N/A")).status_code == 200
    assert await _rows(db, pid) == []


@pytest.mark.asyncio
async def test_unknown_or_inactive_team_is_404(client: AsyncClient, db: AsyncSession) -> None:
    pid = await _setup(client, db)
    assert (await _apply(client, pid, PROJECT, {"NAV": False}, team="nope")).status_code == 404
    await client.patch("/api/admin/readiness/teams/logistics", json={"is_active": False})
    assert (await _apply(client, pid, PROJECT, {"NAV": False})).status_code == 404


@pytest.mark.asyncio
async def test_an_unknown_target_is_404(client: AsyncClient, db: AsyncSession) -> None:
    """BOLA: only targets with activities in THIS campaign — a name that exists
    only in another campaign included."""
    pid = await _setup(client, db)
    other = (await client.post("/api/projects", json={"name": "Elsewhere"})).json()["id"]
    await _activity(client, other, "W-ELSEWHERE", project="Egina North")

    for target in (
        _well("W-9"),
        _well("W-ELSEWHERE", project="Egina North"),
        {"scope": "project", "well_project": "Egina North"},
        {**_well(), "activity_type": "Gas Workover"},
    ):
        assert (await _apply(client, pid, target, {"NAV": False})).status_code == 404, target
    assert await _rows(db, pid) == []
    assert await _rows(db, other) == []


@pytest.mark.asyncio
async def test_a_team_check_never_takes_n_a_but_a_project_gate_does(
    client: AsyncClient, db: AsyncSession
) -> None:
    """The pickable rule (spec §3.3): a set's statuses, minus N/A when the check
    doesn't lock with the plan."""
    pid = await _setup(client, db)
    for target in (PROJECT, _well()):
        r = await _put(client, pid, "PO", target, "N/A")
        assert r.status_code == 422 and r.json()["detail"] == "Untick the check instead"
    assert (await _put(client, pid, "FID", PROJECT, "N/A")).status_code == 200
    rows = (await client.get(f"/api/projects/{pid}/readiness")).json()
    assert rows[0]["checks"]["FID"]["status"] == "N/A"


@pytest.mark.asyncio
async def test_no_status_where_a_check_does_not_apply(client: AsyncClient, db: AsyncSession) -> None:
    """A status, or Reset to project, on a team check that doesn't apply to the
    target → 409, with nothing written (spec §7.10). Ticking it opens it again."""
    pid = await _setup(client, db)
    await _put(client, pid, "NAV", _well(), "Behind")  # an override to reset
    assert (await _apply(client, pid, PROJECT, {"NAV": False})).status_code == 200
    statuses_before = await _details(db, pid, "readiness_updated")

    for target in (PROJECT, _well(), _well("W-2")):  # the wells follow the untick
        r = await _put(client, pid, "NAV", target, "Completed")
        assert r.status_code == 409, target
        assert r.json()["detail"] == "This check doesn't apply here — tick it first"
    reset = await client.post(f"/api/projects/{pid}/readiness/NAV/reset", json=_well())
    assert reset.status_code == 409
    assert await _details(db, pid, "readiness_updated") == statuses_before
    assert await _details(db, pid, "readiness_reset") == []

    # A well's own untick, under a field project where the check applies.
    assert (await _apply(client, pid, _well("W-2"), {"PO": False})).status_code == 200
    assert (await _put(client, pid, "PO", _well("W-2"), "Completed")).status_code == 409
    assert (await _put(client, pid, "PO", PROJECT, "Completed")).status_code == 200

    # Ticked on the well: writable again.
    assert (await _apply(client, pid, _well(), {"NAV": True})).status_code == 200
    assert (await _put(client, pid, "NAV", _well(), "Completed")).status_code == 200


# ── Behaviour ───────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_one_event_per_changed_code_and_none_for_no_ops(
    client: AsyncClient, db: AsyncSession
) -> None:
    pid = await _setup(client, db)
    r = await _apply(client, pid, PROJECT, {"NAV": False, "PO": True})  # PO applies already
    assert r.status_code == 200, r.text
    assert await _details(db, pid) == ["NAV: applies -> does not apply; for Bonga Phase 3"]
    assert await _rows(db, pid) == [("NAV", "project", FP, "", False)]

    # The same again changes nothing: no row, no event.
    assert (await _apply(client, pid, PROJECT, {"NAV": False, "PO": True})).status_code == 200
    assert len(await _details(db, pid)) == 1

    # A well: PO differs from its field project (a row); NAV already matches it.
    r = await _apply(client, pid, _well(), {"PO": False, "NAV": False})
    assert r.status_code == 200, r.text
    assert (await _details(db, pid))[1:] == [
        "PO: follows field project -> does not apply; for W-1 (Bonga Phase 3, Oil Development)"
    ]
    assert await _rows(db, pid) == [
        ("NAV", "project", FP, "", False),
        ("PO", "well", FP, "W-1", False),
    ]
    # Follow project on a well that follows already: nothing.
    assert (await _apply(client, pid, _well(), {"NAV": None})).status_code == 200
    assert len(await _details(db, pid)) == 2

    # The event names the row it changed, and the feed shows it.
    events = await _events(db, pid, "readiness_applicability_changed")
    row_ids = {
        r.id for r in (await db.execute(select(ReadinessApplicability))).scalars()
    }
    assert {e.entity_id for e in events} <= row_ids
    assert all(e.entity_type == "readiness" for e in events)
    feed = (await client.get(f"/api/projects/{pid}/audit")).json()
    assert sum(e["field"] == "readiness_applicability_changed" for e in feed) == 2


@pytest.mark.asyncio
async def test_one_request_changing_two_codes_audits_each_in_catalog_order(
    client: AsyncClient, db: AsyncSession
) -> None:
    """Every code a request changes writes its own row and its own event — in
    catalog order (NAV, then PO), whatever order the body lists them in."""
    pid = await _setup(client, db)
    r = await _apply(client, pid, PROJECT, {"PO": False, "NAV": False})
    assert r.status_code == 200, r.text
    assert await _details(db, pid) == [
        "NAV: applies -> does not apply; for Bonga Phase 3",
        "PO: applies -> does not apply; for Bonga Phase 3",
    ]
    assert await _rows(db, pid) == [
        ("NAV", "project", FP, "", False),
        ("PO", "project", FP, "", False),
    ]

    # A well where both codes differ from its field project: two more of each.
    r = await _apply(client, pid, _well(), {"PO": True, "NAV": True})
    assert r.status_code == 200, r.text
    assert (await _details(db, pid))[2:] == [
        "NAV: follows field project -> applies; for W-1 (Bonga Phase 3, Oil Development)",
        "PO: follows field project -> applies; for W-1 (Bonga Phase 3, Oil Development)",
    ]
    assert await _rows(db, pid) == [
        ("NAV", "project", FP, "", False),
        ("NAV", "well", FP, "W-1", True),
        ("PO", "project", FP, "", False),
        ("PO", "well", FP, "W-1", True),
    ]


@pytest.mark.asyncio
async def test_repeating_a_wells_own_choice_writes_nothing(
    client: AsyncClient, noplan_client: AsyncClient, db: AsyncSession
) -> None:
    """The same own choice again is a no-op: no event, and the row is untouched
    — not even re-stamped by the second editor (``updated_by``/``updated_at``)."""
    pid = await _setup(client, db)
    admin = await _user(client, db, "test@company.com")
    grantee = await _user(noplan_client, db, "noplan@company.com")
    await _grant(client, grantee, ["logistics"])

    async def own_row() -> tuple:
        row = (
            await db.execute(
                select(ReadinessApplicability)
                .where(ReadinessApplicability.project_id == uuid.UUID(pid))
                .execution_options(populate_existing=True)
            )
        ).scalar_one()
        return (
            row.id, row.check_code, row.scope, row.well_name, row.applies,
            row.updated_by, row.updated_at,
        )

    assert (await _apply(client, pid, _well(), {"PO": False})).status_code == 200
    first, events = await own_row(), await _details(db, pid)
    assert first[1:6] == ("PO", "well", "W-1", False, admin.id)
    assert len(events) == 1

    # Another editor (a Logistics grantee) saves the same choice.
    r = await _apply(noplan_client, pid, _well(), {"PO": False})
    assert r.status_code == 200, r.text
    assert await own_row() == first  # still the first editor's row, same stamp
    assert await _details(db, pid) == events


@pytest.mark.asyncio
async def test_a_request_is_all_or_nothing(client: AsyncClient, db: AsyncSession) -> None:
    pid = await _setup(client, db)
    assert (await _apply(client, pid, PROJECT, {"NAV": False, "ZZZ": False})).status_code == 422
    assert (await _apply(client, pid, _well(), {"NAV": False, "L-PRJ": False})).status_code == 422
    assert await _rows(db, pid) == []
    assert await _details(db, pid) == []


@pytest.mark.asyncio
async def test_unticking_a_field_project_reaches_its_wells_and_keeps_the_status(
    client: AsyncClient, db: AsyncSession
) -> None:
    """Spec §3.8, §7.9: the untick reaches every well that follows its field
    project — a well with its own status included — and keeps the statuses
    underneath, so re-ticking brings them back."""
    pid = await _setup(client, db)
    await _put(client, pid, "PO", PROJECT, "Completed")
    await _put(client, pid, "PO", _well(), "Behind")  # W-1's own status

    r = await _apply(client, pid, PROJECT, {"PO": False})
    assert r.status_code == 200, r.text
    rows = r.json()
    project = _cell(rows, "PO")
    assert (project["status"], project["applies"], project["applies_source"]) == (
        "Completed",
        False,
        "project",
    )
    w1, w2 = _cell(rows, "PO", "W-1"), _cell(rows, "PO", "W-2")
    assert (w1["status"], w1["source"], w1["applies"], w1["applies_source"]) == (
        "Behind",
        "well",
        False,
        "project",
    )
    # W-2 follows the field project, whose status it no longer inherits.
    assert (w2["applies"], w2["applies_source"]) == (False, "project")

    # Not counted while unticked: three project-level checks, one doesn't apply.
    figures = next(r for r in rows["project_rows"])["figures"]
    assert (figures["counted"], figures["na"]) == (2, 1)
    assert _well_row(rows)["figures"]["counted"] == 2

    rows = (await _apply(client, pid, PROJECT, {"PO": True})).json()
    assert _cell(rows, "PO")["status"] == "Completed" and _cell(rows, "PO")["applies"] is True
    assert _cell(rows, "PO", "W-1")["status"] == "Behind"
    assert (_cell(rows, "PO", "W-2")["status"], _cell(rows, "PO", "W-2")["source"]) == (
        "Completed",
        "project",
    )
    assert await _rows(db, pid) == []


@pytest.mark.asyncio
async def test_a_well_ticked_under_an_unticked_field_project_reads_the_default(
    client: AsyncClient, db: AsyncSession
) -> None:
    """Spec §3.8: never the project's hidden status — in the cell, in the status
    PUT's audit old value, and in Reset to project's response and audit."""
    pid = await _setup(client, db)
    await _put(client, pid, "PO", PROJECT, "Completed")
    await _apply(client, pid, PROJECT, {"PO": False})

    r = await _apply(client, pid, _well(), {"PO": True})
    assert r.status_code == 200
    cell = _cell(r.json(), "PO", "W-1")
    assert (cell["status"], cell["source"], cell["applies"], cell["applies_source"]) == (
        "On Track",
        "default",
        True,
        "well",
    )
    assert (await _details(db, pid))[-1] == (
        "PO: follows field project -> applies; for W-1 (Bonga Phase 3, Oil Development)"
    )

    assert (await _put(client, pid, "PO", _well(), "Behind")).status_code == 200
    updated = (await _events(db, pid, "readiness_updated"))[-1]
    assert updated.old_value == "On Track"
    assert updated.new_value == "PO for W-1 (Bonga Phase 3, Oil Development): On Track -> Behind"

    reset = await client.post(f"/api/projects/{pid}/readiness/PO/reset", json=_well())
    assert reset.status_code == 200
    body = reset.json()
    assert (body["status"], body["source"], body["applies"], body["applies_source"]) == (
        "On Track",
        "default",
        True,
        "well",
    )
    assert (await _details(db, pid, "readiness_reset")) == [
        "PO for W-1 (Bonga Phase 3, Oil Development): Behind -> On Track "
        "(now follows the field project)"
    ]


@pytest.mark.asyncio
async def test_a_wells_own_choice_and_follow_project(client: AsyncClient, db: AsyncSession) -> None:
    """A well's own choice is stored only while it differs from its field project
    at that moment, then kept — even once the field project matches — until Follow
    project, or a write of the field project's current choice, removes it (spec
    §3.8, §4.4). Removing it is audited."""
    pid = await _setup(client, db)
    await _apply(client, pid, _well(), {"PO": False, "NAV": False})
    await _apply(client, pid, PROJECT, {"PO": False, "NAV": False})  # the project now matches
    lens = await _lens(client, pid)
    assert _cell(lens, "PO", "W-1")["applies_source"] == "well"  # kept: "set on this well"
    assert _cell(lens, "PO", "W-2")["applies_source"] == "project"

    # A write of the field project's current choice removes the row.
    r = await _apply(client, pid, _well(), {"PO": False})
    assert r.status_code == 200
    assert _cell(r.json(), "PO", "W-1")["applies_source"] == "project"
    # Follow project removes it whatever the field project says now — after a
    # concurrent untick of the field project, the well then doesn't apply.
    r = await _apply(client, pid, _well(), {"NAV": None})
    nav = _cell(r.json(), "NAV", "W-1")
    assert (nav["applies"], nav["applies_source"]) == (False, "project")
    assert await _rows(db, pid) == [
        ("NAV", "project", FP, "", False),
        ("PO", "project", FP, "", False),
    ]
    assert (await _details(db, pid))[-2:] == [
        "PO: set on this well -> follows field project; for W-1 (Bonga Phase 3, Oil Development)",
        "NAV: set on this well -> follows field project; for W-1 (Bonga Phase 3, Oil Development)",
    ]

    # A choice that differs, then Follow project with the effective value changing.
    await _apply(client, pid, _well(), {"PO": True})
    r = await _apply(client, pid, _well(), {"PO": None})
    assert _cell(r.json(), "PO", "W-1")["applies"] is False
    assert (await _details(db, pid))[-1] == (
        "PO: applies -> follows field project; for W-1 (Bonga Phase 3, Oil Development)"
    )


@pytest.mark.asyncio
async def test_a_well_with_no_field_project(client: AsyncClient, db: AsyncSession) -> None:
    """Checks enabled at both levels are ticked per well, with nothing to follow;
    project-only checks carry nothing there (spec §3.8, §7.12)."""
    pid = await _setup(client, db)
    lone = _well("LONE-1", project="")
    lens = await _lens(client, pid)
    assert list(_well_row(lens, "LONE-1")["checks"]) == ["NAV", "PO"]  # no L-PRJ
    assert _well_row(lens, "LONE-1")["figures"]["counted"] == 2
    assert list(_well_row(lens, "W-1")["checks"]) == ["NAV", "PO", "L-PRJ"]

    assert (await _apply(client, pid, lone, {"L-PRJ": False})).status_code == 422
    r = await _apply(client, pid, lone, {"NAV": False})
    assert r.status_code == 200
    assert [w["well_name"] for w in r.json()["well_rows"]] == ["LONE-1"]
    assert await _rows(db, pid) == [("NAV", "well", "", "LONE-1", False)]
    assert (await _apply(client, pid, lone, {"NAV": None})).status_code == 200
    assert await _rows(db, pid) == []
    assert await _details(db, pid) == [
        "NAV: applies -> does not apply; for LONE-1 (no field project, Oil Development)",
        "NAV: does not apply -> applies; for LONE-1 (no field project, Oil Development)",
    ]


@pytest.mark.asyncio
async def test_the_response_holds_exactly_the_rows_the_write_affects(
    client: AsyncClient, db: AsyncSession
) -> None:
    """Built as the lens builds them: a field project's row plus every well row
    under it, or one well's row (spec §5.1)."""
    pid = await _setup(client, db)
    await _put(client, pid, "PO", PROJECT, "Completed")

    r = await _apply(client, pid, PROJECT, {"NAV": False})
    lens = await _lens(client, pid)
    assert r.json()["project_rows"] == lens["project_rows"]
    assert r.json()["well_rows"] == [w for w in lens["well_rows"] if w["well_project"] == FP]
    assert [w["well_name"] for w in r.json()["well_rows"]] == ["W-1", "W-2"]

    r = await _apply(client, pid, _well("W-2"), {"PO": False})
    assert r.json()["project_rows"] == []
    assert r.json()["well_rows"] == [_well_row(await _lens(client, pid), "W-2")]


@pytest.mark.asyncio
async def test_team_rows_report_applies_and_the_gates_keep_their_shape(
    client: AsyncClient, db: AsyncSession
) -> None:
    pid = await _setup(client, db)
    lens = await _lens(client, pid)
    assert set(_cell(lens, "PO")) == {"status", "notes", "updated_at", "applies", "applies_source"}
    assert set(_cell(lens, "PO", "W-1")) == {
        "status", "notes", "updated_at", "applies", "applies_source", "source",
    }
    assert (_cell(lens, "PO")["applies"], _cell(lens, "PO")["applies_source"]) == (True, "default")

    # GET /readiness — the Project gates — keeps its shape: no applies, no tags.
    rows = (await client.get(f"/api/projects/{pid}/readiness")).json()
    assert list(rows[0]["checks"]) == GATES
    assert set(rows[0]["checks"]["FID"]) == {"status", "notes", "updated_at"}
    # Through the team lens, a gate always applies — from the default.
    gates = await _lens(client, pid, "projects")
    assert {(c["applies"], c["applies_source"]) for c in gates["project_rows"][0]["checks"].values()} == {
        (True, "default")
    }


@pytest.mark.asyncio
async def test_the_tab_adds_up_to_the_tile_with_unticked_checks(
    client: AsyncClient, db: AsyncSession
) -> None:
    """The server's per-row ``figures`` and the dashboard tile read an unticked
    cell the same way — not counted (spec §3.7)."""
    from app.services.readiness_rollup import pct

    pid = await _setup(client, db)
    await _put(client, pid, "PO", PROJECT, "Completed")
    await _apply(client, pid, PROJECT, {"NAV": False})
    await _apply(client, pid, _well("W-2"), {"NAV": True})  # ticked under the untick
    await _apply(client, pid, _well("LONE-1", project=""), {"PO": False})

    lens = await _lens(client, pid)
    figs = [r["figures"] for r in lens["well_rows"] if r["focus_start"]]
    assert [(r["well_name"], r["figures"]["counted"]) for r in lens["well_rows"]] == [
        ("LONE-1", 1),  # NAV; PO unticked; no L-PRJ without a field project
        ("W-1", 2),  # PO, L-PRJ; NAV follows the untick
        ("W-2", 3),
    ]
    tile = next(
        t
        for t in (
            await client.get(f"/api/projects/{pid}/dashboard?readiness_horizon_months=0")
        ).json()["team_readiness"]
        if t["team_code"] == "logistics"
    )
    counted = sum(f["counted"] for f in figs)
    done = sum(f["done"] for f in figs)
    assert (len(figs), pct(done, counted), sum(f["behind"] for f in figs)) == (
        tile["focus_count"],
        tile["overall_pct"],
        tile["behind_cells"],
    )
    assert pct(done + sum(f["in_progress"] for f in figs), counted) == tile["on_track_pct"]


@pytest.mark.asyncio
async def test_a_snapshot_records_an_unticked_team_check_as_n_a(
    client: AsyncClient, db: AsyncSession
) -> None:
    """Spec §6: an unticked team check is N/A in ``readiness_at_submission``; an
    N/A Project gate is recorded as today."""
    import json

    pid = await _setup(client, db)
    await _put(client, pid, "PO", PROJECT, "Completed")
    await _apply(client, pid, PROJECT, {"PO": False})
    await _put(client, pid, "FID", PROJECT, "N/A")
    rev = await client.post(f"/api/projects/{pid}/revisions", json={})
    assert rev.status_code in (200, 201), rev.text
    detail = (await client.get(f"/api/projects/{pid}/revisions/{rev.json()['id']}")).json()
    w1 = next(a for a in json.loads(detail["snapshot_json"]) if a["well_name"] == "W-1")
    assert w1["readiness_at_submission"]["PO"]["status"] == "N/A"
    assert w1["readiness_at_submission"]["NAV"]["status"] == "On Track"
    assert w1["readiness"]["FID"] == "N/A"
