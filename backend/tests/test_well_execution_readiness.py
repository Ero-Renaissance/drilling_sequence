"""Well execution readiness (readiness phase 8,
docs/well-execution-readiness-spec.md Part A).

The Projects team's checks — the former Project gates — are per WELL: every well
has each one, follows its field project until it is given its own value, and
"Reset to project" drops that value. An unset check reads Not started. Who may
write is unchanged (campaign planners, admins), and the revision snapshot records
each well's value, folded per field project (worst of its wells) for the KPIs.
"""
import json
import uuid
from datetime import date, timedelta

import pytest
from httpx import AsyncClient, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit import AuditLog
from app.services.readiness_rollup import (
    rollup,
    snapshot_gate_targets,
    snapshot_readiness_scope,
)
from app.services.revision_diff import diff_snapshots

TODAY = date.today()
EIGHT = ["FDP", "FID", "BUD", "FE", "EIA", "LLI", "LOC", "WP"]
FP = "Bonga Phase 3"
PROJECT = {"scope": "project", "well_project": FP}


def _well(name: str, project: str = FP) -> dict:
    return {
        "scope": "well",
        "well_project": project,
        "well_name": name,
        "activity_type": "Oil Development",
    }


async def _campaign(client: AsyncClient, name: str = "Execution Readiness") -> str:
    r = await client.post("/api/projects", json={"name": name})
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def _activity(
    client: AsyncClient, pid: str, well: str, project: str | None = FP, days: int = 10
) -> dict:
    start = TODAY + timedelta(days=days)
    r = await client.post(
        f"/api/projects/{pid}/activities",
        json={
            "activity_type": "Oil Development",
            "start_date": start.isoformat(),
            "end_date": (start + timedelta(days=20)).isoformat(),
            "rig_name": f"R-{well}",
            "well_name": well,
            "well_project": project,
            "location": "OFFSHORE",
            "plan_type": "Firm",
            "risk": "No Flood Risk",
        },
    )
    assert r.status_code == 201, r.text
    return r.json()


async def _put(client: AsyncClient, pid: str, code: str, target: dict, status: str) -> Response:
    return await client.put(
        f"/api/projects/{pid}/readiness/{code}", json={**target, "status": status}
    )


async def _lens(client: AsyncClient, pid: str) -> dict:
    r = await client.get(f"/api/projects/{pid}/readiness/teams/projects")
    assert r.status_code == 200, r.text
    return r.json()


def _cells(lens: dict, well: str) -> dict:
    return next(r for r in lens["well_rows"] if r["well_name"] == well)["checks"]


async def _details(db: AsyncSession, pid: str, action: str) -> list[str]:
    rows = (
        await db.execute(
            select(AuditLog)
            .where(AuditLog.project_id == uuid.UUID(pid), AuditLog.field == action)
            .order_by(AuditLog.timestamp)
        )
    ).scalars()
    return [e.new_value for e in rows]


# ── Each well has every check, following its field project ──────────────────


@pytest.mark.asyncio
async def test_every_well_has_all_eight_and_an_unset_check_reads_not_started(
    client: AsyncClient,
) -> None:
    pid = await _campaign(client)
    await _activity(client, pid, "W-1")
    await _activity(client, pid, "LONE-1", project=None)
    lens = await _lens(client, pid)

    assert [c["code"] for c in lens["checks"]] == EIGHT
    for well in ("W-1", "LONE-1"):
        cells = _cells(lens, well)
        assert list(cells) == EIGHT
        assert {c["status"] for c in cells.values()} == {"Not started"}
        assert {c["source"] for c in cells.values()} == {"default"}
        # No tick list for these checks: each one always applies.
        assert all(c["applies"] for c in cells.values())
    # A well with no field project is on no field-project row.
    assert [r["well_project"] for r in lens["project_rows"]] == [FP]
    figures = lens["project_rows"][0]["figures"]
    assert (figures["counted"], figures["not_started"], figures["in_progress"]) == (8, 8, 0)


