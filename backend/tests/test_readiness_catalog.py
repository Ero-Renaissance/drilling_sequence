"""Readiness catalog (Phase 1 of docs/readiness-framework-spec.md).

The seven field-project gates moved from a hard-coded enum into catalog rows.
These tests pin that the move is invisible (same codes, labels, order, snapshot
shape) and that the catalog — not code — now decides which checks exist.
"""
import importlib.util
import json
import re
from datetime import date, datetime, timezone
from pathlib import Path

import pytest
from httpx import AsyncClient
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.readiness import (
    BUILTIN_CHECKS,
    BUILTIN_TEAMS,
    ICON_KEYS,
    STATUS_SETS,
    ReadinessCheck,
    ReadinessEntry,
    ReadinessTeam,
)
from app.models.revision import Revision
from app.models.user import User

SEVEN = ["FDP", "LLI", "LOC", "FE", "FID", "EIA", "BUD"]
MIGRATION_034 = (
    Path(__file__).resolve().parents[1] / "alembic" / "versions" / "034_readiness_catalog.py"
)


async def _campaign_with_activity(client: AsyncClient) -> str:
    project = (await client.post("/api/projects", json={"name": "Catalog Test"})).json()
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


async def _put_gate(client: AsyncClient, pid: str, code: str, status: str = "Completed"):
    return await client.put(
        f"/api/projects/{pid}/readiness/{code}",
        json={"well_project": "Bonga Phase 3", "status": status},
    )


async def _create_revision(client: AsyncClient, pid: str) -> str:
    r = await client.post(f"/api/projects/{pid}/revisions", json={})
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


async def _retire(db: AsyncSession, code: str) -> None:
    await db.execute(
        update(ReadinessCheck)
        .where(ReadinessCheck.code == code)
        .values(retired_at=datetime.now(timezone.utc))
    )
    await db.commit()


# ── The catalog itself ──────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_catalog_serves_the_builtin_gates(client: AsyncClient) -> None:
    body = (await client.get("/api/readiness/catalog")).json()

    assert [t["code"] for t in body["teams"]] == ["projects"]
    assert body["teams"][0]["editor_source"] == "planner"
    assert [c["code"] for c in body["checks"]] == SEVEN
    by_code = {c["code"]: c for c in body["checks"]}
    assert by_code["FID"]["label"] == "Final Inv. Decision"
    assert by_code["LLI"]["icon_key"] == "rotary-table"
    assert all(
        c["team_code"] == "projects"
        and c["applies_project"]
        and not c["applies_well"]
        and c["locks_with_plan"]
        and c["status_set"] == "standard"
        for c in body["checks"]
    )
    standard = body["status_sets"]["standard"]
    assert standard["default"] == "On Track"
    assert {s["status"]: s["severity"] for s in standard["statuses"]} == {
        "On Track": "in_progress",
        "Completed": "done",
        "Behind": "blocked",
        "N/A": "not_counted",
    }


def test_builtin_definitions_are_self_consistent() -> None:
    team_codes = {t["code"] for t in BUILTIN_TEAMS}
    for c in BUILTIN_CHECKS:
        assert c["team_code"] in team_codes
        assert c["icon_key"] in ICON_KEYS
        assert c["status_set"] in STATUS_SETS
        assert c["applies_project"] or c["applies_well"]
    assert len({c["code"] for c in BUILTIN_CHECKS}) == len(BUILTIN_CHECKS)


def test_migration_seed_matches_the_model_seed() -> None:
    """Migration 034 seeds PostgreSQL/SQL Server from its own literal copy; the
    model constants seed create_all (SQLite/tests). They must never drift."""
    spec = importlib.util.spec_from_file_location("migration_034", MIGRATION_034)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    assert [dict(t) for t in module.SEED_TEAMS] == [dict(t) for t in BUILTIN_TEAMS]
    assert module.seed_checks() == [dict(c) for c in BUILTIN_CHECKS]


@pytest.mark.asyncio
async def test_catalog_read_is_open_to_non_planners(noplan_client: AsyncClient) -> None:
    resp = await noplan_client.get("/api/readiness/catalog")
    assert resp.status_code == 200
    assert [c["code"] for c in resp.json()["checks"]] == SEVEN


# ── The catalog decides which checks exist ──────────────────────────────────


