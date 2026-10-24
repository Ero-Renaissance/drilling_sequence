"""Equipment checks in the catalog (phase 7 of docs/readiness-framework-spec.md,
§3.9, §4.5, §5.1 "Catalog (phase 7)").

Checks gain an optional, admin-editable ``category`` and a "starts unticked"
setting (``applies_by_default``) fixed at creation. A check that locks with the
plan (a Project gate) takes neither: it has no tick list and keeps its icon.
Both fields are frozen into a revision's catalog. Migration 039 seeds the 21
equipment types; on the SQLite schema they come from tests/readiness_seed.py.
"""
import json
import uuid

import pytest
from httpx import AsyncClient, Response
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit import AuditLog
from app.models.readiness import ReadinessCheck
from app.models.revision import Revision
from app.models.user import User
from app.services.readiness_catalog import builtin_definitions, definition
from tests.readiness_seed import (
    EQUIPMENT_CATEGORIES,
    EQUIPMENT_CODES,
    equipment_definitions,
    migration_039,
    seed_core_logistics_checks,
    seed_equipment_checks,
)

GATES = ["FDP", "LLI", "LOC", "FE", "FID", "EIA", "BUD"]
CHECK = {
    "code": "SWB",
    "label": "Swamp Buggy",
    "team_code": "logistics",
    "applies_project": True,
    "applies_well": True,
    "status_set": "standard",
    "icon_key": "tractor",
    "locks_with_plan": False,
    "sort_order": 400,
}
GATE = {
    **CHECK,
    "code": "PRM",
    "label": "Permits",
    "team_code": "projects",
    "applies_well": False,
    "locks_with_plan": True,
    "icon_key": "stamp",
}


async def _make_admin(client: AsyncClient, db: AsyncSession) -> User:
    await client.get("/api/projects")  # the auth dependency materialises the user
    me = (await db.execute(select(User).where(User.email == "test@company.com"))).scalar_one()
    me.is_admin = True
    await db.commit()
    return me


async def _catalog_events(db: AsyncSession, action: str) -> list[AuditLog]:
    return list(
        (
            await db.execute(
                select(AuditLog)
                .where(AuditLog.entity_type == "readiness_catalog", AuditLog.field == action)
                .order_by(AuditLog.timestamp)
            )
        )
        .scalars()
        .all()
    )


async def _campaign_with_activity(client: AsyncClient) -> str:
    project = (await client.post("/api/projects", json={"name": "Equipment Catalog"})).json()
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


# ── Reading the catalog ─────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_catalogs_serve_category_and_starts_unticked(
    client: AsyncClient, db: AsyncSession
) -> None:
    await seed_core_logistics_checks(db)
    added = await seed_equipment_checks(db)
    assert [c.code for c in added] == EQUIPMENT_CODES

    body = (await client.get("/api/readiness/catalog")).json()
    by_code = {c["code"]: c for c in body["checks"]}
    # Logistics: 6 core checks + 21 equipment types (spec §3.9).
    assert [c["code"] for c in body["checks"] if c["team_code"] == "logistics"] == [
        "L-BUD", "CTR", "FFP", "CTS", "PO", "NAV", *EQUIPMENT_CODES,
    ]  # fmt: skip
    for code in EQUIPMENT_CODES:
        assert by_code[code]["category"] == EQUIPMENT_CATEGORIES[code]
        assert by_code[code]["applies_by_default"] is False
    assert by_code["PSV"]["label"] == "Platform Support Vessel"
    assert by_code["PSV"]["icon_key"] == "anchor"
    for code in [*GATES, "L-BUD", "NAV"]:
        assert by_code[code]["category"] == ""
        assert by_code[code]["applies_by_default"] is True

    await _make_admin(client, db)
    admin = (await client.get("/api/admin/readiness/catalog")).json()
    admin_by_code = {c["code"]: c for c in admin["checks"]}
    assert admin_by_code["CR"]["category"] == "Lifting"
    assert admin_by_code["CR"]["applies_by_default"] is False
    assert admin_by_code["FID"]["category"] == ""
    assert admin_by_code["FID"]["applies_by_default"] is True


