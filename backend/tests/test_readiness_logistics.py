"""Logistics readiness (Phase 4 of docs/readiness-framework-spec.md, as changed
by phase 6): the seeded checks, live checks recorded at submission, the readiness
opt-out across all teams, and the dashboard's team tiles.

Nominated Equipment (``NEQ``) is withdrawn since phase 6 (spec §3.5): retired by
migration 038, never restored, re-created or written; its stored statuses, tags
and past revisions stay as history. These tests pin that history — the
equipment picker, the tag writes and their inheritance are gone.

The logistics team/checks are seeded by migration 036 on PostgreSQL / SQL
Server; on the SQLite test schema the six live checks are created here through
the admin API (the same shape as the seed), and NEQ — which phase 6 refuses to
create — is inserted with the ORM from migration 036's own literals.
"""
import importlib.util
import json
import uuid
from datetime import date, datetime, timezone
from pathlib import Path

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity
from app.models.audit import AuditLog
from app.models.readiness import (
    ICON_KEYS,
    STATUS_SETS,
    ReadinessApplicability,
    ReadinessCheck,
    ReadinessEntry,
    ReadinessEntryTag,
    ReadinessTagItem,
    is_withdrawn,
)
from app.models.user import User
from app.services.readiness_catalog import active_checks, gate_codes_of

MIGRATION_036 = (
    Path(__file__).resolve().parents[1] / "alembic" / "versions" / "036_logistics_readiness.py"
)
# The Logistics checks still in use once NEQ is withdrawn, in catalog order.
LIVE_CODES = ["L-BUD", "CTR", "FFP", "CTS", "PO", "NAV"]
GATES = ["FDP", "LLI", "LOC", "FE", "FID", "EIA", "BUD"]


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
    """Create the six live checks migration 036 seeds, from its own literal data.
    NEQ is withdrawn (spec §3.5): tests that need it as history call
    ``_neq_history``."""
    m = _migration()
    await _admin(client, db)
    team = {k: v for k, v in m.LOGISTICS_TEAM.items() if k in ("code", "name", "icon_key", "sort_order")}
    assert (await client.post("/api/admin/readiness/teams", json=team)).status_code == 201
    for code, label, status_set, icon_key, tag_list, order in m.LOGISTICS_CHECKS:
        if is_withdrawn(ReadinessCheck(status_set=status_set, tag_list=tag_list)):
            continue
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
                "sort_order": order,
            },
        )
        assert r.status_code == 201, r.text


async def _neq_history(db: AsyncSession, pid: str | None = None, *, retired: bool = True) -> None:
    """NEQ as migration 038 leaves it — retired and withdrawn — with its 21
    equipment types; and, for a campaign, what it recorded before phase 6: a
    field-project status with equipment tags, a well override, and a choice row
    (no such row can be written; it stands in for any dead data). From migration
    036's literals, with the ORM: phase 6 refuses to create it. ``retired=False``
    is a database where 038 hasn't run."""
    m = _migration()
    code, label, status_set, icon_key, tag_list, order = next(
        c for c in m.LOGISTICS_CHECKS if c[0] == "NEQ"
    )
    db.add(
        ReadinessCheck(
            code=code,
            label=label,
            team_code="logistics",
            applies_project=True,
            applies_well=True,
            status_set=status_set,
            icon_key=icon_key,
            locks_with_plan=False,
            tag_list=tag_list,
            sort_order=order,
            retired_at=datetime.now(timezone.utc) if retired else None,
        )
    )
    db.add_all(
        ReadinessTagItem(
            tag_list=tag_list, code=item, label=item_label, category=category, sort_order=i
        )
        for i, (item, item_label, category) in enumerate(m.EQUIPMENT)
    )
    await db.flush()
    if pid is not None:
        campaign = uuid.UUID(pid)
        entry = ReadinessEntry(
            project_id=campaign,
            check_code="NEQ",
            scope="project",
            well_project="Bonga Phase 3",
            status="Available",
        )
        db.add_all(
            [
                entry,
                ReadinessEntry(
                    project_id=campaign,
                    check_code="NEQ",
                    scope="well",
                    well_project="Bonga Phase 3",
                    well_name="W-1",
                    activity_type="Oil Development",
                    status="Not available",
                ),
                ReadinessApplicability(
                    project_id=campaign,
                    check_code="NEQ",
                    scope="well",
                    well_project="Bonga Phase 3",
                    well_name="W-2",
                    activity_type="Oil Development",
                    applies=False,
                ),
            ]
        )
        await db.flush()
        db.add_all(ReadinessEntryTag(entry_id=entry.id, item_code=t) for t in ("RW", "DSV"))
    await db.commit()


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


# ── Nominated Equipment: withdrawn, kept as history (spec §3.5) ────────────