@pytest.mark.asyncio
async def test_retired_check_drops_out_but_its_entry_survives(
    client: AsyncClient, db: AsyncSession
) -> None:
    pid = await _campaign_with_activity(client)
    assert (await _put_gate(client, pid, "LOC")).status_code == 200
    await _retire(db, "LOC")

    catalog = (await client.get("/api/readiness/catalog")).json()
    assert "LOC" not in [c["code"] for c in catalog["checks"]]

    rows = (await client.get(f"/api/projects/{pid}/readiness")).json()
    assert list(rows[0]["checks"]) == [c for c in SEVEN if c != "LOC"]

    # Retired → no new writes.
    assert (await _put_gate(client, pid, "LOC")).status_code == 422

    # The snapshot's readiness block follows the catalog too.
    rev_id = await _create_revision(client, pid)
    detail = (await client.get(f"/api/projects/{pid}/revisions/{rev_id}")).json()
    snapshot = json.loads(detail["snapshot_json"])
    assert "LOC" not in snapshot[0]["readiness"]

    # Retire, never delete: the stored value is kept.
    kept = (
        await db.execute(select(ReadinessEntry).where(ReadinessEntry.check_code == "LOC"))
    ).scalar_one()
    assert kept.status == "Completed"


@pytest.mark.asyncio
async def test_unknown_check_code_is_422(client: AsyncClient) -> None:
    pid = await _campaign_with_activity(client)
    assert (await _put_gate(client, pid, "CON")).status_code == 422
    assert (await _put_gate(client, pid, "fid")).status_code == 422


@pytest.mark.asyncio
async def test_status_is_validated_against_the_checks_status_set(client: AsyncClient) -> None:
    pid = await _campaign_with_activity(client)
    assert (await _put_gate(client, pid, "FID", "Available")).status_code == 422
    assert (await _put_gate(client, pid, "FID", "")).status_code == 422
    assert (await _put_gate(client, pid, "FID", "N/A")).status_code == 200


async def _add_team_grant_check(db: AsyncSession) -> None:
    """A check owned by a team-grant team (as Logistics will be in Phase 4)."""
    db.add(
        ReadinessTeam(
            code="logistics",
            name="Logistics",
            editor_source="team_grant",
            icon_key="banknote",
            sort_order=20,
        )
    )
    await db.flush()
    db.add(
        ReadinessCheck(
            code="L-BUD",
            label="Budget Availability",
            team_code="logistics",
            applies_project=True,
            applies_well=True,
            status_set="standard",
            icon_key="banknote",
            locks_with_plan=False,
            sort_order=100,
        )
    )
    await db.commit()


@pytest.mark.asyncio
async def test_planner_cannot_write_a_team_grant_check(
    client: AsyncClient, db: AsyncSession
) -> None:
    """Default deny until team grants land (Phase 2): being a planner on the
    campaign does not open another team's checks."""
    pid = await _campaign_with_activity(client)
    await _add_team_grant_check(db)
    assert (await _put_gate(client, pid, "L-BUD")).status_code == 403


@pytest.mark.asyncio
async def test_admin_bypass_applies_to_team_grant_checks(
    client: AsyncClient, db: AsyncSession
) -> None:
    pid = await _campaign_with_activity(client)
    await _add_team_grant_check(db)
    me = (await db.execute(select(User).where(User.email == "test@company.com"))).scalar_one()
    me.is_admin = True
    await db.commit()
    assert (await _put_gate(client, pid, "L-BUD")).status_code == 200


@pytest.mark.asyncio
async def test_non_project_team_checks_stay_off_the_project_gates_grid(
    client: AsyncClient, db: AsyncSession
) -> None:
    pid = await _campaign_with_activity(client)
    await _add_team_grant_check(db)
    rows = (await client.get(f"/api/projects/{pid}/readiness")).json()
    assert list(rows[0]["checks"]) == SEVEN


@pytest.mark.asyncio
async def test_operational_check_ignores_the_plan_lock(
    client: AsyncClient, db: AsyncSession
) -> None:
    """Governed gates 423 while a revision is pending; an operational check
    (locks_with_plan=False) stays writable."""
    pid = await _campaign_with_activity(client)
    await _add_team_grant_check(db)
    me = (await db.execute(select(User).where(User.email == "test@company.com"))).scalar_one()
    me.is_admin = True
    await db.commit()
    await _create_revision(client, pid)

    assert (await _put_gate(client, pid, "FID")).status_code == 423
    assert (await _put_gate(client, pid, "L-BUD")).status_code == 200


# ── Snapshots and revisions ─────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_snapshot_readiness_shape_is_unchanged(client: AsyncClient) -> None:
    pid = await _campaign_with_activity(client)
    await _put_gate(client, pid, "FID", "Behind")
    rev_id = await _create_revision(client, pid)
    detail = (await client.get(f"/api/projects/{pid}/revisions/{rev_id}")).json()
    readiness = json.loads(detail["snapshot_json"])[0]["readiness"]
    assert list(readiness) == SEVEN
    assert readiness["FID"] == "Behind"
    assert all(readiness[c] == "On Track" for c in SEVEN if c != "FID")


