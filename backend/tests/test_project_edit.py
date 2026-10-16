"""Edit a field project and its wells in one go (the project dialog's edit mode).

Existing wells keep their dates unless the planner changes them or re-sequences;
new wells chain after the project's last well on their rig with the Add-project
gap rules. The save is all or nothing, refuses a stale or incomplete request,
never merges two projects by a rename, and keeps completed wells' actuals.
"""
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity
from app.models.audit import AuditLog
from app.models.project import ProjectMember, ProjectRole
from app.models.user import User
from app.schemas.project_wells import ProjectWellsEditIn
from app.services.project_planner import EditRefused, plan_project_edit

PROJECT = "Bonga Phase 4"
NOW = datetime(2026, 10, 1, tzinfo=timezone.utc)


# ── The planning rules (no database) ────────────────────────────────────────


def act(name: str, start: date, days: int, rig: str | None = "Rig A", **over) -> Activity:
    return Activity(
        id=over.get("id", uuid.uuid4()),
        activity_type=over.get("activity_type", "Oil Development"),
        well_name=name,
        rig_name=rig,
        hwu_name=None,
        well_project=over.get("well_project", PROJECT),
        location=over.get("location", "SWAMP"),
        plan_type=over.get("plan_type", "Firm"),
        risk=over.get("risk", "No Flood Risk"),
        market=over.get("market", "Oil"),
        readiness_required=True,
        start_date=start,
        end_date=start + timedelta(days=days),
        completed_at=over.get("completed_at"),
        updated_at=NOW,
    )


def row(a: Activity, **over) -> dict:
    """An existing well as the dialog sends it back."""
    return {
        "id": str(a.id),
        "expected_updated_at": a.updated_at.isoformat(),
        "well_name": a.well_name,
        "activity_type": a.activity_type,
        "resource_type": "rig" if a.rig_name else "none",
        "resource_name": a.rig_name,
        "start_date": a.start_date.isoformat(),
        "end_date": a.end_date.isoformat(),
        **over,
    }


def new_row(name: str, rig: str | None = "Rig A", months: float = 2.5, **over) -> dict:
    return {
        "well_name": name,
        "activity_type": "Oil Development",
        "resource_type": "rig" if rig else "none",
        "resource_name": rig,
        "duration_months": months,
        **over,
    }


def edit(wells: list[dict], **over) -> ProjectWellsEditIn:
    return ProjectWellsEditIn.model_validate({"well_project": PROJECT, "wells": wells, **over})


START = date(2027, 1, 1)


def test_existing_wells_keep_their_dates_and_new_ones_chain_after_them() -> None:
    w1 = act("W-1", START, 60)
    w2 = act("W-2", START + timedelta(days=74), 60)  # after a 2-week gap
    plan = plan_project_edit(edit([row(w1), row(w2), new_row("W-3")]), [w1, w2], []).plan()

    assert [(w.gap_kind, w.change) for w in plan.wells] == [
        ("kept", "unchanged"),
        ("kept", "unchanged"),
        ("inter_well", "new"),
    ]
    assert plan.wells[2].start_date == w2.end_date + timedelta(days=14)
    assert plan.wells[2].end_date == plan.wells[2].start_date + timedelta(days=76)  # 2.5 months


def test_a_fourth_well_takes_the_batch_gap() -> None:
    wells = [act(f"W-{i}", START + timedelta(days=74 * i), 60) for i in range(3)]
    plan = plan_project_edit(
        edit([*(row(w) for w in wells), new_row("W-4")]), wells, []
    ).plan()
    assert (plan.wells[3].gap_kind, plan.wells[3].gap_before_days) == ("batch", 28)


