"""Team tiles count FIELD PROJECTS (spec §3.7, 2026-10-25), as the Project gates
always have — every team with project-level checks; a team whose checks are all
well-level counts wells, as it has only the Wells view.

For a check enabled at well level, a field project reads the WORST of its wells
in scope — each well's effective value, its project's unless it has its own — so
the check is done for the field project only when it is done for every well that
needs it, and behind when any of them is behind. A project-only check, or a field
project with no well in scope, reads the project's own value. A well with no
field project is on no tile. The Readiness tab's Projects view adds up its rows'
per-window figures to exactly the tile, and each row names its wells behind on a
check enabled at well level.
"""
import uuid
from datetime import date, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity
from app.services.readiness_rollup import HORIZON_DAYS, fold_project_cells, pct, worst_status
from tests.test_readiness_logistics import _admin, _lens, _put, _seed_logistics

FP = "Bonga Phase 3"
PROJECT = {"well_project": FP}
CORE = ["L-BUD", "CTR", "FFP", "CTS", "PO", "NAV"]


def _w(name: str, project: str = FP) -> dict:
    return {"scope": "well", "well_project": project, "well_name": name, "activity_type": "Oil Development"}


async def _campaign(client: AsyncClient, wells: list[tuple[str, str | None, int]]) -> str:
    """A campaign whose wells are (well, field project, days from today)."""
    pid = (await client.post("/api/projects", json={"name": "Tiles"})).json()["id"]
    for name, project, days in wells:
        start = date.today() + timedelta(days=days)
        r = await client.post(
            f"/api/projects/{pid}/activities",
            json={
                "activity_type": "Oil Development",
                "start_date": start.isoformat(),
                "end_date": (start + timedelta(days=30)).isoformat(),
                "well_name": name,
                "rig_name": f"Rig {name}",
                "location": "SWAMP",
                "plan_type": "Firm",
                "risk": "No Flood Risk",
                "well_project": project,
            },
        )
        assert r.status_code == 201, r.text
    return pid


async def _tile(client: AsyncClient, pid: str, months: int = 0, team: str = "logistics") -> dict:
    r = await client.get(f"/api/projects/{pid}/dashboard?readiness_horizon_months={months}")
    assert r.status_code == 200, r.text
    return next(t for t in r.json()["team_readiness"] if t["team_code"] == team)


async def _check(
    client: AsyncClient, code: str, *, project: bool, well: bool, order: int, team: str = "logistics"
) -> None:
    r = await client.post(
        "/api/admin/readiness/checks",
        json={
            "code": code, "label": f"{code} label", "team_code": team,
            "applies_project": project, "applies_well": well, "status_set": "standard",
            "icon_key": "receipt", "locks_with_plan": False, "sort_order": order,
        },
    )
    assert r.status_code == 201, r.text


# ── The rule, without a database ────────────────────────────────────────────


def test_the_worst_cell_wins_by_severity_and_n_a_only_when_nothing_counts() -> None:
    assert worst_status(["Completed", "On Track"]) == "On Track"
    assert worst_status(["Completed", "Behind", "On Track"]) == "Behind"
    assert worst_status(["N/A", "Completed"]) == "Completed"
    assert worst_status(["N/A"]) == "N/A"


def test_fold_reads_the_wells_for_well_level_checks_and_the_project_for_the_rest() -> None:
    # A: two-level · P: project-only · W: well-only.
    own = {"A": "Behind", "P": "Completed"}
    wells = [{"A": "Completed", "W": "On Track"}, {"A": "Completed"}]
    # A reads its wells (the project's own Behind reaches none of them).
    assert fold_project_cells(["A", "P", "W"], own, wells, ["A", "W"]) == {
        "A": "Completed",
        "P": "Completed",
        "W": "On Track",
    }
    # No well in scope: the project's own cells.
    assert fold_project_cells(["A", "P", "W"], own, [], ["A", "W"]) == {"A": "Behind", "P": "Completed"}
    # A check with no cell anywhere (not selected) has none; catalog order kept.
    assert list(fold_project_cells(["Z", "A"], {}, [{"A": "On Track"}], ["A", "Z"])) == ["A"]


