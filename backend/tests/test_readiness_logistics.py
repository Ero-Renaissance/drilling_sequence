"""Logistics readiness (Phase 4 of docs/readiness-framework-spec.md): the seeded
checks, the availability status set, Nominated Equipment tags with project → well
inheritance, live checks recorded at submission, the readiness opt-out across all
teams, and the dashboard's team tiles.

The logistics team/checks/equipment are seeded by migration 036 on PostgreSQL /
SQL Server; on the SQLite test schema they're created here through the admin API
(the same shape as the seed).
"""
import importlib.util
import json
from pathlib import Path

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit import AuditLog
from app.models.readiness import ICON_KEYS, STATUS_SETS
from app.models.user import User
from app.services.readiness_catalog import gate_codes_of

MIGRATION_036 = (
    Path(__file__).resolve().parents[1] / "alembic" / "versions" / "036_logistics_readiness.py"
)


def _migration():
    spec = importlib.util.spec_from_file_location("migration_036", MIGRATION_036)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


async def _admin(client: AsyncClient, db: AsyncSession) -> None:
    await client.get("/api/projects")
    me = (await db.execute(select(User).where(User.email == "test@company.com"))).scalar_one()
    me.is_admin = True
    await db.commit()


async def _seed_logistics(client: AsyncClient, db: AsyncSession) -> None:
    """Create what migration 036 seeds, from its own literal data."""
    m = _migration()
    await _admin(client, db)
    team = {k: v for k, v in m.LOGISTICS_TEAM.items() if k in ("code", "name", "icon_key", "sort_order")}
    assert (await client.post("/api/admin/readiness/teams", json=team)).status_code == 201
    for code, label, status_set, icon_key, tag_list, order in m.LOGISTICS_CHECKS:
        r = await client.post(
            "/api/admin/readiness/checks",
            json={
                "code": code,
                "label": label,
                "team_code": "logistics",
                "applies_project": True,
                "applies_well": True,
                "status_set": status_set,
                "icon_key": icon_key,
                "locks_with_plan": False,
                "tag_list": tag_list,
                "sort_order": order,
            },
        )
        assert r.status_code == 201, r.text
    for i, (code, label, category) in enumerate(m.EQUIPMENT):
        r = await client.post(
            "/api/admin/readiness/tags",
            json={
                "tag_list": "equipment",
                "code": code,
                "label": label,
                "category": category,
                "sort_order": (i + 1) * 10,
            },
        )
        assert r.status_code == 201, r.text


async def _campaign(client: AsyncClient) -> str:
    pid = (await client.post("/api/projects", json={"name": "Logistics Test"})).json()["id"]
    for well, start, required in (
        ("W-1", "2026-11-01", True),
        ("W-2", "2027-01-01", True),
        ("W-OPT", "2027-02-01", False),  # readiness opt-out
    ):
        r = await client.post(
            f"/api/projects/{pid}/activities",
            json={
                "activity_type": "Oil Development",
                "start_date": start,
                "end_date": "2027-06-30",
                "well_name": well,
                "rig_name": f"Rig {well}",
                "location": "SWAMP",
                "plan_type": "Firm",
                "risk": "No Flood Risk",
                "well_project": "Bonga Phase 3",
                "readiness_required": required,
            },
        )
        assert r.status_code == 201, r.text
    return pid


PROJECT = {"well_project": "Bonga Phase 3"}


def _well(name: str) -> dict:
    return {
        "scope": "well",
        "well_project": "Bonga Phase 3",
        "well_name": name,
        "activity_type": "Oil Development",
    }


async def _put(client: AsyncClient, pid: str, code: str, target: dict, status: str, **extra):
    return await client.put(
        f"/api/projects/{pid}/readiness/{code}", json={**target, "status": status, **extra}
    )


async def _lens(client: AsyncClient, pid: str) -> dict:
    r = await client.get(f"/api/projects/{pid}/readiness/teams/logistics")
    assert r.status_code == 200, r.text
    return r.json()


def _well_row(lens: dict, name: str) -> dict:
    return next(r for r in lens["well_rows"] if r["well_name"] == name)