def test_a_new_well_on_a_fresh_rig_starts_with_the_project_unless_the_rig_is_busy() -> None:
    w1 = act("W-1", START, 60)
    free = plan_project_edit(edit([row(w1), new_row("W-2", "Rig B")]), [w1], []).plan()
    assert free.wells[1].start_date == START  # the project's earliest start

    busy = act("OTHER-1", START - timedelta(days=10), 40, rig="Rig B", well_project="Elsewhere")
    moved = plan_project_edit(edit([row(w1), new_row("W-2", "Rig B")]), [w1], [busy]).plan()
    assert moved.wells[1].gap_kind == "project_move"
    assert moved.wells[1].start_date == busy.end_date + timedelta(days=30)  # swamp rig move


def test_changed_dates_are_kept_exactly_and_marked_changed() -> None:
    w1 = act("W-1", START, 60)
    plan = plan_project_edit(
        edit([row(w1, start_date="2027-02-01", end_date="2027-05-01")]), [w1], []
    ).plan()
    assert (plan.wells[0].start_date, plan.wells[0].end_date) == (date(2027, 2, 1), date(2027, 5, 1))
    assert (plan.wells[0].gap_kind, plan.wells[0].change) == ("kept", "changed")


def test_resequence_lays_open_wells_out_again_keeping_durations() -> None:
    done = act("W-0", START - timedelta(days=200), 50, completed_at=NOW)
    w1 = act("W-1", START + timedelta(days=100), 60)
    w2 = act("W-2", START + timedelta(days=400), 30)
    plan = plan_project_edit(
        edit([row(done), row(w1), row(w2)], layout="resequence", start_date="2027-01-01"),
        [done, w1, w2],
        [],
    ).plan()
    assert plan.wells[0].gap_kind == "kept" and plan.wells[0].start_date == done.start_date
    assert plan.wells[1].start_date == START and plan.wells[1].duration_days == 60
    assert plan.wells[2].start_date == START + timedelta(days=60 + 14)
    assert plan.wells[2].duration_days == 30


def test_project_fields_apply_to_all_only_when_set() -> None:
    w1 = act("W-1", START, 60, risk="Flood Risk")
    w2 = act("W-2", START + timedelta(days=80), 60, risk="No Flood Risk")
    mixed = plan_project_edit(edit([row(w1), row(w2)]), [w1, w2], [])
    assert [w.values.risk for w in mixed.wells] == ["Flood Risk", "No Flood Risk"]
    assert not mixed.changed

    set_all = plan_project_edit(edit([row(w1), row(w2)], risk="Flood Risk"), [w1, w2], [])
    assert [w.values.risk for w in set_all.wells] == ["Flood Risk", "Flood Risk"]
    assert [w.out.change for w in set_all.wells] == ["unchanged", "changed"]


def test_completed_wells_keep_their_actuals() -> None:
    done = act("W-1", START, 60, completed_at=NOW)
    with pytest.raises(EditRefused, match="completed"):
        plan_project_edit(edit([row(done, end_date="2027-06-01")]), [done], [])
    with pytest.raises(EditRefused, match="completed"):
        plan_project_edit(
            edit([new_row("W-2")], removed=[{"id": str(done.id), "expected_updated_at": NOW.isoformat()}]),
            [done],
            [],
        )
    # Project-level details (here a rename) still apply to it.
    renamed = plan_project_edit(edit([row(done)], new_name="Bonga 4B"), [done], [])
    assert renamed.wells[0].changes == {"well_project": (PROJECT, "Bonga 4B")}


def test_a_new_well_needs_the_project_details() -> None:
    w1 = act("W-1", START, 60, location=None)
    with pytest.raises(EditRefused, match="location"):
        plan_project_edit(edit([row(w1), new_row("W-2")]), [w1], [])
    ok = plan_project_edit(edit([row(w1), new_row("W-2")], location="LAND"), [w1], [])
    assert ok.wells[1].values.location == "LAND"


# ── The endpoint ────────────────────────────────────────────────────────────


async def _campaign(client: AsyncClient) -> str:
    return (await client.post("/api/projects", json={"name": "Edit Project Test"})).json()["id"]