@pytest.mark.asyncio
async def test_a_well_follows_its_field_project_until_it_has_its_own_value(
    client: AsyncClient, db: AsyncSession
) -> None:
    pid = await _campaign(client)
    await _activity(client, pid, "W-1")
    await _activity(client, pid, "W-2")

    # Set on the field project: both wells follow.
    assert (await _put(client, pid, "FID", PROJECT, "On Track")).status_code == 200
    lens = await _lens(client, pid)
    for well in ("W-1", "W-2"):
        fid = _cells(lens, well)["FID"]
        assert (fid["status"], fid["source"]) == ("On Track", "project")

    # W-1 gets its own value: W-2 and the field project's own value don't move.
    assert (await _put(client, pid, "FID", _well("W-1"), "Behind")).status_code == 200
    lens = await _lens(client, pid)
    assert (_cells(lens, "W-1")["FID"]["status"], _cells(lens, "W-1")["FID"]["source"]) == (
        "Behind",
        "well",
    )
    assert _cells(lens, "W-2")["FID"]["status"] == "On Track"
    row = lens["project_rows"][0]
    assert row["checks"]["FID"]["status"] == "On Track"  # the project's OWN value
    # …but the field project's figures read the WORST of its wells: Behind.
    assert row["figures"]["behind"] == 1
    assert (row["wells_behind"], row["in_range"]) == (1, True)

    # Reset to project: W-1 follows again.
    reset = await client.post(f"/api/projects/{pid}/readiness/FID/reset", json=_well("W-1"))
    assert reset.status_code == 200, reset.text
    assert (reset.json()["status"], reset.json()["source"]) == ("On Track", "project")
    assert (await _lens(client, pid))["project_rows"][0]["figures"]["behind"] == 0

    assert await _details(db, pid, "readiness_updated") == [
        f"FID for {FP}: Not started -> On Track",
        f"FID for W-1 ({FP}, Oil Development): On Track -> Behind",
    ]
    assert await _details(db, pid, "readiness_reset") == [
        f"FID for W-1 ({FP}, Oil Development): Behind -> On Track (now follows the field project)"
    ]


@pytest.mark.asyncio
async def test_statuses_not_started_and_n_a_stay_with_these_checks(client: AsyncClient) -> None:
    pid = await _campaign(client)
    await _activity(client, pid, "W-1")
    for status in ("Not started", "On Track", "Behind", "Completed", "N/A"):
        assert (await _put(client, pid, "WP", _well("W-1"), status)).status_code == 200, status
    refused = await _put(client, pid, "WP", _well("W-1"), "Available")
    assert refused.status_code == 422
    # N/A isn't counted; the other seven still are.
    row = next(r for r in (await _lens(client, pid))["well_rows"] if r["well_name"] == "W-1")
    assert (row["figures"]["counted"], row["figures"]["na"]) == (7, 1)


@pytest.mark.asyncio
async def test_a_status_change_keeps_the_cells_note_unless_one_is_sent(
    client: AsyncClient, db: AsyncSession
) -> None:
    """A status picked from a menu sends no ``notes``: the well's note stays.
    ``notes: null`` clears it. The well row carries its value stream (Market)."""
    pid = await _campaign(client)
    await _activity(client, pid, "W-1")
    url = f"/api/projects/{pid}/readiness/FDP"

    r = await client.put(url, json={**_well("W-1"), "status": "On Track", "notes": "10k"})
    assert r.status_code == 200 and r.json()["notes"] == "10k"
    r = await client.put(url, json={**_well("W-1"), "status": "Behind"})  # no notes sent
    assert r.status_code == 200 and r.json()["notes"] == "10k"
    cell = _cells(await _lens(client, pid), "W-1")["FDP"]
    assert (cell["status"], cell["notes"]) == ("Behind", "10k")
    r = await client.put(url, json={**_well("W-1"), "status": "Behind", "notes": None})
    assert r.status_code == 200 and r.json()["notes"] is None
    too_long = await client.put(url, json={**_well("W-1"), "status": "Behind", "notes": "x" * 513})
    assert too_long.status_code == 422

    assert await _details(db, pid, "readiness_updated") == [
        f"FDP for W-1 ({FP}, Oil Development): Not started -> On Track; notes changed",
        f"FDP for W-1 ({FP}, Oil Development): On Track -> Behind",
        f"FDP for W-1 ({FP}, Oil Development): Behind -> Behind; notes changed",
    ]
    row = next(r for r in (await _lens(client, pid))["well_rows"] if r["well_name"] == "W-1")
    assert row["market"] is None  # the helper sets no Market


# ── Who may write (unchanged): planners and admins only ─────────────────────