@pytest.mark.asyncio
async def test_the_seed_helper_is_idempotent_and_takes_a_subset(db: AsyncSession) -> None:
    assert [c.code for c in await seed_equipment_checks(db, ["CR", "LBT"])] == ["LBT", "CR"]
    added = await seed_equipment_checks(db)
    assert len(added) == 19 and {c.code for c in added}.isdisjoint({"CR", "LBT"})
    assert await seed_equipment_checks(db) == []
    stored = (
        (await db.execute(select(ReadinessCheck).where(ReadinessCheck.code.in_(EQUIPMENT_CODES))))
        .scalars()
        .all()
    )
    seeded = {d["code"]: d for d in equipment_definitions()}
    assert len(stored) == 21
    for check in stored:
        assert definition(check) == seeded[check.code]


# ── Creating a check ────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_create_takes_a_category_and_starts_unticked_and_audits_both(
    client: AsyncClient, db: AsyncSession
) -> None:
    admin = await _make_admin(client, db)
    await seed_core_logistics_checks(db)
    body = {**CHECK, "category": "  Land transport  ", "applies_by_default": False}
    resp = await client.post("/api/admin/readiness/checks", json=body)
    assert resp.status_code == 201, resp.text
    created = resp.json()
    assert created["category"] == "Land transport"  # whitespace stripped
    assert created["applies_by_default"] is False

    (event,) = await _catalog_events(db, "readiness_check_created")
    assert event.user_id == admin.id and event.project_id is None
    assert event.new_value == (
        "Created readiness check SWB (Swamp Buggy) for team logistics; scope project+well; "
        "status set standard; stays live; category Land transport; starts unticked"
    )
    assert event.new_value.isascii()


@pytest.mark.asyncio
async def test_the_admin_detail_reads_like_the_migration_seed(
    client: AsyncClient, db: AsyncSession
) -> None:
    """Migration 039's re-upgrade finds a check that started unticked by the end
    of its created detail. The admin endpoint and the seed must write the same
    detail (the seed adding only its mark) — or a check an admin created would
    come back starting ticked."""
    await _make_admin(client, db)
    await seed_core_logistics_checks(db)
    seeded = next(d for d in equipment_definitions() if d["code"] == "PSV")
    body = {k: v for k, v in seeded.items() if k != "tag_list"} | {"code": "PSX"}
    resp = await client.post("/api/admin/readiness/checks", json=body)
    assert resp.status_code == 201, resp.text
    (event,) = await _catalog_events(db, "readiness_check_created")
    expected = migration_039().created_detail({**seeded, "code": "PSX"})
    assert expected.endswith(" - migration 039")
    assert event.new_value == expected.removesuffix(" - migration 039")
    assert event.new_value.endswith("; starts unticked")