async def _seed(client: AsyncClient, pid: str) -> list[dict]:
    """Bonga Phase 4 with three wells (two on Rig A, one on Rig B) plus another project."""
    body = {
        "well_project": PROJECT,
        "start_date": "2027-01-01",
        "location": "SWAMP",
        "plan_type": "Firm",
        "risk": "No Flood Risk",
        "market": "Oil",
        "dry_run": False,
        "wells": [
            {"well_name": "B4-1", "activity_type": "Oil Development", "resource_type": "rig",
             "resource_name": "Rig A", "duration_months": 2.5},
            {"well_name": "B4-2", "activity_type": "Gas Development", "resource_type": "rig",
             "resource_name": "Rig B", "duration_months": 3},
            {"well_name": "B4-3", "activity_type": "Oil Development", "resource_type": "rig",
             "resource_name": "Rig A", "duration_months": 2},
        ],
    }
    url = f"/api/projects/{pid}/activities/project-wells"
    assert (await client.post(url, json=body)).status_code == 200
    other = {**body, "well_project": "Egina North", "start_date": "2028-01-01",
             "wells": [{**body["wells"][0], "well_name": "EG-1", "resource_name": "Rig C"}]}
    assert (await client.post(url, json=other)).status_code == 200
    return await _wells(client, pid)


async def _wells(client: AsyncClient, pid: str, project: str = PROJECT) -> list[dict]:
    acts = (await client.get(f"/api/projects/{pid}/activities")).json()
    return sorted(
        (a for a in acts if a["well_project"] == project), key=lambda a: (a["start_date"], a["well_name"])
    )


def _row(a: dict, **over) -> dict:
    return {
        "id": a["id"],
        "expected_updated_at": a["updated_at"],
        "well_name": a["well_name"],
        "activity_type": a["activity_type"],
        "resource_type": "rig" if a["rig_name"] else ("hwu" if a["hwu_name"] else "none"),
        "resource_name": a["rig_name"] or a["hwu_name"],
        "start_date": a["start_date"],
        "end_date": a["end_date"],
        **over,
    }


def _removed(a: dict) -> dict:
    return {"id": a["id"], "expected_updated_at": a["updated_at"]}


async def _put(client: AsyncClient, pid: str, body: dict):
    return await client.put(f"/api/projects/{pid}/activities/project-wells", json=body)


@pytest.mark.asyncio
async def test_dry_run_previews_without_writing(client: AsyncClient, db: AsyncSession) -> None:
    pid = await _campaign(client)
    wells = await _seed(client, pid)
    body = {
        "well_project": PROJECT,
        "new_name": "Bonga Phase 4B",
        "wells": [*(_row(w) for w in wells), new_row("B4-4")],
    }
    r = await _put(client, pid, body)
    assert r.status_code == 200, r.text
    plan = r.json()
    assert plan["saved"] is False and plan["well_project"] == "Bonga Phase 4B"
    assert [w["change"] for w in plan["wells"]] == ["changed", "changed", "changed", "new"]
    assert await _wells(client, pid) == wells  # nothing written
    assert (
        await db.execute(select(AuditLog).where(AuditLog.field == "project_wells_updated"))
    ).first() is None