async def _neq_tags(db: AsyncSession, pid: str) -> list[str]:
    return sorted(
        (
            await db.execute(
                select(ReadinessEntryTag.item_code)
                .join(ReadinessEntry, ReadinessEntry.id == ReadinessEntryTag.entry_id)
                .where(ReadinessEntry.project_id == uuid.UUID(pid))
            )
        ).scalars()
    )


@pytest.mark.asyncio
async def test_withdrawn_neq_leaves_every_view_but_its_history_stays(
    client: AsyncClient, db: AsyncSession
) -> None:
    await _seed_logistics(client, db)
    pid = await _campaign(client)
    await _neq_history(db, pid)

    catalog = (await client.get("/api/readiness/catalog")).json()
    assert [c["code"] for c in catalog["checks"] if c["team_code"] == "logistics"] == LIVE_CODES
    lens = await _lens(client, pid)
    assert [c["code"] for c in lens["checks"]] == LIVE_CODES
    assert list(_well_row(lens, "W-1")["checks"]) == LIVE_CODES
    assert list(lens["project_rows"][0]["checks"]) == LIVE_CODES
    # Six checks per target: NEQ's stored values reach no figure.
    assert _well_row(lens, "W-1")["figures"]["counted"] == 6
    # Never written again.
    assert (await _put(client, pid, "NEQ", PROJECT, "Pending")).status_code == 422
    # Its statuses and equipment stay in the database, as recorded.
    stored = (
        await db.execute(select(ReadinessEntry.status).where(ReadinessEntry.check_code == "NEQ"))
    ).scalars().all()
    assert sorted(stored) == ["Available", "Not available"]
    assert await _neq_tags(db, pid) == ["DSV", "RW"]


@pytest.mark.asyncio
async def test_a_withdrawn_check_behaves_as_retired_even_where_038_has_not_run(
    client: AsyncClient, db: AsyncSession
) -> None:
    """Withdrawn is a rule in code (a history-only status set or a tag list), not
    a column: an NEQ still active — 038 retires it — is never in use."""
    await _seed_logistics(client, db)
    pid = await _campaign(client)
    await _neq_history(db, pid, retired=False)

    assert "NEQ" not in [c.code for c in await active_checks(db)]
    catalog = (await client.get("/api/readiness/catalog")).json()
    assert "NEQ" not in [c["code"] for c in catalog["checks"]]
    assert "NEQ" not in _well_row(await _lens(client, pid), "W-1")["checks"]
    assert (await _put(client, pid, "NEQ", PROJECT, "Available")).status_code == 422
    reset = await client.post(f"/api/projects/{pid}/readiness/NEQ/reset", json=_well("W-1"))
    assert reset.status_code == 422


@pytest.mark.asyncio
async def test_a_status_write_carries_no_tags(client: AsyncClient, db: AsyncSession) -> None:
    """``tags`` left the status PUT with Nominated Equipment: the body forbids
    unknown fields, so a client still sending them gets a 422, never a silent
    drop (spec §5.1)."""
    await _seed_logistics(client, db)
    pid = await _campaign(client)
    for tags in (["RW"], [], None):
        r = await _put(client, pid, "PO", PROJECT, "Completed", tags=tags)
        assert r.status_code == 422, tags
    r = await _put(client, pid, "PO", PROJECT, "Completed")
    assert r.status_code == 200 and "tags" not in r.json()


@pytest.mark.asyncio
async def test_neq_cannot_be_restored_or_re_created(client: AsyncClient, db: AsyncSession) -> None:
    """Withdrawn (spec §4.4): restore is refused whether or not migration 038 has
    retired it yet, and its code stays taken."""
    await _seed_logistics(client, db)
    await _neq_history(db)
    r = await client.post("/api/admin/readiness/checks/NEQ/restore")
    assert r.status_code == 409
    assert r.json()["detail"] == "This check was withdrawn and can't be restored"
    neq = (await db.execute(select(ReadinessCheck).where(ReadinessCheck.code == "NEQ"))).scalar_one()
    assert neq.retired_at is not None
    # Re-creating it — with its history-only set and tag list — is refused by
    # the schema; with a live set, by its taken code.
    base = {
        "code": "NEQ",
        "label": "Nominated Equipment",
        "team_code": "logistics",
        "applies_project": True,
        "applies_well": True,
        "icon_key": "forklift",
        "locks_with_plan": False,
    }
    for body, expected in (
        ({**base, "status_set": "availability", "tag_list": "equipment"}, 422),
        ({**base, "status_set": "availability"}, 422),
        ({**base, "status_set": "standard", "tag_list": "equipment"}, 422),
        ({**base, "status_set": "standard"}, 409),
    ):
        assert (await client.post("/api/admin/readiness/checks", json=body)).status_code == expected
    # Nothing was audited for the refusals.
    actions = (
        await db.execute(select(AuditLog.field).where(AuditLog.entity_type == "readiness_catalog"))
    ).scalars().all()
    assert "readiness_check_restored" not in actions