# ── The tile ────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_a_field_project_is_done_only_when_every_well_is(client: AsyncClient, db: AsyncSession) -> None:
    await _seed_logistics(client, db)
    pid = await _campaign(client, [("W-1", FP, 30), ("W-2", FP, 60)])
    for code in CORE:
        await _put(client, pid, code, _w("W-1"), "Completed")
    t = await _tile(client, pid)
    assert (t["unit"], t["focus_count"], t["overall_pct"], t["ready"], t["ready_of"]) == ("projects", 1, 0, 0, 1)

    for code in CORE:
        await _put(client, pid, code, _w("W-2"), "Completed")
    t = await _tile(client, pid)
    assert (t["overall_pct"], t["ready"], t["behind_cells"]) == (100, 1, 0)

    # One well behind on a check → the field project is behind on it, once.
    await _put(client, pid, "PO", _w("W-2"), "Behind")
    t = await _tile(client, pid)
    assert (t["behind_cells"], t["ready"], t["overall_pct"]) == (1, 0, pct(5, 6))


@pytest.mark.asyncio
async def test_project_only_checks_read_the_project_and_well_only_ones_its_wells(
    client: AsyncClient, db: AsyncSession
) -> None:
    await _seed_logistics(client, db)
    await _check(client, "L-PRJ", project=True, well=False, order=200)
    await _check(client, "L-WEL", project=False, well=True, order=210)
    pid = await _campaign(client, [("W-1", FP, 30), ("W-2", FP, 60)])
    await _put(client, pid, "L-PRJ", PROJECT, "Completed")
    await _put(client, pid, "L-WEL", _w("W-1"), "Behind")

    lens = await _lens(client, pid)
    bonga = lens["project_rows"][0]
    # Core six On Track (unset) · L-PRJ Completed (the project's) · L-WEL Behind (W-1).
    f = bonga["figures"]
    assert (f["counted"], f["done"], f["in_progress"], f["behind"]) == (8, 1, 6, 1)
    assert bonga["figures_by_window"]["0"] == f
    t = await _tile(client, pid)
    assert (t["focus_count"], t["overall_pct"], t["behind_cells"]) == (1, pct(1, 8), 1)


@pytest.mark.asyncio
async def test_only_wells_in_the_window_fold_in_and_the_tab_matches_the_tile_in_every_window(
    client: AsyncClient, db: AsyncSession
) -> None:
    await _seed_logistics(client, db)
    pid = await _campaign(
        client,
        [("W-SOON", FP, 30), ("W-LATER", FP, 300), ("E-1", "Egina", 500)],
    )
    await _put(client, pid, "PO", _w("W-LATER"), "Behind")  # its own — beyond 6 months
    await _put(client, pid, "NAV", _w("E-1", "Egina"), "Completed")

    lens = await _lens(client, pid)
    bonga = next(r for r in lens["project_rows"] if r["well_project"] == FP)
    # W-LATER starts in 300 days: not in the 6-month Bonga, in the 12-month one.
    assert bonga["figures_by_window"]["6"]["behind"] == 0
    assert bonga["figures_by_window"]["12"]["behind"] == 1
    assert bonga["figures"] == bonga["figures_by_window"]["0"]

    for months in (0, 6, 12, 24):
        tile = await _tile(client, pid, months)
        days = HORIZON_DAYS.get(months)
        rows = [
            r
            for r in lens["project_rows"]
            if r["focus_in_days"] is not None and (days is None or r["focus_in_days"] <= days)
        ]
        figs = [r["figures_by_window"][str(months)] for r in rows]
        counted = sum(f["counted"] for f in figs)
        done = sum(f["done"] for f in figs)
        assert (len(figs), pct(done, counted), sum(f["behind"] for f in figs)) == (
            tile["focus_count"],
            tile["overall_pct"],
            tile["behind_cells"],
        ), months
        assert pct(done + sum(f["in_progress"] for f in figs), counted) == tile["on_track_pct"]
        assert sum(1 for f in figs if f["ready"]) == tile["ready"]
    # Egina's only well starts in 500 days: in the 24-month tile, not the 12.
    assert (await _tile(client, pid, 12))["focus_count"] == 1
    assert (await _tile(client, pid, 24))["focus_count"] == 2