@pytest.mark.asyncio
async def test_save_changes_adds_and_removes_in_one_go(client: AsyncClient, db: AsyncSession) -> None:
    pid = await _campaign(client)
    b1, b2, b3 = await _seed(client, pid)
    body = {
        "well_project": PROJECT,
        "plan_type": "Option",
        "wells": [
            _row(b1, well_name="B4-1A", end_date="2027-04-01"),
            _row(b3),
            new_row("B4-4", "Rig A", 1),
        ],
        "removed": [_removed(b2)],
        "dry_run": False,
    }
    r = await _put(client, pid, body)
    assert r.status_code == 200, r.text
    plan = r.json()
    assert plan["saved"] is True
    assert plan["removed"] == [{"id": b2["id"], "well_name": "B4-2", "activity_type": "Gas Development"}]
    assert all(w["id"] for w in plan["wells"])  # the new well's id comes back

    after = await _wells(client, pid)
    assert [(a["well_name"], a["plan_type"]) for a in after] == [
        ("B4-1A", "Option"), ("B4-3", "Option"), ("B4-4", "Option")
    ]
    assert after[0]["end_date"] == "2027-04-01"
    assert after[1]["start_date"] == b3["start_date"]  # untouched dates stay
    # The new well chains after B4-3 on Rig A (2 weeks), inheriting the project's details.
    assert after[2]["start_date"] == str(date.fromisoformat(b3["end_date"]) + timedelta(days=14))
    assert (after[2]["location"], after[2]["risk"], after[2]["market"]) == ("SWAMP", "No Flood Risk", "Oil")
    # The other project is untouched.
    assert [a["well_name"] for a in await _wells(client, pid, "Egina North")] == ["EG-1"]

    # Per-field history on the changed well, and one summary on the campaign's record.
    fields = set(
        (await db.execute(
            select(AuditLog.field).where(AuditLog.entity_id == uuid.UUID(b1["id"]))
        )).scalars()
    )
    assert {"well_name", "end_date", "plan_type"} <= fields
    event = (
        await db.execute(select(AuditLog).where(AuditLog.field == "project_wells_updated"))
    ).scalar_one()
    assert event.new_value == (
        f"Edited {PROJECT}: 2 well(s) changed; 1 added; 1 removed (B4-2)"
    )


@pytest.mark.asyncio
async def test_rename_takes_the_readiness_along(client: AsyncClient, db: AsyncSession) -> None:
    pid = await _campaign(client)
    wells = await _seed(client, pid)
    assert (
        await client.put(f"/api/projects/{pid}/readiness/FID", json={"well_project": PROJECT, "status": "Behind"})
    ).status_code == 200

    r = await _put(client, pid, {
        "well_project": PROJECT, "new_name": "Bonga Phase 4B",
        "wells": [_row(w) for w in wells], "dry_run": False,
    })
    assert r.status_code == 200, r.text
    rows = {x["well_project"]: x for x in (await client.get(f"/api/projects/{pid}/readiness")).json()}
    assert PROJECT not in rows
    assert rows["Bonga Phase 4B"]["checks"]["FID"]["status"] == "Behind"
    assert (
        await db.execute(select(AuditLog).where(AuditLog.field == "readiness_rekeyed"))
    ).scalars().first() is not None


@pytest.mark.asyncio
async def test_rename_onto_another_project_is_refused(client: AsyncClient) -> None:
    pid = await _campaign(client)
    wells = await _seed(client, pid)
    for name in ("Egina North", "egina north"):
        r = await _put(client, pid, {
            "well_project": PROJECT, "new_name": name, "wells": [_row(w) for w in wells], "dry_run": False,
        })
        assert r.status_code == 409, r.text
    # A case-only rename of the project itself is fine.
    r = await _put(client, pid, {
        "well_project": PROJECT, "new_name": PROJECT.upper(), "wells": [_row(w) for w in wells], "dry_run": False,
    })
    assert r.status_code == 200, r.text


@pytest.mark.asyncio
async def test_a_stale_or_incomplete_request_is_refused(
    client: AsyncClient, db: AsyncSession
) -> None:
    pid = await _campaign(client)
    b1, b2, b3 = await _seed(client, pid)
    egina = (await _wells(client, pid, "Egina North"))[0]
    url_body = {"well_project": PROJECT, "dry_run": False}

    # The dialog loaded B4-2 an hour before someone else's edit.
    loaded = (datetime.fromisoformat(b2["updated_at"]) - timedelta(hours=1)).isoformat()
    r = await _put(
        client, pid, {**url_body, "wells": [_row(b1), _row(b2, expected_updated_at=loaded), _row(b3)]}
    )
    assert r.status_code == 409 and "after you opened the project" in r.json()["detail"]["message"]

    # A well is missing from the request (e.g. added to the project meanwhile).
    r = await _put(client, pid, {**url_body, "wells": [_row(b1), _row(b2)]})
    assert r.status_code == 409
    # A well from another project can't be pulled in.
    r = await _put(client, pid, {**url_body, "wells": [_row(b1), _row(b2), _row(b3), _row(egina)]})
    assert r.status_code == 409
    # An unknown project.
    r = await _put(client, pid, {**url_body, "well_project": "Nope", "wells": [_row(b1)]})
    assert r.status_code == 404
    # None of it wrote anything.
    assert (
        await db.execute(select(AuditLog).where(AuditLog.field == "project_wells_updated"))
    ).first() is None