@pytest.mark.asyncio
async def test_an_neq_038_has_not_retired_can_still_be_retired_but_not_restored(
    client: AsyncClient, db: AsyncSession
) -> None:
    await _seed_logistics(client, db)
    await _neq_history(db, retired=False)
    assert (await client.post("/api/admin/readiness/checks/NEQ/restore")).status_code == 409
    retired = await client.post("/api/admin/readiness/checks/NEQ/retire")
    assert retired.status_code == 200 and retired.json()["withdrawn"] is True
    assert retired.json()["retired_at"] is not None


@pytest.mark.asyncio
async def test_clone_skips_withdrawn_checks(client: AsyncClient, db: AsyncSession) -> None:
    """Spec §6: a clone copies statuses and choices, but not a withdrawn check's
    entries, tags or rows — dead data stops travelling into every new campaign."""
    await _seed_logistics(client, db)
    pid = await _campaign(client)
    await _neq_history(db, pid)
    await _put(client, pid, "PO", PROJECT, "Completed")

    clone = await client.post(f"/api/projects/{pid}/clone", json={"name": "Next quarter"})
    assert clone.status_code in (200, 201), clone.text
    cid = clone.json()["id"]
    codes = (
        await db.execute(
            select(ReadinessEntry.check_code).where(ReadinessEntry.project_id == uuid.UUID(cid))
        )
    ).scalars().all()
    assert codes == ["PO"]
    rows = (
        await db.execute(
            select(ReadinessApplicability).where(
                ReadinessApplicability.project_id == uuid.UUID(cid)
            )
        )
    ).scalars().all()
    assert rows == []
    assert await _neq_tags(db, cid) == []
    # The source campaign keeps its history.
    assert await _neq_tags(db, pid) == ["DSV", "RW"]


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
    await _neq_history(db, pid)
    await _put(client, pid, "PO", PROJECT, "Completed")
    await _put(client, pid, "PO", _well("W-1"), "Behind")
    rev = await client.post(f"/api/projects/{pid}/revisions", json={})
    assert rev.status_code in (200, 201), rev.text
    detail = (await client.get(f"/api/projects/{pid}/revisions/{rev.json()['id']}")).json()
    by_well = {a["well_name"]: a for a in json.loads(detail["snapshot_json"])}

    # Effective values with their source — and no tags, in any new snapshot.
    assert by_well["W-1"]["readiness_at_submission"]["PO"] == {"status": "Behind", "source": "well"}
    assert by_well["W-2"]["readiness_at_submission"]["PO"] == {
        "status": "Completed",
        "source": "project",
    }
    # The withdrawn NEQ isn't recorded.
    assert list(by_well["W-1"]["readiness_at_submission"]) == LIVE_CODES
    assert by_well["W-OPT"]["readiness_at_submission"] == {}  # opt-out
    # The governed project gates are unchanged.
    assert list(by_well["W-1"]["readiness"]) == GATES
    # The revision freezes the live checks' definitions too (NEQ's isn't one).
    frozen = {c["code"]: c for c in detail["readiness_catalog"]}
    assert "NEQ" not in frozen
    assert frozen["PO"]["tag_list"] == "" and frozen["PO"]["locks_with_plan"] is False
    # …but only governed gates feed the snapshot's gate KPIs.
    assert gate_codes_of(detail["readiness_catalog"]) == GATES


@pytest.mark.asyncio
async def test_no_well_name_records_no_well_level_checks(
    client: AsyncClient, db: AsyncSession
) -> None:
    """Spec §3.7: well-level checks — two-level ones included — need a well name,
    in the snapshot as in the live lens (which shows no strip for such a bar)."""
    await _seed_logistics(client, db)
    pid = await _campaign(client)
    await _put(client, pid, "PO", PROJECT, "Completed")
    # No well name only arrives through import (the form requires one).
    db.add(
        Activity(
            project_id=uuid.UUID(pid),
            activity_type="Contracting",
            start_date=date(2026, 12, 1),
            end_date=date(2026, 12, 20),
            well_project="Bonga Phase 3",
            well_name=None,
        )
    )
    await db.commit()
    rev = await client.post(f"/api/projects/{pid}/revisions", json={})
    assert rev.status_code in (200, 201), rev.text
    detail = (await client.get(f"/api/projects/{pid}/revisions/{rev.json()['id']}")).json()
    rows = json.loads(detail["snapshot_json"])
    contracting = next(a for a in rows if a["activity_type"] == "Contracting")
    assert contracting["readiness_at_submission"] == {}  # every logistics check is two-level
    assert list(contracting["readiness"]) == GATES