@pytest.mark.asyncio
async def test_only_planners_write_a_wells_value(
    client: AsyncClient, noplan_client: AsyncClient
) -> None:
    pid = await _campaign(client)
    await _activity(client, pid, "W-1")
    assert (await _put(client, pid, "FID", _well("W-1"), "Completed")).status_code == 200

    # A user who isn't a planner of this campaign: refused at both levels, and on
    # reset — and nothing changes.
    assert (await _put(noplan_client, pid, "FID", _well("W-1"), "Behind")).status_code == 403
    assert (await _put(noplan_client, pid, "FID", PROJECT, "Behind")).status_code == 403
    reset = await noplan_client.post(
        f"/api/projects/{pid}/readiness/FID/reset", json=_well("W-1")
    )
    assert reset.status_code == 403
    assert _cells(await _lens(client, pid), "W-1")["FID"]["status"] == "Completed"
    # Reads stay org-wide.
    assert (await noplan_client.get(f"/api/projects/{pid}/readiness/teams/projects")).status_code == 200


@pytest.mark.asyncio
async def test_a_well_must_exist_in_this_campaign(client: AsyncClient) -> None:
    """BOLA: no readiness for a well of another campaign, or one that doesn't exist."""
    mine = await _campaign(client, "Mine")
    other = await _campaign(client, "Other")
    await _activity(client, mine, "W-1")
    await _activity(client, other, "W-9")

    assert (await _put(client, mine, "FID", _well("W-9"), "Completed")).status_code == 404
    assert (await _put(client, mine, "FID", _well("NOPE"), "Completed")).status_code == 404
    assert _cells(await _lens(client, other), "W-9")["FID"]["status"] == "Not started"


# ── The tile, the warning and the snapshot ──────────────────────────────────


@pytest.mark.asyncio
async def test_the_tile_folds_a_field_projects_wells_and_the_warning_reads_each_well(
    client: AsyncClient,
) -> None:
    pid = await _campaign(client)
    await _activity(client, pid, "W-1")
    await _activity(client, pid, "W-2")
    for code in EIGHT:
        assert (await _put(client, pid, code, PROJECT, "Completed")).status_code == 200
    d = (await client.get(f"/api/projects/{pid}/dashboard")).json()
    assert d["readiness"]["overall_pct"] == 100
    assert (d["readiness"]["ready"], d["readiness"]["focus_count"]) == (1, 1)
    assert d["watchlist"]["near_term_not_ready"] == 0

    # One well behind on one check: the field project is behind on it, and only
    # that well is flagged as starting soon and not ready.
    assert (await _put(client, pid, "WP", _well("W-2"), "Behind")).status_code == 200
    d = (await client.get(f"/api/projects/{pid}/dashboard")).json()
    assert (d["readiness"]["overall_pct"], d["readiness"]["behind_cells"]) == (88, 1)
    assert d["readiness"]["ready"] == 0
    assert d["watchlist"]["near_term_not_ready"] == 1
    wp = next(g for g in d["readiness"]["by_gate"] if g["code"] == "WP")
    assert (wp["behind"], wp["completed"]) == (1, 0)


@pytest.mark.asyncio
async def test_a_revision_records_each_wells_value(client: AsyncClient) -> None:
    pid = await _campaign(client)
    await _activity(client, pid, "W-1")
    await _activity(client, pid, "W-2", days=12)
    await _put(client, pid, "FID", PROJECT, "Completed")
    await _put(client, pid, "FID", _well("W-2"), "Behind")

    rev = await client.post(f"/api/projects/{pid}/revisions", json={})
    assert rev.status_code in (200, 201), rev.text
    detail = (await client.get(f"/api/projects/{pid}/revisions/{rev.json()['id']}")).json()
    snapshot = json.loads(detail["snapshot_json"])
    by_well = {a["well_name"]: a for a in snapshot}

    assert snapshot_readiness_scope(snapshot) == "well"
    assert by_well["W-1"]["readiness"]["FID"] == "Completed"
    assert by_well["W-2"]["readiness"]["FID"] == "Behind"
    assert by_well["W-1"]["readiness"]["WP"] == "Not started"
    # The frozen catalog carries the eight, enabled at well level.
    assert [c["code"] for c in detail["readiness_catalog"]] == EIGHT
    assert all(c["applies_well"] and c["status_set"] == "execution" for c in detail["readiness_catalog"])

    # A change after submit is live only: the revision still reads what was sent.
    assert (await _put(client, pid, "FID", _well("W-2"), "Completed")).status_code == 200
    again = (await client.get(f"/api/projects/{pid}/revisions/{rev.json()['id']}")).json()
    assert json.loads(again["snapshot_json"]) == snapshot