@pytest.mark.asyncio
async def test_a_well_with_no_field_project_is_on_no_tile_and_a_project_with_no_well_reads_its_own(
    client: AsyncClient, db: AsyncSession
) -> None:
    await _seed_logistics(client, db)
    pid = await _campaign(client, [("W-1", FP, 30), ("LONE-1", None, 30)])
    # Egina's only work has no well name (only an import makes one): no well to
    # fold in, so Egina reads its own values.
    db.add(
        Activity(
            project_id=uuid.UUID(pid),
            activity_type="Contracting",
            start_date=date.today() + timedelta(days=20),
            end_date=date.today() + timedelta(days=40),
            well_project="Egina",
            well_name=None,
        )
    )
    await db.commit()
    await _put(client, pid, "PO", {"well_project": "Egina"}, "Behind")
    await _put(client, pid, "PO", _w("LONE-1", ""), "Behind")  # its own: on no tile

    t = await _tile(client, pid)
    assert (t["focus_count"], t["behind_cells"]) == (2, 1)  # Bonga, Egina — not LONE-1
    lens = await _lens(client, pid)
    egina = next(r for r in lens["project_rows"] if r["well_project"] == "Egina")
    assert (egina["figures"]["counted"], egina["figures"]["behind"]) == (6, 1)
    # LONE-1's own figures still count it — on the Wells view.
    lone = next(r for r in lens["well_rows"] if r["well_name"] == "LONE-1")
    assert lone["figures"]["behind"] == 1


@pytest.mark.asyncio
async def test_a_project_whose_wells_all_start_beyond_the_window_reads_its_own_cells_there(
    client: AsyncClient, db: AsyncSession
) -> None:
    """Egina has work in every window (no well name — only an import makes one)
    and one well, starting in 400 days: in a window that well is outside, Egina
    reads its own values; once it is inside, it folds in."""
    await _seed_logistics(client, db)
    pid = await _campaign(client, [("E-LATE", "Egina", 400)])
    db.add(
        Activity(
            project_id=uuid.UUID(pid),
            activity_type="Contracting",
            start_date=date.today() + timedelta(days=10),
            end_date=date.today() + timedelta(days=20),
            well_project="Egina",
            well_name=None,
        )
    )
    await db.commit()
    assert (await _put(client, pid, "PO", {"well_project": "Egina"}, "Behind")).status_code == 200
    assert (await _put(client, pid, "PO", _w("E-LATE", "Egina"), "Completed")).status_code == 200

    egina = (await _lens(client, pid))["project_rows"][0]
    windows = egina["figures_by_window"]
    # 6 and 12 months: Egina's own PO, Behind. 24 months and All: E-LATE's, Completed.
    assert {m: (f["done"], f["behind"]) for m, f in windows.items()} == {
        "0": (1, 0),
        "6": (0, 1),
        "12": (0, 1),
        "24": (1, 0),
    }
    for months in (0, 6, 12, 24):
        t = await _tile(client, pid, months)
        f = windows[str(months)]
        assert (t["focus_count"], t["behind_cells"], t["overall_pct"]) == (
            1,
            f["behind"],
            pct(f["done"], f["counted"]),
        ), months


