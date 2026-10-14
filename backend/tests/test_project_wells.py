"""Add a field project with its wells (the "Add project" dialog): the layout
reuses the rig optimizer's rules — months at 30.44 days, 2 weeks between wells on
a rig, 4 weeks after every 3rd, rig-move time when the rig is still busy — and
the endpoint previews (dry_run) or creates everything in one transaction.
"""
import uuid
from datetime import date, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity
from app.models.audit import AuditLog
from app.schemas.project_wells import PlannedWellIn
from app.services.activity_types import canonicalize_activity_type
from app.services.project_planner import months_to_days, plan_conflicts, plan_project_wells

START = date(2027, 1, 1)


def well(name: str, rig: str | None = "Rig A", months: float = 2.5, kind: str = "rig", **over):
    return PlannedWellIn(
        well_name=name,
        activity_type=over.get("activity_type", "Oil Development"),
        resource_type="none" if rig is None else kind,
        resource_name=rig,
        duration_months=months,
    )


def existing(rig: str, start: date, end: date, location: str = "SWAMP", **over) -> Activity:
    return Activity(
        id=uuid.uuid4(),
        activity_type="Oil Development",
        well_name=over.get("well_name", "OLD-1"),
        rig_name=rig if over.get("kind", "rig") == "rig" else None,
        hwu_name=rig if over.get("kind") == "hwu" else None,
        location=location,
        start_date=start,
        end_date=end,
        completed_at=None,
    )


# ── The layout rules ────────────────────────────────────────────────────────


def test_months_use_the_optimizer_month_length() -> None:
    assert months_to_days(2.5) == 76
    assert months_to_days(1) == 30
    assert months_to_days(0.01) == 1  # never zero-length


def test_wells_on_one_rig_chain_with_the_optimizer_gaps() -> None:
    plan = plan_project_wells(
        start_date=START,
        location="SWAMP",
        wells=[well(f"W-{i}") for i in range(1, 6)],
        existing=[],
    )
    assert [(p.gap_kind, p.gap_before_days) for p in plan] == [
        ("none", 0),
        ("inter_well", 14),
        ("inter_well", 14),
        ("batch", 28),  # after every 3rd well, replacing the 2 weeks
        ("inter_well", 14),
    ]
    assert plan[0].start_date == START
    assert plan[0].end_date == START + timedelta(days=76)
    for prev, nxt in zip(plan, plan[1:], strict=False):
        assert nxt.start_date == prev.end_date + timedelta(days=nxt.gap_before_days)


def test_each_rig_starts_its_own_chain_on_the_start_date() -> None:
    plan = plan_project_wells(
        start_date=START,
        location="LAND",
        wells=[well("W-1", "Rig A"), well("W-2", "Rig B"), well("W-3", "Rig A"), well("W-4", None)],
        existing=[],
    )
    assert [p.start_date for p in plan[:2]] == [START, START]
    assert plan[2].gap_kind == "inter_well"  # second well on Rig A
    assert plan[3].start_date == START and plan[3].rig_name is None  # no resource


def test_a_busy_rig_starts_after_its_job_plus_the_rig_move() -> None:
    busy = existing("Rig A", date(2026, 12, 1), date(2027, 2, 1), location="SWAMP")
    plan = plan_project_wells(
        start_date=START, location="SWAMP", wells=[well("W-1")], existing=[busy]
    )
    assert plan[0].gap_kind == "project_move"
    assert plan[0].start_date == date(2027, 2, 1) + timedelta(days=30)  # swamp: 30 days

    land = plan_project_wells(
        start_date=START,
        location="LAND",
        wells=[well("W-1")],
        existing=[existing("Rig A", date(2026, 12, 1), date(2027, 2, 1), location="LAND")],
    )
    assert land[0].start_date == date(2027, 2, 1) + timedelta(days=45)  # land: 45 days


def test_rig_identity_is_terrain_plus_name_and_hwus_are_mobile() -> None:
    # A LAND "Rig A" is a different physical rig from a SWAMP "Rig A".
    other_terrain = existing("Rig A", date(2026, 12, 1), date(2027, 2, 1), location="LAND")
    plan = plan_project_wells(
        start_date=START, location="SWAMP", wells=[well("W-1")], existing=[other_terrain]
    )
    assert plan[0].start_date == START
    # An HWU is one unit across terrains, matched case-insensitively.
    hwu_busy = existing("hwu-1", date(2026, 12, 1), date(2027, 2, 1), location="LAND", kind="hwu")
    plan = plan_project_wells(
        start_date=START, location="SWAMP", wells=[well("W-1", "HWU-1", kind="hwu")], existing=[hwu_busy]
    )
    assert plan[0].gap_kind == "project_move"


def test_unavoidable_overlaps_are_reported_not_moved() -> None:
    later_job = existing("Rig A", date(2027, 3, 1), date(2027, 5, 1), well_name="LATER-1")
    plan = plan_project_wells(
        start_date=START, location="SWAMP", wells=[well("W-1")], existing=[later_job]
    )
    assert plan[0].start_date == START  # not busy ON the start date → starts then
    conflicts = plan_conflicts(plan, "SWAMP", [later_job])
    assert [(c.well_name, c.clashes_with) for c in conflicts] == [("W-1", "LATER-1")]
    assert conflicts[0].overlap_days > 0