@pytest.mark.asyncio
async def test_create_defaults_to_no_category_and_starting_ticked(
    client: AsyncClient, db: AsyncSession
) -> None:
    """An older client sends neither field: the check starts ticked with no
    category, and the detail is phase 6's, unchanged."""
    await _make_admin(client, db)
    await seed_core_logistics_checks(db)
    resp = await client.post("/api/admin/readiness/checks", json=CHECK)
    assert resp.status_code == 201, resp.text
    assert resp.json()["category"] == "" and resp.json()["applies_by_default"] is True
    stored = (
        await db.execute(select(ReadinessCheck).where(ReadinessCheck.code == "SWB"))
    ).scalar_one()
    assert stored.category == "" and stored.applies_by_default is True
    (event,) = await _catalog_events(db, "readiness_check_created")
    assert event.new_value.endswith("; stays live")


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("override", "message"),
    [
        ({"applies_by_default": False}, "can't start unticked"),
        ({"category": "Permits"}, "takes no category"),
        ({"category": "Permits", "applies_by_default": False}, "can't start unticked"),
    ],
)
async def test_a_check_that_locks_with_the_plan_takes_neither(
    client: AsyncClient, db: AsyncSession, override: dict, message: str
) -> None:
    await _make_admin(client, db)
    resp = await client.post("/api/admin/readiness/checks", json={**GATE, **override})
    assert resp.status_code == 422
    assert any(message in e["msg"] for e in resp.json()["detail"]), resp.json()
    # Refused before anything was written.
    assert (
        await db.execute(select(ReadinessCheck).where(ReadinessCheck.code == "PRM"))
    ).scalar_one_or_none() is None
    assert await _catalog_events(db, "readiness_check_created") == []
    # The same gate with neither is fine; "" is no category.
    ok = await client.post("/api/admin/readiness/checks", json={**GATE, "category": " "})
    assert ok.status_code == 201, ok.text
    assert ok.json()["category"] == "" and ok.json()["applies_by_default"] is True


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "override",
    [
        {"category": "x" * 65},
        {"category": None},
        {"category": 7},
        {"applies_by_default": "false"},
        {"applies_by_default": 0},
        {"applies_by_default": None},
    ],
)
async def test_create_validates_the_new_fields(
    client: AsyncClient, db: AsyncSession, override: dict
) -> None:
    await _make_admin(client, db)
    await seed_core_logistics_checks(db)
    resp = await client.post("/api/admin/readiness/checks", json={**CHECK, **override})
    assert resp.status_code == 422, resp.text
    assert await _catalog_events(db, "readiness_check_created") == []


# A category that would end a created detail like one that starts unticked —
# what migration 039's re-upgrade reads once the column is gone (SQL Server's
# LIKE ignores case) — or that merely holds the detail's separator.
SEMICOLON_CATEGORIES = [
    "Hire; starts unticked",
    "Hire; STARTS UNTICKED",
    "x; starts unticked - migration 039",
    "Hire;",
    " ; ",
]