@pytest.mark.asyncio
async def test_a_row_names_its_wells_behind_on_a_well_level_check_only(
    client: AsyncClient, db: AsyncSession
) -> None:
    await _seed_logistics(client, db)
    await _check(client, "L-PRJ", project=True, well=False, order=200)
    pid = await _campaign(client, [("W-1", FP, 30), ("W-2", FP, 60), ("W-3", FP, 300)])
    assert (await _put(client, pid, "L-PRJ", PROJECT, "Behind")).status_code == 200

    lens = await _lens(client, pid)
    # Every well row carries Bonga's project-only L-PRJ, Behind — but it's the
    # project's own check: Bonga is behind on it once, and no well is behind.
    assert [w["figures"]["behind"] for w in lens["well_rows"]] == [1, 1, 1]
    bonga = lens["project_rows"][0]
    assert bonga["figures"]["behind"] == 1
    assert bonga["wells_behind_by_window"] == {"0": 0, "6": 0, "12": 0, "24": 0}

    # W-3 behind on two checks of its own: one well, in the windows it is in.
    assert (await _put(client, pid, "PO", _w("W-3"), "Behind")).status_code == 200
    assert (await _put(client, pid, "NAV", _w("W-3"), "Behind")).status_code == 200
    bonga = (await _lens(client, pid))["project_rows"][0]
    assert bonga["wells_behind_by_window"] == {"0": 1, "6": 0, "12": 1, "24": 1}

    # Bonga's own Behind on a check at both levels reaches every well following it.
    assert (await _put(client, pid, "CTR", PROJECT, "Behind")).status_code == 200
    bonga = (await _lens(client, pid))["project_rows"][0]
    assert bonga["wells_behind_by_window"] == {"0": 3, "6": 2, "12": 3, "24": 3}


@pytest.mark.asyncio
async def test_a_team_whose_checks_are_all_well_level_counts_wells_as_its_grid_does(
    client: AsyncClient, db: AsyncSession
) -> None:
    """It has only the Wells view (no project rows): a field-project tile would
    match nothing on the tab, so it keeps counting wells."""
    await _admin(client, db)
    r = await client.post(
        "/api/admin/readiness/teams", json={"code": "wells", "name": "Wells", "icon_key": "drill"}
    )
    assert r.status_code == 201, r.text
    await _check(client, "WG1", project=False, well=True, order=10, team="wells")
    await _check(client, "WG2", project=False, well=True, order=20, team="wells")
    pid = await _campaign(
        client, [("W-1", FP, 30), ("W-2", FP, 60), ("W-3", FP, 90), ("E-1", "Egina", 30)]
    )
    for code in ("WG1", "WG2"):
        assert (await _put(client, pid, code, _w("W-1"), "Completed")).status_code == 200
        assert (await _put(client, pid, code, _w("E-1", "Egina"), "Completed")).status_code == 200
    assert (await _put(client, pid, "WG1", _w("W-2"), "Behind")).status_code == 200
    assert (await _put(client, pid, "WG1", _w("W-3"), "Behind")).status_code == 200

    r = await client.get(f"/api/projects/{pid}/readiness/teams/wells")
    assert r.status_code == 200, r.text
    lens = r.json()
    assert lens["project_rows"] == []
    wells = [w["figures"] for w in lens["well_rows"]]
    counted = sum(f["counted"] for f in wells)
    done = sum(f["done"] for f in wells)
    t = await _tile(client, pid, team="wells")
    # Four wells, two behind — not "2 field projects, 1 behind".
    assert (t["unit"], t["focus_count"], t["behind_cells"]) == ("wells", 4, 2)
    assert (t["overall_pct"], t["on_track_pct"]) == (
        pct(done, counted),
        pct(done + sum(f["in_progress"] for f in wells), counted),
    )
    assert (t["ready"], t["ready_of"]) == (sum(1 for f in wells if f["ready"]), 4)


@pytest.mark.asyncio
async def test_the_project_gates_tile_is_unchanged(client: AsyncClient, db: AsyncSession) -> None:
    """The gates have no well level: each field project reads its own gates."""
    await _seed_logistics(client, db)
    pid = await _campaign(client, [("W-1", FP, 30), ("W-2", FP, 60)])
    r = await client.put(f"/api/projects/{pid}/readiness/FID", json={**PROJECT, "status": "Behind"})
    assert r.status_code == 200, r.text
    d = (await client.get(f"/api/projects/{pid}/dashboard?readiness_horizon_months=0")).json()
    assert (d["readiness"]["focus_count"], d["readiness"]["behind_cells"]) == (1, 1)