# ── Dashboard team tiles ────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_dashboard_has_a_logistics_tile(client: AsyncClient, db: AsyncSession) -> None:
    await _seed_logistics(client, db)
    pid = await _campaign(client)
    await _neq_history(db, pid)  # withdrawn: its stored values count nowhere
    # Everything done for W-1, nothing for W-2.
    for code in LIVE_CODES:
        await _put(client, pid, code, _well("W-1"), "Completed")
    await _put(client, pid, "PO", _well("W-2"), "Behind")

    dash = (await client.get(f"/api/projects/{pid}/dashboard")).json()
    tile = next(t for t in dash["team_readiness"] if t["team_code"] == "logistics")
    assert tile["unit"] == "wells"
    assert tile["focus_count"] == 2  # W-OPT opted out
    assert (tile["ready"], tile["ready_of"]) == (1, 2)
    assert tile["overall_pct"] == 50  # 6 done of 12 counted
    # W-2: PO behind; its unset checks read On Track (on track).
    assert tile["behind_cells"] == 1
    assert tile["on_track_pct"] == 92  # 11 of 12, rounded half up


@pytest.mark.asyncio
async def test_logistics_tab_adds_up_to_its_tile(client: AsyncClient, db: AsyncSession) -> None:
    """The Logistics tab, adding up the server's per-well figures for the wells
    it shows, reads exactly what the Logistics tile reads (spec §3.7)."""
    from app.services.readiness_rollup import pct

    await _seed_logistics(client, db)
    pid = await _campaign(client)
    await _put(client, pid, "PO", PROJECT, "Completed")  # inherited by both wells
    await _put(client, pid, "NAV", _well("W-1"), "Behind")

    lens = await _lens(client, pid)
    # Field-project rows carry the window signal too.
    assert lens["project_rows"][0]["focus_start"] is not None
    figs = [r["figures"] for r in lens["well_rows"] if r["focus_start"]]
    w1 = _well_row(lens, "W-1")["figures"]
    assert (w1["done"], w1["in_progress"], w1["behind"]) == (1, 4, 1)  # unset = On Track

    tile = next(
        t
        for t in (await client.get(f"/api/projects/{pid}/dashboard?readiness_horizon_months=0")).json()[
            "team_readiness"
        ]
        if t["team_code"] == "logistics"
    )
    counted = sum(f["counted"] for f in figs)
    done = sum(f["done"] for f in figs)
    assert (len(figs), pct(done, counted), sum(f["behind"] for f in figs)) == (
        tile["focus_count"], tile["overall_pct"], tile["behind_cells"],
    )
    assert pct(done + sum(f["in_progress"] for f in figs), counted) == tile["on_track_pct"]


# ── Admin: the equipment types are gone ─────────────────────────────────────


@pytest.mark.asyncio
async def test_tag_lists_left_the_api_but_their_rows_stay(
    client: AsyncClient, db: AsyncSession
) -> None:
    """Spec §3.5, §5.1: the tag endpoints are removed, and neither catalog lists
    tag lists or their items any more; the dormant rows stay as history. The
    admin catalog still lists NEQ itself — flagged withdrawn — and the
    history-only status set, flagged so the form doesn't offer it."""
    await _seed_logistics(client, db)
    await _neq_history(db)
    new = {"tag_list": "equipment", "code": "SWB", "label": "Swamp Buggy", "category": "Land"}
    for method, path in (
        ("POST", "/api/admin/readiness/tags"),
        ("PATCH", "/api/admin/readiness/tags/equipment/RW"),
        ("POST", "/api/admin/readiness/tags/equipment/RW/retire"),
        ("POST", "/api/admin/readiness/tags/equipment/RW/restore"),
    ):
        r = await client.request(method, path, json=new)
        assert r.status_code in (404, 405), (method, path)

    public = (await client.get("/api/readiness/catalog")).json()
    assert "tag_items" not in public
    assert public["status_sets"]["availability"]["history_only"] is True
    assert public["status_sets"]["standard"]["history_only"] is False

    admin_cat = (await client.get("/api/admin/readiness/catalog")).json()
    assert "tag_lists" not in admin_cat and "tag_items" not in admin_cat
    flags = {c["code"]: c["withdrawn"] for c in admin_cat["checks"]}
    assert flags["NEQ"] is True
    assert not any(flag for code, flag in flags.items() if code != "NEQ")
    assert admin_cat["status_sets"]["availability"]["history_only"] is True

    # The 21 equipment types stay in the database, untouched.
    assert len((await db.execute(select(ReadinessTagItem))).scalars().all()) == 21