@pytest.mark.asyncio
async def test_revision_freezes_its_catalog(client: AsyncClient, db: AsyncSession) -> None:
    pid = await _campaign_with_activity(client)
    rev_id = await _create_revision(client, pid)

    await db.execute(
        update(ReadinessCheck).where(ReadinessCheck.code == "LOC").values(label="Location Prep")
    )
    await db.commit()

    detail = (await client.get(f"/api/projects/{pid}/revisions/{rev_id}")).json()
    frozen = {c["code"]: c["label"] for c in detail["readiness_catalog"]}
    assert list(frozen) == SEVEN
    assert frozen["LOC"] == "Location"  # as at submit, not the live rename
    live = (await client.get("/api/readiness/catalog")).json()
    assert {c["code"]: c["label"] for c in live["checks"]}["LOC"] == "Location Prep"


@pytest.mark.asyncio
async def test_pre_catalog_revision_falls_back_to_the_builtin_gates(
    client: AsyncClient, db: AsyncSession
) -> None:
    pid = await _campaign_with_activity(client)
    rev_id = await _create_revision(client, pid)
    await db.execute(update(Revision).values(catalog_json=None))
    await db.commit()

    detail = (await client.get(f"/api/projects/{pid}/revisions/{rev_id}")).json()
    assert [c["code"] for c in detail["readiness_catalog"]] == SEVEN
    assert detail["readiness_catalog"][0]["label"] == "Field Development Plan"


def test_snapshot_kpis_use_the_frozen_gate_codes() -> None:
    from app.services.dashboard import compute_snapshot_kpis

    snapshot = [
        {
            "start_date": "2026-01-10",
            "end_date": "2026-02-10",
            "well_project": "P1",
            "readiness": {"FDP": "Completed", "NEW": "Behind"},
        }
    ]
    by_gate = compute_snapshot_kpis(snapshot, date(2026, 1, 1), gate_codes=["FDP", "NEW"]).by_gate
    assert [g.code for g in by_gate] == ["FDP", "NEW"]
    assert by_gate[1].behind == 1

    # Default (pre-catalog revisions): the built-in seven.
    legacy = compute_snapshot_kpis(snapshot, date(2026, 1, 1)).by_gate
    assert [g.code for g in legacy] == SEVEN


def test_no_is_true_boolean_filters_in_app_code() -> None:
    """``col.is_(True)`` renders ``IS 1`` on SQL Server — a syntax error the SQLite
    suite can't see (it broke the catalog endpoint on MSSQL during phase 1). Filter
    on the bare boolean column (``= 1``) or compare with ``==`` instead."""
    app_dir = Path(__file__).resolve().parents[1] / "app"
    offenders = [
        f"{path.relative_to(app_dir.parent)}:{n}"
        for path in app_dir.rglob("*.py")
        for n, line in enumerate(path.read_text().splitlines(), 1)
        if any(bad in line.split("#", 1)[0] for bad in (".is_(True)", ".is_(False)"))
    ]
    assert not offenders, "use the bare column, not .is_(True/False): " + ", ".join(offenders)


FRONTEND_SRC = Path(__file__).resolve().parents[2] / "frontend" / "src"


@pytest.mark.skipif(not FRONTEND_SRC.exists(), reason="frontend sources not present")
def test_frontend_mirrors_the_builtin_gates_and_icon_keys() -> None:
    """The frontend keeps a copy of the built-in gates (its pre-load / fallback
    catalog) and the icon registry. Both must match the backend allow-lists, or a
    check could render with the wrong label or no icon."""
    registry = (FRONTEND_SRC / "components" / "readiness" / "icon-registry.ts").read_text()
    keys_block = re.search(r"export const ICON_KEYS = \[(.*?)\] as const", registry, re.S)
    assert keys_block
    assert re.findall(r'"([a-z-]+)"', keys_block.group(1)) == list(ICON_KEYS)

    catalog = (FRONTEND_SRC / "components" / "readiness" / "catalog.tsx").read_text()
    gates = re.findall(r'gate\("([A-Z0-9-]+)", "([^"]+)", "([a-z-]+)", (\d+)\)', catalog)
    assert [(c, label, icon, int(order)) for c, label, icon, order in gates] == [
        (c["code"], c["label"], c["icon_key"], c["sort_order"]) for c in BUILTIN_CHECKS
    ]