# ── The seed (migration 036) ────────────────────────────────────────────────


def test_migration_seeds_the_confirmed_logistics_checks_and_equipment() -> None:
    m = _migration()
    assert m.LOGISTICS_TEAM["editor_source"] == "team_grant"
    assert m.LOGISTICS_TEAM["icon_key"] in ICON_KEYS
    assert [c[0] for c in m.LOGISTICS_CHECKS] == ["L-BUD", "CTR", "NEQ", "FFP", "CTS", "PO", "NAV"]
    for code, label, status_set, icon_key, tag_list, _ in m.LOGISTICS_CHECKS:
        assert status_set in STATUS_SETS and icon_key in ICON_KEYS
        assert label.isascii()  # columns may be VARCHAR on SQL Server
        assert (status_set, tag_list) == (
            ("availability", "equipment") if code == "NEQ" else ("standard", "")
        )
    codes = [e[0] for e in m.EQUIPMENT]
    assert len(codes) == 21 and len(set(codes)) == 21
    assert dict((e[0], e[2]) for e in m.EQUIPMENT)["PC"] == "Vessels"  # PC is a boat
    assert all(e[1].isascii() for e in m.EQUIPMENT)


# ── Availability status set + equipment tags ────────────────────────────────


@pytest.mark.asyncio
async def test_neq_uses_the_availability_status_set(client: AsyncClient, db: AsyncSession) -> None:
    await _seed_logistics(client, db)
    pid = await _campaign(client)
    neq = _well_row(await _lens(client, pid), "W-1")["checks"]["NEQ"]
    # Unset reads the on-track default (spec §3.7), not "Not available".
    assert (neq["status"], neq["source"]) == ("Pending", "default")
    assert (await _put(client, pid, "NEQ", PROJECT, "Completed")).status_code == 422
    assert (await _put(client, pid, "NEQ", PROJECT, "Available")).status_code == 200
    assert (await _put(client, pid, "NEQ", PROJECT, "Pending")).status_code == 200
    assert (await _put(client, pid, "NEQ", PROJECT, "Not available")).status_code == 200
    # Standard checks don't accept availability statuses.
    assert (await _put(client, pid, "PO", PROJECT, "Available")).status_code == 422


@pytest.mark.asyncio
async def test_equipment_tags_inherit_from_the_field_project(
    client: AsyncClient, db: AsyncSession
) -> None:
    await _seed_logistics(client, db)
    pid = await _campaign(client)
    assert (await _put(client, pid, "NEQ", PROJECT, "Available", tags=["RW"])).status_code == 200
    r = await _put(client, pid, "NEQ", _well("W-1"), "Not available", tags=["DSV", "DSV", "PSV"])
    assert r.status_code == 200 and r.json()["tags"] == ["DSV", "PSV"]  # de-duplicated

    lens = await _lens(client, pid)
    assert lens["project_rows"][0]["checks"]["NEQ"]["tags"] == ["RW"]
    w1 = _well_row(lens, "W-1")["checks"]["NEQ"]
    assert (w1["source"], w1["tags"], w1["inherited_tags"]) == ("well", ["DSV", "PSV"], ["RW"])
    w2 = _well_row(lens, "W-2")["checks"]["NEQ"]
    assert (w2["source"], w2["status"], w2["tags"], w2["inherited_tags"]) == (
        "project",
        "Available",
        [],
        ["RW"],
    )

    # None leaves tags alone; [] clears them.
    await _put(client, pid, "NEQ", _well("W-1"), "Available")
    assert _well_row(await _lens(client, pid), "W-1")["checks"]["NEQ"]["tags"] == ["DSV", "PSV"]
    await _put(client, pid, "NEQ", _well("W-1"), "Available", tags=[])
    assert _well_row(await _lens(client, pid), "W-1")["checks"]["NEQ"]["tags"] == []


