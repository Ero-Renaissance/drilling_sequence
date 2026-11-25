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
from app.services.readiness_rollup import fold_project_cells, pct, worst_status
from tests.test_readiness_logistics import _admin, _put, _seed_logistics

FP = "Bonga Phase 3"
PROJECT = {"well_project": FP}
CORE = ["L-BUD", "CTR", "FFP", "CTS", "PO", "NAV"]


def _w(name: str, project: str = FP) -> dict:
    return {"scope": "well", "well_project": project, "well_name": name, "activity_type": "Oil Development"}


# The current year: the default readiness range is YEAR .. YEAR + 2.
YEAR = date.today().year
Range = tuple[int, int]  # (first year, how many years: 1–3)


def _query(rng: Range | None, prefix: str = "") -> str:
    return "" if rng is None else f"?{prefix}from_year={rng[0]}&{prefix}years={rng[1]}"


async def _campaign(client: AsyncClient, wells: list[tuple[str, str | None, int | date]]) -> str:
    """A campaign whose wells are (well, field project, start) — a date, or days
    from today (which stay inside the default range for any offset up to a year)."""
    pid = (await client.post("/api/projects", json={"name": "Tiles"})).json()["id"]
    for name, project, when in wells:
        start = when if isinstance(when, date) else date.today() + timedelta(days=when)
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


async def _lens(client: AsyncClient, pid: str, rng: Range | None = None) -> dict:
    """The Logistics team read for a year range (None: no range — every well)."""
    r = await client.get(f"/api/projects/{pid}/readiness/teams/logistics{_query(rng)}")
    assert r.status_code == 200, r.text
    return r.json()


async def _tile(
    client: AsyncClient, pid: str, rng: Range | None = None, team: str = "logistics"
) -> dict:
    """A team's tile for a year range (None: the default, YEAR .. YEAR + 2)."""
    r = await client.get(f"/api/projects/{pid}/dashboard{_query(rng, 'readiness_')}")
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
    assert bonga["in_range"] is True
    t = await _tile(client, pid)
    assert (t["focus_count"], t["overall_pct"], t["behind_cells"]) == (1, pct(1, 8), 1)