# ── The endpoint ────────────────────────────────────────────────────────────


def _body(**over) -> dict:
    return {
        "well_project": "Bonga Phase 4",
        "start_date": "2027-01-01",
        "location": "SWAMP",
        "plan_type": "Firm",
        "risk": "No Flood Risk",
        "market": "Oil",
        "wells": [
            {"well_name": "B4-1", "activity_type": "Oil Development", "resource_type": "rig",
             "resource_name": "Rig A", "duration_months": 2.5},
            {"well_name": "B4-2", "activity_type": "Gas Development", "resource_type": "rig",
             "resource_name": "Rig B", "duration_months": 3},
            {"well_name": "B4-3", "activity_type": "Oil Development", "resource_type": "rig",
             "resource_name": "Rig A", "duration_months": 2},
        ],
        **over,
    }


async def _campaign(client: AsyncClient) -> str:
    return (await client.post("/api/projects", json={"name": "Add Project Test"})).json()["id"]


@pytest.mark.asyncio
async def test_dry_run_previews_without_creating(client: AsyncClient) -> None:
    pid = await _campaign(client)
    r = await client.post(f"/api/projects/{pid}/activities/project-wells", json=_body())
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["created"] == 0
    assert [w["start_date"] for w in body["wells"]] == ["2027-01-01", "2027-01-01", "2027-04-01"]  # 1 Jan + 76 days + 2 weeks
    assert body["wells"][2]["gap_kind"] == "inter_well"
    assert (await client.get(f"/api/projects/{pid}/activities")).json() == []


@pytest.mark.asyncio
async def test_create_adds_every_well_under_the_project(client: AsyncClient, db: AsyncSession) -> None:
    pid = await _campaign(client)
    r = await client.post(
        f"/api/projects/{pid}/activities/project-wells", json=_body(dry_run=False)
    )
    assert r.status_code == 200, r.text
    assert r.json()["created"] == 3

    acts = sorted((await client.get(f"/api/projects/{pid}/activities")).json(), key=lambda a: a["well_name"])
    assert [(a["well_name"], a["rig_name"], a["activity_type"]) for a in acts] == [
        ("B4-1", "Rig A", "Oil Development"),
        ("B4-2", "Rig B", "Gas Development"),
        ("B4-3", "Rig A", "Oil Development"),
    ]
    assert {a["well_project"] for a in acts} == {"Bonga Phase 4"}
    assert {(a["location"], a["plan_type"], a["risk"], a["market"]) for a in acts} == {
        ("SWAMP", "Firm", "No Flood Risk", "Oil")
    }
    # The new project shows up for readiness straight away.
    rows = (await client.get(f"/api/projects/{pid}/readiness")).json()
    assert [r["well_project"] for r in rows] == ["Bonga Phase 4"]
    # Both rigs are registered, and the add is on the campaign's record.
    resources = (await client.get(f"/api/projects/{pid}/resources")).json()
    assert {"Rig A", "Rig B"} <= {r["name"] for r in resources}
    event = (
        await db.execute(select(AuditLog).where(AuditLog.field == "project_wells_added"))
    ).scalar_one()
    assert event.new_value == "Added 3 well(s) for Bonga Phase 4"


@pytest.mark.asyncio
async def test_activity_types_are_canonicalised(client: AsyncClient) -> None:
    pid = await _campaign(client)
    body = _body(dry_run=False)
    body["wells"] = [{**body["wells"][0], "activity_type": "oil development"}]
    assert (await client.post(f"/api/projects/{pid}/activities/project-wells", json=body)).status_code == 200
    acts = (await client.get(f"/api/projects/{pid}/activities")).json()
    assert acts[0]["activity_type"] == (canonicalize_activity_type("oil development") or "oil development")


@pytest.mark.asyncio
async def test_only_planners_and_not_while_locked(
    client: AsyncClient, noplan_client: AsyncClient
) -> None:
    pid = await _campaign(client)
    url = f"/api/projects/{pid}/activities/project-wells"
    assert (await noplan_client.post(url, json=_body())).status_code == 403

    await client.post(url, json=_body(dry_run=False))
    assert (await client.post(f"/api/projects/{pid}/revisions", json={})).status_code in (200, 201)
    assert (await client.post(url, json=_body(well_project="Late Project"))).status_code == 423


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "mutate",
    [
        lambda b: b["wells"].append(dict(b["wells"][0])),  # same well + activity twice
        lambda b: b["wells"][0].update(resource_name=None),  # rig without a name
        lambda b: b["wells"][0].update(resource_type="none"),  # name with no resource
        lambda b: b["wells"][0].update(duration_months=0),
        lambda b: b["wells"][0].update(duration_months=40),
        lambda b: b.update(wells=[]),
        lambda b: b.update(wells=[dict(b["wells"][0], well_name=f"W{i}") for i in range(51)]),
        lambda b: b.update(location="MOON"),
        lambda b: b.update(well_project="  "),
        lambda b: b.update(sneaky=True),  # unknown fields are refused
    ],
)
async def test_validation(client: AsyncClient, mutate) -> None:
    pid = await _campaign(client)
    body = _body()
    mutate(body)
    r = await client.post(f"/api/projects/{pid}/activities/project-wells", json=body)
    assert r.status_code == 422, r.text