@pytest.mark.asyncio
async def test_completed_wells_are_refused_atomically(client: AsyncClient) -> None:
    pid = await _campaign(client)
    b1, b2, b3 = await _seed(client, pid)
    b1 = (await client.post(f"/api/projects/{pid}/activities/{b1['id']}/complete")).json()
    r = await _put(client, pid, {
        "well_project": PROJECT,
        "new_name": "Renamed",
        "wells": [_row(b1, start_date="2026-12-01"), _row(b2), _row(b3)],
        "dry_run": False,
    })
    assert r.status_code == 422 and "completed" in r.json()["detail"]
    assert [a["well_name"] for a in await _wells(client, pid)] == ["B4-1", "B4-2", "B4-3"]


@pytest.mark.asyncio
async def test_an_unchanged_save_writes_nothing(client: AsyncClient, db: AsyncSession) -> None:
    pid = await _campaign(client)
    wells = await _seed(client, pid)
    r = await _put(client, pid, {"well_project": PROJECT, "wells": [_row(w) for w in wells], "dry_run": False})
    assert r.status_code == 200 and r.json()["saved"] is True
    assert await _wells(client, pid) == wells
    assert (
        await db.execute(select(AuditLog).where(AuditLog.field == "project_wells_updated"))
    ).first() is None


@pytest.mark.asyncio
async def test_only_planners_and_not_while_locked(
    client: AsyncClient, other_client: AsyncClient, noplan_client: AsyncClient, db: AsyncSession
) -> None:
    pid = await _campaign(client)
    wells = await _seed(client, pid)
    body = {"well_project": PROJECT, "wells": [_row(w) for w in wells]}

    # Not a member at all.
    assert (await _put(noplan_client, pid, body)).status_code == 403
    # A viewer member can read the project but not edit it.
    await other_client.get("/api/projects")
    other = (await db.execute(select(User).where(User.email == "other@company.com"))).scalar_one()
    db.add(ProjectMember(project_id=uuid.UUID(pid), user_id=other.id, role=ProjectRole.viewer))
    await db.commit()
    assert (await other_client.get(f"/api/projects/{pid}/activities")).status_code == 200
    assert (await _put(other_client, pid, body)).status_code == 403

    # Locked while a revision is pending.
    assert (await client.post(f"/api/projects/{pid}/revisions", json={})).status_code in (200, 201)
    assert (await _put(client, pid, body)).status_code == 423


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "mutate",
    [
        lambda b: b.update(layout="resequence"),  # re-sequence needs a start date
        lambda b: b.update(location=None),  # required details can't be cleared
        lambda b: b.update(readiness_required=None),
        lambda b: b.update(location="MOON"),
        lambda b: b["wells"].append(dict(b["wells"][0])),  # the same well twice
        lambda b: b["wells"][0].pop("expected_updated_at"),  # existing wells say what they edited
        lambda b: b["wells"][0].update(end_date="2020-01-01"),  # ends before it starts
        lambda b: b["wells"].append(new_row("NEW", start_date="2027-01-01")),  # new wells get no dates
        lambda b: b["wells"].append(new_row("NEW", months=0)),
        lambda b: b.update(wells=[]),
        lambda b: b.update(new_name="  "),
        lambda b: b.update(sneaky=True),  # unknown fields are refused
    ],
)
async def test_validation(client: AsyncClient, mutate) -> None:
    pid = await _campaign(client)
    wells = await _seed(client, pid)
    body = {"well_project": PROJECT, "wells": [_row(w) for w in wells]}
    mutate(body)
    r = await _put(client, pid, body)
    assert r.status_code == 422, r.text