@pytest.mark.asyncio
async def test_only_wells_in_the_year_range_fold_in_and_the_tab_matches_the_tile_in_every_range(
    client: AsyncClient, db: AsyncSession
) -> None:
    await _seed_logistics(client, db)
    pid = await _campaign(
        client,
        [
            ("W-THIS", FP, date(YEAR, 12, 1)),
            ("W-NEXT", FP, date(YEAR + 1, 3, 1)),
            ("E-1", "Egina", date(YEAR + 2, 6, 1)),
        ],
    )
    await _put(client, pid, "PO", _w("W-NEXT"), "Behind")  # its own — next year
    await _put(client, pid, "NAV", _w("E-1", "Egina"), "Completed")

    async def bonga(rng: Range | None) -> dict:
        rows = (await _lens(client, pid, rng))["project_rows"]
        return next(r for r in rows if r["well_project"] == FP)

    # W-NEXT spuds next year: not in this year's Bonga, in a range that has it.
    assert (await bonga((YEAR, 1)))["figures"]["behind"] == 0
    assert (await bonga((YEAR, 2)))["figures"]["behind"] == 1
    assert (await bonga((YEAR + 1, 1)))["figures"]["behind"] == 1
    assert (await bonga(None))["figures"]["behind"] == 1  # no range: every well
    # Out of range entirely: the server says so.
    assert (await bonga((YEAR + 2, 1)))["in_range"] is False

    for rng in ((YEAR, 1), (YEAR, 2), (YEAR, 3), (YEAR + 1, 1), (YEAR + 1, 2), (YEAR + 2, 1)):
        tile = await _tile(client, pid, rng)
        figs = [
            r["figures"] for r in (await _lens(client, pid, rng))["project_rows"] if r["in_range"]
        ]
        counted = sum(f["counted"] for f in figs)
        done = sum(f["done"] for f in figs)
        assert (len(figs), pct(done, counted), sum(f["behind"] for f in figs)) == (
            tile["focus_count"],
            tile["overall_pct"],
            tile["behind_cells"],
        ), rng
        assert pct(done + sum(f["in_progress"] for f in figs), counted) == tile["on_track_pct"]
        assert sum(1 for f in figs if f["ready"]) == tile["ready"]
    # Egina's only well spuds in the third year: in the default range, not in two.
    assert (await _tile(client, pid, (YEAR, 2)))["focus_count"] == 1
    assert (await _tile(client, pid))["focus_count"] == 2


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
async def test_a_project_whose_wells_all_start_beyond_the_range_reads_its_own_cells_there(
    client: AsyncClient, db: AsyncSession
) -> None:
    """Egina has work this year (no well name — only an import makes one) and one
    well, spudding next year: in a range that well is outside, Egina reads its
    own values; once it is inside, it folds in."""
    await _seed_logistics(client, db)
    pid = await _campaign(client, [("E-LATE", "Egina", date(YEAR + 1, 2, 1))])
    db.add(
        Activity(
            project_id=uuid.UUID(pid),
            activity_type="Contracting",
            start_date=date(YEAR, 12, 10),
            end_date=date(YEAR, 12, 20),
            well_project="Egina",
            well_name=None,
        )
    )
    await db.commit()
    assert (await _put(client, pid, "PO", {"well_project": "Egina"}, "Behind")).status_code == 200
    assert (await _put(client, pid, "PO", _w("E-LATE", "Egina"), "Completed")).status_code == 200

    # This year only: Egina's own PO, Behind. Once E-LATE is in range: Completed.
    want = {(YEAR, 1): (0, 1), (YEAR, 2): (1, 0), (YEAR + 1, 1): (1, 0), None: (1, 0)}
    for rng, (done, behind) in want.items():
        egina = (await _lens(client, pid, rng))["project_rows"][0]
        f = egina["figures"]
        assert (f["done"], f["behind"], egina["in_range"]) == (done, behind, True), rng
        if rng is not None:
            t = await _tile(client, pid, rng)
            assert (t["focus_count"], t["behind_cells"], t["overall_pct"]) == (
                1,
                behind,
                pct(done, f["counted"]),
            ), rng


@pytest.mark.asyncio
async def test_a_row_names_its_wells_behind_on_a_well_level_check_only(
    client: AsyncClient, db: AsyncSession
) -> None:
    await _seed_logistics(client, db)
    await _check(client, "L-PRJ", project=True, well=False, order=200)
    pid = await _campaign(
        client,
        [
            ("W-1", FP, date(YEAR, 11, 1)),
            ("W-2", FP, date(YEAR, 12, 1)),
            ("W-3", FP, date(YEAR + 1, 6, 1)),
        ],
    )
    assert (await _put(client, pid, "L-PRJ", PROJECT, "Behind")).status_code == 200

    async def wells_behind() -> dict:
        """Bonga's "N wells behind" with no range, this year only, and both years."""
        return {
            name: (await _lens(client, pid, rng))["project_rows"][0]["wells_behind"]
            for name, rng in (("all", None), ("this", (YEAR, 1)), ("both", (YEAR, 2)))
        }

    lens = await _lens(client, pid)
    # Every well row carries Bonga's project-only L-PRJ, Behind — but it's the
    # project's own check: Bonga is behind on it once, and no well is behind.
    assert [w["figures"]["behind"] for w in lens["well_rows"]] == [1, 1, 1]
    assert lens["project_rows"][0]["figures"]["behind"] == 1
    assert await wells_behind() == {"all": 0, "this": 0, "both": 0}

    # W-3 behind on two checks of its own: one well, in the ranges it is in.
    assert (await _put(client, pid, "PO", _w("W-3"), "Behind")).status_code == 200
    assert (await _put(client, pid, "NAV", _w("W-3"), "Behind")).status_code == 200
    assert await wells_behind() == {"all": 1, "this": 0, "both": 1}

    # Bonga's own Behind on a check at both levels reaches every well following it.
    assert (await _put(client, pid, "CTR", PROJECT, "Behind")).status_code == 200
    assert await wells_behind() == {"all": 3, "this": 2, "both": 3}


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
    d = (await client.get(f"/api/projects/{pid}/dashboard")).json()
    assert (d["readiness"]["focus_count"], d["readiness"]["behind_cells"]) == (1, 1)