def _refused_category(resp: Response) -> bool:
    return resp.status_code == 422 and any(
        e["loc"][-1] == "category" for e in resp.json()["detail"]
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("category", SEMICOLON_CATEGORIES)
async def test_create_refuses_a_category_with_a_semicolon(
    client: AsyncClient, db: AsyncSession, category: str
) -> None:
    """';' separates the parts of the created detail, and the category comes last
    when a check starts ticked: "Hire; starts unticked" would end the detail as a
    check that starts unticked does, and migration 039's re-upgrade would flip it
    to starting unticked. Refused before anything is written."""
    await _make_admin(client, db)
    await seed_core_logistics_checks(db)
    for by_default in (True, False):
        resp = await client.post(
            "/api/admin/readiness/checks",
            json={**CHECK, "category": category, "applies_by_default": by_default},
        )
        assert _refused_category(resp), resp.text
    assert (
        await db.execute(select(ReadinessCheck).where(ReadinessCheck.code == "SWB"))
    ).scalar_one_or_none() is None
    assert await _catalog_events(db, "readiness_check_created") == []
    # The same check without the ';' is fine: the refusal is the ';' alone.
    ok = await client.post(
        "/api/admin/readiness/checks", json={**CHECK, "category": category.replace(";", "")}
    )
    assert ok.status_code == 201, ok.text
    (event,) = await _catalog_events(db, "readiness_check_created")
    assert not event.new_value.lower().endswith("; starts unticked")


@pytest.mark.asyncio
@pytest.mark.parametrize("category", SEMICOLON_CATEGORIES)
async def test_an_edit_refuses_a_category_with_a_semicolon(
    client: AsyncClient, db: AsyncSession, category: str
) -> None:
    """The edit shares the create's type: a ';' is a 422 that changes nothing —
    not even a label sent beside it — and records nothing. "" still clears."""
    await _make_admin(client, db)
    await seed_equipment_checks(db, ["PSV"])
    for body in ({"category": category}, {"category": category, "label": "PSV 2"}):
        resp = await client.patch("/api/admin/readiness/checks/PSV", json=body)
        assert _refused_category(resp), resp.text
    psv = (await db.execute(select(ReadinessCheck).where(ReadinessCheck.code == "PSV"))).scalar_one()
    await db.refresh(psv)
    assert psv.category == "Vessels" and psv.label == "Platform Support Vessel"
    assert await _catalog_events(db, "readiness_check_updated") == []

    cleared = await client.patch("/api/admin/readiness/checks/PSV", json={"category": ""})
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["category"] == ""
    (event,) = await _catalog_events(db, "readiness_check_updated")
    assert event.new_value == "Updated readiness check PSV: category: Vessels -> (none)"


@pytest.mark.asyncio
async def test_only_admins_create_a_categorised_or_unticked_check(
    client: AsyncClient, noplan_client: AsyncClient, other_client: AsyncClient, db: AsyncSession
) -> None:
    await seed_core_logistics_checks(db)
    body = {**CHECK, "category": "Vessels", "applies_by_default": False}
    for denied in (noplan_client, other_client, client):  # client: not admin yet
        assert (await denied.post("/api/admin/readiness/checks", json=body)).status_code == 403
    assert (
        await db.execute(select(ReadinessCheck).where(ReadinessCheck.code == "SWB"))
    ).scalar_one_or_none() is None
    assert await _catalog_events(db, "readiness_check_created") == []


# ── Editing a check ─────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_a_category_edit_is_audited_and_starts_unticked_is_fixed(
    client: AsyncClient, db: AsyncSession
) -> None:
    admin = await _make_admin(client, db)
    await seed_equipment_checks(db, ["PSV"])

    moved = await client.patch("/api/admin/readiness/checks/PSV", json={"category": "Boats"})
    assert moved.status_code == 200, moved.text
    assert moved.json()["category"] == "Boats"
    cleared = await client.patch("/api/admin/readiness/checks/PSV", json={"category": ""})
    assert cleared.status_code == 200 and cleared.json()["category"] == ""
    # Saving what is there changes nothing and records nothing.
    same = await client.patch("/api/admin/readiness/checks/PSV", json={"category": " "})
    assert same.status_code == 200

    events = await _catalog_events(db, "readiness_check_updated")
    assert [e.new_value for e in events] == [
        "Updated readiness check PSV: category: Vessels -> Boats",
        "Updated readiness check PSV: category: Boats -> (none)",
    ]
    assert all(e.user_id == admin.id and e.project_id is None for e in events)
    assert all(e.new_value.isascii() for e in events)

    # "Starts unticked" is fixed at creation (spec §3.9): a PATCH carrying it is
    # a 422 and changes nothing — not even the fields beside it.
    for value in (True, False):
        r = await client.patch(
            "/api/admin/readiness/checks/PSV",
            json={"applies_by_default": value, "category": "Vessels"},
        )
        assert r.status_code == 422
    stored = (
        await db.execute(select(ReadinessCheck).where(ReadinessCheck.code == "PSV"))
    ).scalar_one()
    await db.refresh(stored)
    assert stored.applies_by_default is False and stored.category == ""
    assert len(await _catalog_events(db, "readiness_check_updated")) == 2

    # Category alone counts as a change to make; too long is a 422.
    assert (
        await client.patch("/api/admin/readiness/checks/PSV", json={"category": "x" * 65})
    ).status_code == 422


@pytest.mark.asyncio
async def test_a_project_gate_takes_no_category_on_edit(
    client: AsyncClient, db: AsyncSession
) -> None:
    await _make_admin(client, db)
    resp = await client.patch(
        "/api/admin/readiness/checks/FID", json={"category": "Approvals", "label": "FID 2"}
    )
    assert resp.status_code == 422
    assert resp.json()["detail"] == "A check that locks with the plan takes no category"
    fid = (await db.execute(select(ReadinessCheck).where(ReadinessCheck.code == "FID"))).scalar_one()
    await db.refresh(fid)
    assert fid.category == "" and fid.label == "Final Inv. Decision"
    assert await _catalog_events(db, "readiness_check_updated") == []
    # "" is what a gate has: sending it (a form that posts every field) is fine.
    ok = await client.patch(
        "/api/admin/readiness/checks/FID", json={"category": "", "label": "FID 2"}
    )
    assert ok.status_code == 200, ok.text
    assert ok.json()["category"] == "" and ok.json()["label"] == "FID 2"
    (event,) = await _catalog_events(db, "readiness_check_updated")
    assert event.new_value == "Updated readiness check FID: label: Final Inv. Decision -> FID 2"