# ── Frozen snapshots (pure) ─────────────────────────────────────────────────


def _snap(well: str, project: str | None, start: str = "2026-03-01", **readiness: str) -> dict:
    return {
        "id": well,
        "well_name": well,
        "well_project": project,
        "activity_type": "Oil Development",
        "start_date": start,
        "end_date": start,
        "completed_at": None,
        "readiness_required": True,
        "readiness_scope": "well",
        "readiness": {c: readiness.get(c, "Completed") for c in EIGHT},
    }


def test_a_per_well_snapshot_folds_each_field_project_to_the_worst_of_its_wells() -> None:
    snapshot = [
        _snap("W-1", "P1"),
        _snap("W-2", "P1", FID="Behind", WP="Not started"),
        _snap("W-3", "P1", WP="On Track"),
        _snap("W-4", "P2"),
        _snap("LONE", None, FID="Behind"),  # no field project: on no target
    ]
    targets = snapshot_gate_targets(snapshot, EIGHT)
    assert len(targets) == 2
    p1, p2 = targets
    # Behind beats Not started beats On Track beats Completed.
    assert (p1["FID"], p1["WP"], p1["BUD"]) == ("Behind", "Not started", "Completed")
    assert set(p2.values()) == {"Completed"}
    f = rollup(targets, EIGHT)
    assert (f.targets, f.ready, f.behind, f.not_started) == (2, 1, 1, 1)

    # The window narrows which wells fold in.
    late = [_snap("W-1", "P1"), _snap("W-2", "P1", "2030-01-01", FID="Behind")]
    assert snapshot_gate_targets(late, EIGHT, date(2026, 12, 31))[0]["FID"] == "Completed"
    assert snapshot_gate_targets(late, EIGHT)[0]["FID"] == "Behind"


def test_an_unnamed_activity_speaks_for_its_project_only_when_no_named_well_does() -> None:
    """As the live rollup: named wells fold; an activity with no well name holds
    the field project's own value, which counts only where no named well is in
    scope — so it can't lower a project whose wells are all done."""
    unnamed = {**_snap("", "P1", FID="Not started"), "well_name": None}
    (p1,) = snapshot_gate_targets([_snap("W-1", "P1"), unnamed], EIGHT)
    assert set(p1.values()) == {"Completed"}
    # No named well in scope: the project's own value is all there is.
    (alone,) = snapshot_gate_targets([unnamed, dict(unnamed)], EIGHT)
    assert alone["FID"] == "Not started" and alone["BUD"] == "Completed"
    # Outside the window the named well drops out, and the fallback speaks.
    late = [_snap("W-1", "P1", "2030-01-01"), unnamed]
    assert snapshot_gate_targets(late, EIGHT, date(2026, 12, 31))[0]["FID"] == "Not started"


def test_a_snapshot_from_before_phase_8_still_reads_per_field_project() -> None:
    old = [
        {**_snap("W-1", "P1"), "readiness": {"FID": "Completed"}},
        {**_snap("W-2", "P1"), "readiness": {"FID": "Completed"}},
    ]
    for a in old:
        del a["readiness_scope"]
    assert snapshot_readiness_scope(old) == "project"
    # A gate missing from an old block reads On Track — never Not started.
    assert snapshot_gate_targets(old, ["FID", "BUD"]) == [{"FID": "Completed", "BUD": "On Track"}]


def test_compare_reports_a_wells_own_change() -> None:
    base = [_snap("W-1", "P1"), _snap("LONE", None)]
    target = [_snap("W-1", "P1", FID="Behind"), _snap("LONE", None, WP="On Track")]
    diff = diff_snapshots(base, target)
    changes = {
        a["well_name"]: [(f["field"], f["old"], f["new"]) for f in a["fields"]]
        for a in diff["activities"]
    }
    assert changes == {
        "W-1": [("Readiness: FID", "Completed", "Behind")],
        # A well with no field project carries its own checks since phase 8.
        "LONE": [("Readiness: WP", "Completed", "On Track")],
    }