# ── Review fixes: exact versions, shared keys, replacing every well ─────────


def test_wells_that_already_share_a_key_keep_it_but_no_new_duplicates() -> None:
    # Two activities of one well + activity already exist (e.g. two campaigns'
    # worth of the same job) — they may be renamed with the project...
    w1 = act("W-1", START, 30)
    w1b = act("W-1", START + timedelta(days=200), 30)
    ok = plan_project_edit(edit([row(w1), row(w1b)], new_name="Bonga 4B"), [w1, w1b], [])
    assert [w.out.change for w in ok.wells] == ["changed", "changed"]

    # ...but an edit may not introduce another one: a new row...
    with pytest.raises(EditRefused, match="listed twice"):
        plan_project_edit(edit([row(w1), row(w1b), new_row("W-1")]), [w1, w1b], [])
    # ...or another well renamed onto the key.
    w2 = act("W-2", START + timedelta(days=400), 30)
    with pytest.raises(EditRefused, match="listed twice"):
        plan_project_edit(
            edit([row(w1), row(w1b), row(w2, well_name="W-1")]), [w1, w1b, w2], []
        )


def test_replacing_every_well_keeps_the_projects_details_and_start() -> None:
    w1 = act("W-1", START, 30, location="LAND", risk="Flood Risk", market="Domestic Gas")
    gone = {"id": str(w1.id), "expected_updated_at": NOW.isoformat()}
    plan = plan_project_edit(edit([new_row("N-1", "Rig Z")], removed=[gone]), [w1], [])
    new = plan.wells[0]
    assert (new.values.location, new.values.risk, new.values.market) == (
        "LAND", "Flood Risk", "Domestic Gas"
    )
    assert new.out.start_date == START  # the original project's start


@pytest.mark.asyncio
async def test_a_version_even_a_moment_old_is_a_conflict(client: AsyncClient) -> None:
    pid = await _campaign(client)
    b1, b2, b3 = await _seed(client, pid)
    loaded = (datetime.fromisoformat(b1["updated_at"]) - timedelta(milliseconds=500)).isoformat()
    r = await _put(client, pid, {
        "well_project": PROJECT, "dry_run": False,
        "wells": [_row(b1, expected_updated_at=loaded), _row(b2), _row(b3)],
    })
    assert r.status_code == 409, r.text


@pytest.mark.asyncio
async def test_shared_keys_and_replacing_every_well_through_the_api(client: AsyncClient) -> None:
    pid = await _campaign(client)
    b1, b2, b3 = await _seed(client, pid)
    # B4-1 gets a second activity of the same type in the project.
    twin = await client.post(f"/api/projects/{pid}/activities", json={
        "activity_type": b1["activity_type"], "start_date": "2029-01-01", "end_date": "2029-02-01",
        "well_name": "B4-1", "rig_name": "Rig A", "location": "SWAMP", "plan_type": "Firm",
        "risk": "No Flood Risk", "well_project": PROJECT,
    })
    assert twin.status_code == 201
    wells = await _wells(client, pid)

    # A plain rename of the whole project is fine.
    r = await _put(client, pid, {
        "well_project": PROJECT, "new_name": "Bonga 4B", "dry_run": False,
        "wells": [_row(w) for w in wells],
    })
    assert r.status_code == 200, r.text

    # Replace every well with a new one: it inherits the project's details.
    wells = await _wells(client, pid, "Bonga 4B")
    r = await _put(client, pid, {
        "well_project": "Bonga 4B", "dry_run": False,
        "wells": [new_row("N-1", "Rig Q", 1)],
        "removed": [_removed(w) for w in wells],
    })
    assert r.status_code == 200, r.text
    (new,) = await _wells(client, pid, "Bonga 4B")
    assert (new["well_name"], new["location"], new["plan_type"], new["market"]) == (
        "N-1", "SWAMP", "Firm", "Oil"
    )
    assert new["start_date"] == "2027-01-01"