@pytest.mark.asyncio
async def test_tag_validation(client: AsyncClient, db: AsyncSession) -> None:
    await _seed_logistics(client, db)
    pid = await _campaign(client)
    assert (await _put(client, pid, "PO", PROJECT, "Completed", tags=["RW"])).status_code == 422
    assert (await _put(client, pid, "NEQ", PROJECT, "Available", tags=["XYZ"])).status_code == 422
    assert (await _put(client, pid, "NEQ", PROJECT, "Available", tags=["rw"])).status_code == 422
    too_many = [f"T{i:02d}" for i in range(51)]
    assert (await _put(client, pid, "NEQ", PROJECT, "Available", tags=too_many)).status_code == 422


@pytest.mark.asyncio
async def test_retired_equipment_stays_on_entries_but_cannot_be_added(
    client: AsyncClient, db: AsyncSession
) -> None:
    await _seed_logistics(client, db)
    pid = await _campaign(client)
    await _put(client, pid, "NEQ", PROJECT, "Available", tags=["RW"])
    assert (await client.post("/api/admin/readiness/tags/equipment/RW/retire")).status_code == 200

    assert _well_row(await _lens(client, pid), "W-1")["checks"]["NEQ"]["inherited_tags"] == ["RW"]
    r = await _put(client, pid, "NEQ", _well("W-1"), "Available", tags=["RW"])
    assert r.status_code == 422
    public = (await client.get("/api/readiness/catalog")).json()
    assert "RW" not in [t["code"] for t in public["tag_items"]]


@pytest.mark.asyncio
async def test_tag_changes_are_audited_and_reset_drops_well_tags(
    client: AsyncClient, db: AsyncSession
) -> None:
    await _seed_logistics(client, db)
    pid = await _campaign(client)
    await _put(client, pid, "NEQ", _well("W-1"), "Available", tags=["DSV"])
    await _put(client, pid, "NEQ", _well("W-1"), "Available", tags=["PSV"])
    details = (
        await db.execute(
            select(AuditLog.new_value)
            .where(AuditLog.field == "readiness_updated")
            .order_by(AuditLog.timestamp)
        )
    ).scalars().all()
    assert details[-1].endswith("Available -> Available; tags +PSV -DSV")

    r = await client.post(f"/api/projects/{pid}/readiness/NEQ/reset", json=_well("W-1"))
    assert r.status_code == 200
    w1 = _well_row(await _lens(client, pid), "W-1")["checks"]["NEQ"]
    assert (w1["source"], w1["tags"]) == ("default", [])


@pytest.mark.asyncio
async def test_clone_carries_tags(client: AsyncClient, db: AsyncSession) -> None:
    await _seed_logistics(client, db)
    pid = await _campaign(client)
    await _put(client, pid, "NEQ", PROJECT, "Available", tags=["RW", "PSV"])
    clone = await client.post(f"/api/projects/{pid}/clone", json={"name": "Next quarter"})
    assert clone.status_code in (200, 201), clone.text
    lens = await _lens(client, clone.json()["id"])
    assert lens["project_rows"][0]["checks"]["NEQ"]["tags"] == ["RW", "PSV"]


# ── Opt-out hides every team's checks ───────────────────────────────────────


@pytest.mark.asyncio
async def test_opted_out_activity_has_no_well_row(client: AsyncClient, db: AsyncSession) -> None:
    await _seed_logistics(client, db)
    pid = await _campaign(client)
    wells = [r["well_name"] for r in (await _lens(client, pid))["well_rows"]]
    assert wells == ["W-1", "W-2"]