@pytest.mark.asyncio
async def test_only_admins_edit_a_category(
    client: AsyncClient, noplan_client: AsyncClient, db: AsyncSession
) -> None:
    await seed_equipment_checks(db, ["PSV"])
    for denied in (noplan_client, client):  # client: not admin
        r = await denied.patch("/api/admin/readiness/checks/PSV", json={"category": "Boats"})
        assert r.status_code == 403
    psv = (await db.execute(select(ReadinessCheck).where(ReadinessCheck.code == "PSV"))).scalar_one()
    await db.refresh(psv)
    assert psv.category == "Vessels"
    assert await _catalog_events(db, "readiness_check_updated") == []


# ── Frozen into revisions ───────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_catalog_json_carries_category_and_starts_unticked(
    client: AsyncClient, db: AsyncSession
) -> None:
    pid = await _campaign_with_activity(client)
    await seed_core_logistics_checks(db)
    await seed_equipment_checks(db, ["PSV", "CR"])
    resp = await client.post(f"/api/projects/{pid}/revisions", json={})
    assert resp.status_code in (200, 201), resp.text
    rev_id = resp.json()["id"]

    stored = (
        await db.execute(select(Revision).where(Revision.id == uuid.UUID(rev_id)))
    ).scalar_one()
    frozen = {d["code"]: d for d in json.loads(stored.catalog_json)}
    assert frozen["PSV"]["category"] == "Vessels"
    assert frozen["PSV"]["applies_by_default"] is False
    assert frozen["CR"]["category"] == "Lifting"
    assert frozen["NAV"]["category"] == "" and frozen["NAV"]["applies_by_default"] is True
    assert frozen["FID"]["category"] == "" and frozen["FID"]["applies_by_default"] is True

    # A later edit doesn't change how the revision reads.
    await db.execute(update(ReadinessCheck).where(ReadinessCheck.code == "PSV").values(category="X"))
    await db.commit()
    detail = (await client.get(f"/api/projects/{pid}/revisions/{rev_id}")).json()
    served = {c["code"]: c for c in detail["readiness_catalog"]}
    assert served["PSV"]["category"] == "Vessels"
    assert served["PSV"]["applies_by_default"] is False


@pytest.mark.asyncio
async def test_catalogs_frozen_before_039_read_as_starting_ticked_with_no_category(
    client: AsyncClient, db: AsyncSession
) -> None:
    pid = await _campaign_with_activity(client)
    rev_id = (await client.post(f"/api/projects/{pid}/revisions", json={})).json()["id"]
    # A phase 6 catalog: the definitions without the two fields.
    phase6 = [
        {k: v for k, v in d.items() if k not in ("category", "applies_by_default")}
        for d in builtin_definitions()
    ]
    await db.execute(update(Revision).values(catalog_json=json.dumps(phase6)))
    await db.commit()
    served = (await client.get(f"/api/projects/{pid}/revisions/{rev_id}")).json()
    assert [c["code"] for c in served["readiness_catalog"]] == GATES
    assert all(
        c["category"] == "" and c["applies_by_default"] is True
        for c in served["readiness_catalog"]
    )

    # Pre-catalog (NULL): the built-in gates, filled the same way.
    await db.execute(update(Revision).values(catalog_json=None))
    await db.commit()
    served = (await client.get(f"/api/projects/{pid}/revisions/{rev_id}")).json()
    assert [c["code"] for c in served["readiness_catalog"]] == GATES
    assert all(
        c["category"] == "" and c["applies_by_default"] is True
        for c in served["readiness_catalog"]
    )


def test_builtin_definitions_fill_the_phase_7_fields() -> None:
    for d in builtin_definitions():
        assert d["category"] == "" and d["applies_by_default"] is True
        assert list(d)[-2:] == ["category", "applies_by_default"]