# ── One range rule, both sides of the lower boundary (PR 35 review) ─────────


@pytest.mark.asyncio
async def test_a_well_with_work_left_from_before_the_range_is_out_of_it_on_the_tile_and_the_tab(
    client: AsyncClient, db: AsyncSession
) -> None:
    """W-OLD has unfinished work that spud last year AND more this year. Its work
    left starts before a range of this year only, so it is out of that range
    everywhere — the tile, the field project's fold and its Wells row — and its
    Behind can't reach the tile while the tab reads the project without it."""
    await _seed_logistics(client, db)
    pid = await _campaign(
        client,
        [
            ("W-OLD", FP, date(YEAR - 1, 6, 1)),
            ("W-OLD", FP, date(YEAR, 6, 1)),
            ("W-THIS", FP, date(YEAR, 3, 1)),
            ("E-OLD", "Egina", date(YEAR - 1, 6, 1)),
            ("E-OLD", "Egina", date(YEAR, 6, 1)),
        ],
    )
    await _put(client, pid, "PO", _w("W-OLD"), "Behind")
    await _put(client, pid, "PO", _w("E-OLD", "Egina"), "Behind")

    async def rows(rng: Range) -> dict[str, dict]:
        return {r["well_project"]: r for r in (await _lens(client, pid, rng))["project_rows"]}

    # This year only: W-OLD is out, so Bonga reads W-THIS alone; Egina is out.
    this = await rows((YEAR, 1))
    assert (this[FP]["in_range"], this[FP]["figures"]["behind"], this[FP]["wells_behind"]) == (
        True, 0, 0,
    )  # fmt: skip
    assert this["Egina"]["in_range"] is False
    tile = await _tile(client, pid, (YEAR, 1))
    assert (tile["focus_count"], tile["behind_cells"]) == (1, 0)
    # The Wells row says why: its work left starts last year.
    old = next(w for w in (await _lens(client, pid))["well_rows"] if w["well_name"] == "W-OLD")
    assert old["focus_start"] == date(YEAR - 1, 6, 1).isoformat()

    # Moved back a year: both wells are in, on the tile and the tab alike.
    back = await rows((YEAR - 1, 2))
    assert (back[FP]["figures"]["behind"], back[FP]["wells_behind"]) == (1, 1)
    assert back["Egina"]["in_range"] is True
    tile = await _tile(client, pid, (YEAR - 1, 2))
    assert (tile["focus_count"], tile["behind_cells"]) == (2, 2)


@pytest.mark.asyncio
async def test_a_bad_range_is_refused_with_or_without_a_first_year_and_before_a_save(
    client: AsyncClient, db: AsyncSession
) -> None:
    await _seed_logistics(client, db)
    pid = await _campaign(client, [("W-1", FP, 30)])
    lens = f"/api/projects/{pid}/readiness/teams/logistics"
    # ``years`` alone is still on the allow-list — never an unlimited read.
    for bad in ("years=0", "years=4", f"from_year={YEAR}&years=4", "from_year=1800"):
        assert (await client.get(f"{lens}?{bad}")).status_code == 422, bad
    assert (await client.get(f"{lens}?years=2")).status_code == 200

    # A tick save with a bad range saves NOTHING: no tick, no audit event.
    body = {"scope": "project", "well_project": FP, "applies": {"PO": False}}
    for bad in ("years=4", f"from_year={YEAR}&years=4"):
        r = await client.put(f"{lens}/applicability?{bad}", json=body)
        assert r.status_code == 422, bad
    row = (await client.get(lens)).json()["project_rows"][0]
    assert row["checks"]["PO"]["applies"] is True
    events = (await client.get(f"/api/projects/{pid}/audit")).json()
    assert "readiness_applicability_changed" not in str(events)
    # The same save with a good range goes through.
    r = await client.put(f"{lens}/applicability?from_year={YEAR}&years=1", json=body)
    assert r.status_code == 200, r.text
    assert r.json()["project_rows"][0]["checks"]["PO"]["applies"] is False