# ── Recorded at submission ──────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_live_checks_are_recorded_at_submission(client: AsyncClient, db: AsyncSession) -> None:
    await _seed_logistics(client, db)
    pid = await _campaign(client)
    await _put(client, pid, "NEQ", PROJECT, "Available", tags=["RW"])
    await _put(client, pid, "NEQ", _well("W-1"), "Not available", tags=["DSV"])
    rev = await client.post(f"/api/projects/{pid}/revisions", json={})
    assert rev.status_code in (200, 201), rev.text
    detail = (await client.get(f"/api/projects/{pid}/revisions/{rev.json()['id']}")).json()
    by_well = {a["well_name"]: a for a in json.loads(detail["snapshot_json"])}

    w1 = by_well["W-1"]["readiness_at_submission"]["NEQ"]
    assert w1 == {"status": "Not available", "source": "well", "tags": ["RW", "DSV"]}
    assert by_well["W-2"]["readiness_at_submission"]["NEQ"]["source"] == "project"
    assert set(by_well["W-1"]["readiness_at_submission"]) == {
        "L-BUD", "CTR", "NEQ", "FFP", "CTS", "PO", "NAV"
    }
    assert by_well["W-OPT"]["readiness_at_submission"] == {}  # opt-out
    # The governed project gates are unchanged.
    assert list(by_well["W-1"]["readiness"]) == ["FDP", "LLI", "LOC", "FE", "FID", "EIA", "BUD"]
    # The revision freezes the live checks' definitions too.
    frozen = {c["code"]: c for c in detail["readiness_catalog"]}
    assert frozen["NEQ"]["tag_list"] == "equipment" and frozen["NEQ"]["locks_with_plan"] is False
    # …but only governed gates feed the snapshot's gate KPIs.
    assert gate_codes_of(detail["readiness_catalog"]) == ["FDP", "LLI", "LOC", "FE", "FID", "EIA", "BUD"]


# ── Dashboard team tiles ────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_dashboard_has_a_logistics_tile(client: AsyncClient, db: AsyncSession) -> None:
    await _seed_logistics(client, db)
    pid = await _campaign(client)
    # Everything done for W-1 (NEQ by its availability status), nothing for W-2.
    for code in ("L-BUD", "CTR", "FFP", "CTS", "PO", "NAV"):
        await _put(client, pid, code, _well("W-1"), "Completed")
    await _put(client, pid, "NEQ", _well("W-1"), "Available")
    await _put(client, pid, "PO", _well("W-2"), "Behind")

    dash = (await client.get(f"/api/projects/{pid}/dashboard")).json()
    tile = next(t for t in dash["team_readiness"] if t["team_code"] == "logistics")
    assert tile["unit"] == "wells"
    assert tile["focus_count"] == 2  # W-OPT opted out
    assert (tile["ready"], tile["ready_of"]) == (1, 2)
    assert tile["overall_pct"] == 50  # 7 done of 14 counted
    # W-2: PO behind; its unset checks read On Track / Pending (on track).
    assert tile["behind_cells"] == 1
    assert tile["on_track_pct"] == 93  # 13 of 14


# ── Admin: equipment types ──────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_equipment_admin(
    client: AsyncClient, noplan_client: AsyncClient, db: AsyncSession
) -> None:
    await _seed_logistics(client, db)
    base = "/api/admin/readiness/tags"
    new = {"tag_list": "equipment", "code": "SWB", "label": "Swamp Buggy", "category": "Land transport"}
    assert (await noplan_client.post(base, json=new)).status_code == 403
    assert (await client.post(base, json=new)).status_code == 201
    assert (await client.post(base, json=new)).status_code == 409
    assert (await client.post(base, json={**new, "code": "swb"})).status_code == 422
    assert (await client.post(base, json={**new, "tag_list": "materials"})).status_code == 422

    r = await client.patch(f"{base}/equipment/SWB", json={"label": "Swamp Buggy (amphibious)"})
    assert r.status_code == 200 and r.json()["label"] == "Swamp Buggy (amphibious)"
    assert (await client.patch(f"{base}/equipment/SWB", json={"code": "SB"})).status_code == 422
    assert (await client.patch(f"{base}/equipment/NOPE", json={"label": "x"})).status_code == 404

    admin_cat = (await client.get("/api/admin/readiness/catalog")).json()
    assert admin_cat["tag_lists"] == ["equipment"]
    assert "SWB" in [t["code"] for t in admin_cat["tag_items"]]
    actions = (
        await db.execute(
            select(AuditLog.field).where(AuditLog.entity_type == "readiness_catalog")
        )
    ).scalars().all()
    assert "readiness_tag_created" in actions and "readiness_tag_updated" in actions
