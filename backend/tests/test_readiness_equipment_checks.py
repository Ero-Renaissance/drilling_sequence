"""Equipment checks — the rules and the API (phase 7 of
docs/readiness-framework-spec.md, §3.7, §3.9, §4.4, §5.1, §5.3, §6, §7.11,
§7.15–§7.17, §9 "Phase 7 adds").

The 21 equipment types are ordinary Logistics checks that START UNTICKED
(``applies_by_default = False``). With no applicability row on the target — nor,
for a well, on its field project — such a check is NOT SELECTED: the team rows
still send its cell (``applies: false, applies_source: "default"``) for the tick
list, but it carries nothing — no figure counts it, not even as N/A, and no
snapshot records it. Ticking it on a field project NOMINATES it (an
``applies = true`` row) and its wells inherit that; un-nominating deletes the
row. A check that doesn't apply because of a ROW is "not applicable", as in
phase 6. The Project gates are untouched.

The catalog side (create/edit, ``catalog_json``) is in
test_readiness_equipment_catalog.py; the checks are seeded from migration 039's
literals (tests/readiness_seed.py).
"""
import uuid
from types import SimpleNamespace

import pytest
from httpx import AsyncClient, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity
from app.models.audit import AuditLog
from app.models.readiness import NA_STATUS, ReadinessApplicability
from app.models.user import User
from app.services.readiness_catalog import active_checks
from app.services.readiness_effective import (
    Effective,
    EntryIndex,
    cell_status,
    default_applies,
    project_applies,
    project_value,
    well_applies,
    well_value,
)
from app.services.readiness_effective import not_selected as is_not_selected
from app.services.readiness_rollup import in_scope, live_cells, pct, rollup
from app.services.snapshot import build_project_snapshot
from tests.readiness_seed import (
    EQUIPMENT_CODES,
    seed_core_logistics_checks,
    seed_equipment_checks,
)

FP = "Bonga Phase 3"
ACT = "Oil Development"
PROJECT = {"scope": "project", "well_project": FP}
CORE = ["L-BUD", "CTR", "FFP", "CTS", "PO", "NAV"]
GATES = ["FDP", "LLI", "LOC", "FE", "FID", "EIA", "BUD"]
# A cell that is not selected, as the team rows send it.
NOT_SELECTED = (False, "default")


# ── Fixtures ────────────────────────────────────────────────────────────────


async def _user(client: AsyncClient, db: AsyncSession, email: str) -> User:
    await client.get("/api/projects")  # the auth dependency materialises the user
    return (await db.execute(select(User).where(User.email == email))).scalar_one()


async def _make_admin(client: AsyncClient, db: AsyncSession) -> User:
    me = await _user(client, db, "test@company.com")
    me.is_admin = True
    await db.commit()
    return me


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


async def _campaign(client: AsyncClient, name: str = "Equipment") -> str:
    """W-1 and W-2 under one field project, and LONE-1 with no field project."""
    pid = (await client.post("/api/projects", json={"name": name})).json()["id"]
    await _activity(client, pid, "W-1")
    await _activity(client, pid, "W-2")
    await _activity(client, pid, "LONE-1", project=None)
    return pid


async def _catalog(db: AsyncSession, equipment: list[str] | None = None) -> None:
    """The six core Logistics checks, and the equipment checks (all 21, or
    ``equipment``) as migration 039 seeds them."""
    await seed_core_logistics_checks(db)
    if equipment != []:
        await seed_equipment_checks(db, equipment)


async def _setup(
    client: AsyncClient, db: AsyncSession, equipment: list[str] | None = None
) -> str:
    """As admin (test@): the Logistics catalog and a campaign."""
    await _make_admin(client, db)
    await _catalog(db, equipment)
    return await _campaign(client)


def _well(name: str = "W-1", project: str = FP) -> dict:
    return {"scope": "well", "well_project": project, "well_name": name, "activity_type": ACT}


LONE = _well("LONE-1", project="")


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


def _project_row(rows: dict) -> dict:
    return next(r for r in rows["project_rows"] if r["well_project"] == FP)


def _cell(rows: dict, code: str, well: str | None = None) -> dict:
    """One cell of a lens (or of an applicability response): the field project's
    row, or a well's."""
    if well is None:
        return _project_row(rows)["checks"][code]
    return _well_row(rows, well)["checks"][code]


def _tick(cell: dict) -> tuple[bool, str]:
    return cell["applies"], cell["applies_source"]


async def _details(db: AsyncSession, pid: str, action: str = "readiness_applicability_changed") -> list[str]:
    return list(
        (
            await db.execute(
                select(AuditLog.new_value)
                .where(AuditLog.project_id == uuid.UUID(pid), AuditLog.field == action)
                .order_by(AuditLog.timestamp)
            )
        ).scalars()
    )


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


async def _logistics_cells(db: AsyncSession, pid: str, **kwargs) -> dict[tuple[str, ...], dict[str, str]]:
    activities = (
        await db.execute(select(Activity).where(Activity.project_id == uuid.UUID(pid)))
    ).scalars().all()
    _, cells = await live_cells(
        db,
        uuid.UUID(pid),
        await active_checks(db, team_code="logistics"),
        [a for a in activities if in_scope(a, None)],
        **kwargs,
    )
    return cells


def _key(well: str, project: str = FP) -> tuple[str, str, str]:
    return (project, well, ACT)


async def _dashboard(client: AsyncClient, pid: str) -> dict:
    r = await client.get(f"/api/projects/{pid}/dashboard?readiness_horizon_months=0")
    assert r.status_code == 200, r.text
    return r.json()


def _logistics_tile(dashboard: dict) -> dict:
    return next(t for t in dashboard["team_readiness"] if t["team_code"] == "logistics")


# ── The §3.9 rule, without a database ───────────────────────────────────────


def _def(
    code: str = "PSV",
    *,
    project: bool = True,
    well: bool = True,
    by_default: bool | None = False,
    governed: bool = False,
) -> SimpleNamespace:
    return SimpleNamespace(
        code=code,
        status_set="standard",
        applies_project=project,
        applies_well=well,
        locks_with_plan=governed,
        applies_by_default=by_default,
    )


def _row(applies: bool) -> SimpleNamespace:
    return SimpleNamespace(applies=applies)


def _entry(status: str) -> SimpleNamespace:
    return SimpleNamespace(status=status, notes=None, updated_at=None)


@pytest.mark.parametrize(
    ("project_row", "well_row", "expected", "not_selected"),
    [
        # No row anywhere: the check's default — not selected.
        (None, None, (False, "default"), True),
        # Nominated on the field project: its wells inherit it.
        (True, None, (True, "project"), False),
        # A well nominates on its own (§7.16).
        (None, True, (True, "well"), False),
        # A well's own untick under a nominating field project: not applicable.
        (True, False, (False, "well"), False),
        # A row saying it doesn't apply is not applicable, never not selected.
        (False, None, (False, "project"), False),
        (None, False, (False, "well"), False),
    ],
)
def test_a_check_that_starts_unticked_applies_only_where_a_row_says_so(
    project_row: bool | None,
    well_row: bool | None,
    expected: tuple[bool, str],
    not_selected: bool,
) -> None:
    index = EntryIndex(
        project_applies={} if project_row is None else {(FP, "PSV"): _row(project_row)},
        well_applies={} if well_row is None else {(*_key("W-1"), "PSV"): _row(well_row)},
    )
    psv = _def()
    assert well_applies(index, psv, _key("W-1")) == expected
    value = well_value(index, psv, _key("W-1"))
    assert (value.applies, value.applies_source) == expected
    assert is_not_selected(value) is not_selected
    # The field project itself: its row, else the default.
    project = project_value(index, psv, FP)
    if project_row is None:
        assert (project.applies, project.applies_source) == NOT_SELECTED
        assert is_not_selected(project)
    else:
        assert (project.applies, project.applies_source) == (project_row, "project")
        assert not is_not_selected(project)


def test_with_nothing_to_follow_a_well_reads_the_checks_default() -> None:
    index = EntryIndex(project_applies={("", "PSV"): _row(True), (FP, "WEQ"): _row(True)})
    # No field project: nothing to inherit, whatever is stored under "".
    assert well_applies(index, _def(), ("", "LONE-1", ACT)) == NOT_SELECTED
    # A well-only check that starts unticked has no field-project choice to follow.
    assert well_applies(index, _def("WEQ", project=False), _key("W-1")) == NOT_SELECTED
    # A check that starts ticked keeps phase 6's rule.
    assert well_applies(EntryIndex(), _def("NAV", by_default=True), ("", "LONE-1", ACT)) == (
        True,
        "default",
    )
    assert project_applies(EntryIndex(), _def("NAV", by_default=True), FP) == (True, "default")


def test_a_check_that_locks_with_the_plan_always_applies() -> None:
    """A Project gate has no tick list (decision 31) and the catalog refuses one
    that starts unticked; were one stored, it would still apply."""
    gate = _def("FID", well=False, governed=True)
    assert default_applies(gate) is True
    assert project_applies(EntryIndex(), gate, FP) == (True, "default")
    assert not is_not_selected(project_value(EntryIndex(), gate, FP))


def test_an_unflushed_check_reads_as_starting_ticked() -> None:
    """``None`` is the column's default (True) not yet applied — never "starts
    unticked", which only an explicit False means."""
    assert default_applies(_def(by_default=None)) is True
    assert default_applies(_def(by_default=True)) is True
    assert default_applies(_def(by_default=False)) is False


def test_a_well_inherits_the_status_only_while_the_check_is_nominated() -> None:
    """Spec §3.8 with §3.9: the field project's status is inherited only while
    the check applies to the field project — so a well that nominates on its own
    under a field project that didn't reads the default, never the project's
    hidden status."""
    psv = _def()
    hidden = EntryIndex(
        project={(FP, "PSV"): _entry("Completed")},
        well_applies={(*_key("W-1"), "PSV"): _row(True)},
    )
    w1 = well_value(hidden, psv, _key("W-1"))
    assert (w1.status, w1.source, w1.applies, w1.applies_source) == (
        "On Track", "default", True, "well",
    )
    nominated = EntryIndex(
        project={(FP, "PSV"): _entry("Completed")},
        project_applies={(FP, "PSV"): _row(True)},
    )
    w1 = well_value(nominated, psv, _key("W-1"))
    assert (w1.status, w1.source, w1.applies, w1.applies_source) == (
        "Completed", "project", True, "project",
    )


@pytest.mark.parametrize(
    ("applies", "source", "expected"),
    [
        (False, "default", True),
        (False, "project", False),
        (False, "well", False),
        (True, "default", False),
        (True, "project", False),
        (True, "well", False),
    ],
)
def test_not_selected_is_a_default_that_does_not_apply(
    applies: bool, source: str, expected: bool
) -> None:
    value = Effective(status="On Track", source="default", applies=applies, applies_source=source)
    assert is_not_selected(value) is expected
    # cell_status itself is unchanged: callers leave a not-selected cell out first.
    assert cell_status(value) == ("On Track" if applies else NA_STATUS)


# ── Rollup and snapshot: not selected carries nothing (§3.7, §6) ────────────


@pytest.mark.asyncio
async def test_live_cells_leave_out_what_is_not_selected(
    client: AsyncClient, db: AsyncSession
) -> None:
    pid = await _setup(client, db, ["PSV", "CR"])
    assert (await _put(client, pid, "PO", PROJECT, "Completed")).status_code == 200
    assert (await _apply(client, pid, PROJECT, {"PSV": True})).status_code == 200
    assert (await _apply(client, pid, _well("W-2"), {"PSV": False})).status_code == 200

    cells = await _logistics_cells(db, pid)
    core = {c: "On Track" for c in CORE} | {"PO": "Completed"}
    # PSV nominated on the field project; CR selected nowhere — no cell.
    assert cells[_key("W-1")] == core | {"PSV": "On Track"}
    # W-2's own untick under the nomination: not applicable, so N/A.
    assert cells[_key("W-2")] == core | {"PSV": NA_STATUS}
    assert cells[("", "LONE-1", ACT)] == {c: "On Track" for c in CORE}

    f = rollup(cells.values(), codes=["PSV", "CR"])
    assert (f.targets, f.counted, f.na) == (3, 6 * 3 + 1, 1)
    assert f.by_check["CR"] == {"completed": 0, "on_track": 0, "behind": 0, "na": 0}
    assert f.by_check["PSV"] == {"completed": 0, "on_track": 1, "behind": 0, "na": 1}

    # The field-project branch (a team counted per field project) too.
    by_project = await _logistics_cells(db, pid, unit="projects")
    assert by_project[(FP,)] == core | {"PSV": "On Track"}


@pytest.mark.asyncio
async def test_a_target_whose_only_checks_are_not_selected_reads_nothing_applies(
    client: AsyncClient, db: AsyncSession
) -> None:
    """A team whose only check starts unticked: each target stays a target, with
    nothing counted — "Nothing applies" (— in the tile), not 0% — and no N/A."""
    await _make_admin(client, db)
    r = await client.post(
        "/api/admin/readiness/teams", json={"code": "supply", "name": "Supply", "icon_key": "truck"}
    )
    assert r.status_code == 201, r.text
    r = await client.post(
        "/api/admin/readiness/checks",
        json={
            "code": "S-EQ",
            "label": "Supply Equipment",
            "team_code": "supply",
            "applies_project": True,
            "applies_well": False,
            "status_set": "standard",
            "icon_key": "container",
            "locks_with_plan": False,
            "sort_order": 10,
            "applies_by_default": False,
        },
    )
    assert r.status_code == 201, r.text
    pid = await _campaign(client)

    lens = await _lens(client, pid, "supply")
    row = _project_row(lens)
    assert _tick(row["checks"]["S-EQ"]) == NOT_SELECTED
    assert row["figures"] == {
        "counted": 0, "done": 0, "in_progress": 0, "behind": 0, "na": 0, "ready": False,
    }
    tile = next(t for t in (await _dashboard(client, pid))["team_readiness"] if t["team_code"] == "supply")
    assert (tile["unit"], tile["focus_count"], tile["ready_of"]) == ("projects", 1, 0)
    assert tile["overall_pct"] is None and tile["on_track_pct"] is None

    # Nominated, it counts at once.
    assert (await _apply(client, pid, PROJECT, {"S-EQ": True}, team="supply")).status_code == 200
    figures = _project_row(await _lens(client, pid, "supply"))["figures"]
    assert (figures["counted"], figures["in_progress"], figures["na"]) == (1, 1, 0)


@pytest.mark.asyncio
async def test_a_snapshot_records_only_what_is_selected(
    client: AsyncClient, db: AsyncSession
) -> None:
    """Spec §6: a check that is not selected is left out of
    ``readiness_at_submission``; one that doesn't apply because of a row is N/A."""
    pid = await _setup(client, db, ["PSV", "CR", "LBT"])
    await _put(client, pid, "FID", PROJECT, "N/A")
    await _apply(client, pid, PROJECT, {"PSV": True})
    await _put(client, pid, "PSV", PROJECT, "Completed")
    await _apply(client, pid, _well("W-2"), {"PSV": False})
    await _apply(client, pid, LONE, {"LBT": True})

    rows = {a["well_name"]: a for a in await build_project_snapshot(uuid.UUID(pid), db)}
    w1, w2 = rows["W-1"]["readiness_at_submission"], rows["W-2"]["readiness_at_submission"]
    lone = rows["LONE-1"]["readiness_at_submission"]
    assert list(w1) == [*CORE, "PSV"]
    assert w1["PSV"] == {"status": "Completed", "source": "project"}
    assert w2["PSV"] == {"status": NA_STATUS, "source": "project"}
    assert list(lone) == [*CORE, "LBT"]
    assert lone["LBT"] == {"status": "On Track", "source": "default"}
    assert all("CR" not in r["readiness_at_submission"] for r in rows.values())
    # The Project gates' block is unchanged.
    assert rows["W-1"]["readiness"]["FID"] == NA_STATUS
    assert list(rows["W-1"]["readiness"]) == GATES

    # And so it reads in a stored revision.
    import json

    rev = await client.post(f"/api/projects/{pid}/revisions", json={})
    assert rev.status_code in (200, 201), rev.text
    detail = (await client.get(f"/api/projects/{pid}/revisions/{rev.json()['id']}")).json()
    stored = {a["well_name"]: a for a in json.loads(detail["snapshot_json"])}
    assert stored["W-1"]["readiness_at_submission"] == w1
    assert stored["LONE-1"]["readiness_at_submission"] == lone


# ── Figures on deploy (§3.9) ────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_seeding_the_equipment_checks_changes_no_figure(
    client: AsyncClient, db: AsyncSession
) -> None:
    """A campaign with Logistics values reads exactly the same — lens figures,
    the team and gates tiles, the Project gates and the snapshot — once the 21
    equipment checks arrive, because a check that is not selected carries
    nothing."""
    pid = await _setup(client, db, equipment=[])
    for code, target, status in (
        ("PO", PROJECT, "Completed"),
        ("CTR", _well("W-1"), "Behind"),
        ("L-BUD", LONE, "Completed"),
        ("FID", PROJECT, "Completed"),
        ("BUD", PROJECT, "N/A"),
    ):
        assert (await _put(client, pid, code, target, status)).status_code == 200
    assert (await _apply(client, pid, PROJECT, {"NAV": False})).status_code == 200
    assert (await _apply(client, pid, _well("W-2"), {"NAV": True})).status_code == 200
    assert (await _apply(client, pid, LONE, {"FFP": False})).status_code == 200

    async def figures() -> dict:
        lens = await _lens(client, pid)
        dashboard = await _dashboard(client, pid)
        snapshot = await build_project_snapshot(uuid.UUID(pid), db)
        return {
            "project_rows": [(r["well_project"], r["figures"]) for r in lens["project_rows"]],
            "well_rows": [(r["well_name"], r["figures"]) for r in lens["well_rows"]],
            "tiles": dashboard["team_readiness"],
            "gates_tile": dashboard["readiness"],
            "gates": (await client.get(f"/api/projects/{pid}/readiness")).json(),
            "snapshot": [
                (a["well_name"], a["readiness"], a["readiness_at_submission"]) for a in snapshot
            ],
        }

    before = await figures()
    assert len(await seed_equipment_checks(db)) == 21
    assert await figures() == before

    # The cells are there — the tick list names them — each not selected.
    lens = await _lens(client, pid)
    assert [c["code"] for c in lens["checks"]] == [*CORE, *EQUIPMENT_CODES]
    for code in EQUIPMENT_CODES:
        assert _tick(_cell(lens, code)) == NOT_SELECTED
        for well in ("W-1", "W-2", "LONE-1"):
            assert _tick(_cell(lens, code, well)) == NOT_SELECTED
    assert await _rows(db, pid) == [
        ("FFP", "well", "", "LONE-1", False),
        ("NAV", "project", FP, "", False),
        ("NAV", "well", FP, "W-2", True),
    ]


@pytest.mark.asyncio
async def test_the_tab_adds_up_to_the_tile_with_equipment(
    client: AsyncClient, db: AsyncSession
) -> None:
    """The server's per-row ``figures`` and the dashboard tile leave out the same
    not-selected cells and count the same nominated ones (spec §3.7)."""
    pid = await _setup(client, db)
    await _apply(client, pid, PROJECT, {"PSV": True, "CR": True})
    await _put(client, pid, "CR", PROJECT, "Behind")
    await _apply(client, pid, _well("W-2"), {"PSV": False, "LBT": True})
    await _put(client, pid, "LBT", _well("W-2"), "Completed")
    await _apply(client, pid, LONE, {"RW": True})

    lens = await _lens(client, pid)
    assert [(r["well_name"], r["figures"]["counted"], r["figures"]["na"]) for r in lens["well_rows"]] == [
        ("LONE-1", 7, 0),  # core + RW
        ("W-1", 8, 0),  # core + PSV + CR
        ("W-2", 8, 1),  # core + CR + LBT; PSV unticked on the well
    ]
    figs = [r["figures"] for r in lens["well_rows"]]
    tile = _logistics_tile(await _dashboard(client, pid))
    counted = sum(f["counted"] for f in figs)
    done = sum(f["done"] for f in figs)
    assert (len(figs), pct(done, counted), sum(f["behind"] for f in figs)) == (
        tile["focus_count"],
        tile["overall_pct"],
        tile["behind_cells"],
    )
    assert pct(done + sum(f["in_progress"] for f in figs), counted) == tile["on_track_pct"]
    assert tile["behind_cells"] == 2  # CR, inherited by W-1 and W-2


# ── The applicability write (§5.1, §5.3) ────────────────────────────────────


@pytest.mark.asyncio
async def test_nominating_on_a_field_project_writes_one_row_its_wells_inherit(
    client: AsyncClient, db: AsyncSession
) -> None:
    pid = await _setup(client, db, ["PSV", "CR"])
    r = await _apply(client, pid, PROJECT, {"PSV": True, "CR": False})
    assert r.status_code == 200, r.text
    # One applies=true row — and nothing for CR, which reads its default already.
    assert await _rows(db, pid) == [("PSV", "project", FP, "", True)]
    assert await _details(db, pid) == ["PSV: not selected -> applies; for Bonga Phase 3"]
    body = r.json()
    assert _tick(_cell(body, "PSV")) == (True, "project")
    for well in ("W-1", "W-2"):
        assert _tick(_cell(body, "PSV", well)) == (True, "project")
        assert _tick(_cell(body, "CR", well)) == NOT_SELECTED
    assert _project_row(body)["figures"]["counted"] == 7

    # Again: nothing changes, nothing is audited.
    assert (await _apply(client, pid, PROJECT, {"PSV": True})).status_code == 200
    assert len(await _details(db, pid)) == 1
    # LONE-1 has no field project to follow: still not selected.
    assert _tick(_cell(await _lens(client, pid), "PSV", "LONE-1")) == NOT_SELECTED

    # The status of a nominated check is writable, and its wells inherit it.
    assert (await _put(client, pid, "PSV", PROJECT, "Completed")).status_code == 200
    w2 = _cell(await _lens(client, pid), "PSV", "W-2")
    assert (w2["status"], w2["source"]) == ("Completed", "project")


@pytest.mark.asyncio
async def test_un_nominating_returns_following_wells_to_not_selected(
    client: AsyncClient, db: AsyncSession
) -> None:
    """Spec §7.15: un-nominating deletes the field project's row (no 500) and
    returns every well that follows it to not selected. A well that ticked the
    type itself keeps it; one that unticked it keeps its row and reads Not
    applicable until Follow project."""
    pid = await _setup(client, db, ["PSV"])
    await _activity(client, pid, "W-3")
    await _apply(client, pid, PROJECT, {"PSV": True})
    await _apply(client, pid, _well("W-2"), {"PSV": False})  # its own untick
    await _put(client, pid, "PSV", _well("W-3"), "Behind")  # W-3 follows, with a status

    r = await _apply(client, pid, PROJECT, {"PSV": False})
    assert r.status_code == 200, r.text
    assert await _rows(db, pid) == [("PSV", "well", FP, "W-2", False)]
    assert (await _details(db, pid))[-1] == "PSV: applies -> not selected; for Bonga Phase 3"
    body = r.json()
    assert _tick(_cell(body, "PSV")) == NOT_SELECTED
    assert _tick(_cell(body, "PSV", "W-1")) == NOT_SELECTED
    assert _tick(_cell(body, "PSV", "W-3")) == NOT_SELECTED
    assert _cell(body, "PSV", "W-3")["status"] == "Behind"  # kept underneath
    assert _tick(_cell(body, "PSV", "W-2")) == (False, "well")  # not applicable
    # Not selected carries nothing; the well's own untick is not counted (na).
    assert (_well_row(body, "W-1")["figures"]["counted"], _well_row(body, "W-1")["figures"]["na"]) == (6, 0)
    assert (_well_row(body, "W-2")["figures"]["counted"], _well_row(body, "W-2")["figures"]["na"]) == (6, 1)

    # Follow project: W-2 is not selected too, and its row goes (audited).
    r = await _apply(client, pid, _well("W-2"), {"PSV": None})
    assert r.status_code == 200
    assert _tick(_cell(r.json(), "PSV", "W-2")) == NOT_SELECTED
    assert await _rows(db, pid) == []
    assert (await _details(db, pid))[-1] == (
        "PSV: set on this well -> follows field project; for W-2 (Bonga Phase 3, Oil Development)"
    )

    # Re-nominating brings W-3's status back.
    rows = (await _apply(client, pid, PROJECT, {"PSV": True})).json()
    assert (_cell(rows, "PSV", "W-3")["status"], _tick(_cell(rows, "PSV", "W-3"))) == (
        "Behind",
        (True, "project"),
    )


@pytest.mark.asyncio
async def test_a_well_nominates_on_its_own(client: AsyncClient, db: AsyncSession) -> None:
    """Spec §7.16: an applies=true well row, as in phase 6 — and it survives an
    un-nomination of its field project ("set on this well")."""
    pid = await _setup(client, db, ["CR"])
    r = await _apply(client, pid, _well("W-1"), {"CR": True})
    assert r.status_code == 200, r.text
    assert await _rows(db, pid) == [("CR", "well", FP, "W-1", True)]
    assert await _details(db, pid) == [
        "CR: follows field project -> applies; for W-1 (Bonga Phase 3, Oil Development)"
    ]
    lens = await _lens(client, pid)
    assert _tick(_cell(lens, "CR", "W-1")) == (True, "well")
    assert _tick(_cell(lens, "CR", "W-2")) == NOT_SELECTED
    assert _tick(_cell(lens, "CR")) == NOT_SELECTED

    # The field project nominates, then un-nominates: W-1 keeps its own choice.
    await _apply(client, pid, PROJECT, {"CR": True})
    await _apply(client, pid, PROJECT, {"CR": False})
    lens = await _lens(client, pid)
    assert _tick(_cell(lens, "CR", "W-1")) == (True, "well")
    assert _tick(_cell(lens, "CR", "W-2")) == NOT_SELECTED

    # Following a field project that doesn't nominate: back to not selected.
    r = await _apply(client, pid, _well("W-1"), {"CR": None})
    assert _tick(_cell(r.json(), "CR", "W-1")) == NOT_SELECTED
    assert (await _details(db, pid))[-1] == (
        "CR: applies -> follows field project; for W-1 (Bonga Phase 3, Oil Development)"
    )
    # Writing the field project's current choice on a following well: nothing.
    assert (await _apply(client, pid, _well("W-1"), {"CR": False})).status_code == 200
    assert await _rows(db, pid) == []
    assert len(await _details(db, pid)) == 4


@pytest.mark.asyncio
async def test_a_well_with_no_field_project_reads_the_default_in_its_audit(
    client: AsyncClient, db: AsyncSession
) -> None:
    """Spec §5.3: with nothing to follow, the no-row state is the check's
    default — "not selected" for a check that starts unticked, never a fixed
    "applies"."""
    pid = await _setup(client, db, ["PSV"])
    assert (await _apply(client, pid, LONE, {"PSV": True})).status_code == 200
    assert await _rows(db, pid) == [("PSV", "well", "", "LONE-1", True)]
    assert (await _apply(client, pid, LONE, {"PSV": False})).status_code == 200
    assert await _rows(db, pid) == []
    assert (await _apply(client, pid, LONE, {"PSV": True})).status_code == 200
    assert (await _apply(client, pid, LONE, {"PSV": None})).status_code == 200  # Follow = default
    assert await _rows(db, pid) == []
    assert await _details(db, pid) == [
        "PSV: not selected -> applies; for LONE-1 (no field project, Oil Development)",
        "PSV: applies -> not selected; for LONE-1 (no field project, Oil Development)",
        "PSV: not selected -> applies; for LONE-1 (no field project, Oil Development)",
        "PSV: applies -> not selected; for LONE-1 (no field project, Oil Development)",
    ]
    # Unticking what isn't selected changes nothing.
    assert (await _apply(client, pid, LONE, {"PSV": False})).status_code == 200
    assert len(await _details(db, pid)) == 4

    # A check that starts ticked keeps phase 6's words.
    assert (await _apply(client, pid, LONE, {"NAV": False})).status_code == 200
    assert (await _apply(client, pid, LONE, {"NAV": None})).status_code == 200
    assert (await _details(db, pid))[-2:] == [
        "NAV: applies -> does not apply; for LONE-1 (no field project, Oil Development)",
        "NAV: does not apply -> applies; for LONE-1 (no field project, Oil Development)",
    ]


@pytest.mark.asyncio
async def test_a_check_that_starts_ticked_keeps_phase_6s_rows_and_words(
    client: AsyncClient, db: AsyncSession
) -> None:
    pid = await _setup(client, db, ["PSV"])
    await _apply(client, pid, PROJECT, {"NAV": False})
    assert await _rows(db, pid) == [("NAV", "project", FP, "", False)]
    await _apply(client, pid, PROJECT, {"NAV": True})
    assert await _rows(db, pid) == []
    assert await _details(db, pid) == [
        "NAV: applies -> does not apply; for Bonga Phase 3",
        "NAV: does not apply -> applies; for Bonga Phase 3",
    ]


@pytest.mark.asyncio
async def test_a_mixed_request_is_one_transaction(client: AsyncClient, db: AsyncSession) -> None:
    """Nominating and unticking in one request, in catalog order; and all or
    nothing when one code is refused."""
    pid = await _setup(client, db, ["PSV", "CR"])
    refused = await _apply(client, pid, PROJECT, {"PSV": True, "ZZZ": True})
    assert refused.status_code == 422
    assert await _rows(db, pid) == [] and await _details(db, pid) == []

    r = await _apply(client, pid, PROJECT, {"CR": True, "NAV": False, "PSV": True})
    assert r.status_code == 200, r.text
    assert await _details(db, pid) == [
        "NAV: applies -> does not apply; for Bonga Phase 3",
        "PSV: not selected -> applies; for Bonga Phase 3",
        "CR: not selected -> applies; for Bonga Phase 3",
    ]
    assert await _rows(db, pid) == [
        ("CR", "project", FP, "", True),
        ("NAV", "project", FP, "", False),
        ("PSV", "project", FP, "", True),
    ]


@pytest.mark.asyncio
async def test_no_status_on_a_check_that_is_not_selected(
    client: AsyncClient, db: AsyncSession
) -> None:
    """A status, or Reset to project, on a check that is not selected → 409, as
    for one that doesn't apply (spec §7.10): nominate it first."""
    pid = await _setup(client, db, ["PSV"])
    for target in (PROJECT, _well("W-1"), LONE):
        r = await _put(client, pid, "PSV", target, "Completed")
        assert r.status_code == 409, target
        assert r.json()["detail"] == "This check doesn't apply here — tick it first"
    reset = await client.post(f"/api/projects/{pid}/readiness/PSV/reset", json=_well("W-1"))
    assert reset.status_code == 409
    assert await _details(db, pid, "readiness_updated") == []
    assert await _details(db, pid, "readiness_reset") == []

    # Nominated on W-1 only: W-1 is writable, W-2 still not.
    await _apply(client, pid, _well("W-1"), {"PSV": True})
    assert (await _put(client, pid, "PSV", _well("W-1"), "Behind")).status_code == 200
    assert (await _put(client, pid, "PSV", _well("W-2"), "Behind")).status_code == 409
    assert (await _put(client, pid, "PSV", PROJECT, "Behind")).status_code == 409
    assert await _details(db, pid, "readiness_updated") == [
        "PSV for W-1 (Bonga Phase 3, Oil Development): On Track -> Behind"
    ]
    reset = await client.post(f"/api/projects/{pid}/readiness/PSV/reset", json=_well("W-1"))
    assert reset.status_code == 200
    # The well applies on its own; the field project isn't nominated, so the well
    # reads the default, never a project status.
    assert (reset.json()["status"], reset.json()["source"]) == ("On Track", "default")


# ── Who, and locks (§5.2) ───────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_only_logistics_editors_nominate_equipment(
    client: AsyncClient,
    other_client: AsyncClient,
    third_client: AsyncClient,
    noplan_client: AsyncClient,
    db: AsyncSession,
) -> None:
    await _make_admin(client, db)
    await _catalog(db, ["PSV"])
    r = await client.post(
        "/api/admin/readiness/teams", json={"code": "wells", "name": "Wells", "icon_key": "map-pin"}
    )
    assert r.status_code == 201, r.text
    pid = await _campaign(other_client)  # other@ plans the campaign, without a grant
    await _grant(client, await _user(third_client, db, "third@company.com"), ["wells"])
    nominate = {"PSV": True}

    # A non-grantee, a Wells grantee and the campaign's own planner: 403, for a
    # field project and a well, with nothing written or audited.
    for denied in (noplan_client, third_client, other_client):
        for target in (PROJECT, _well("W-1")):
            assert (await _apply(denied, pid, target, nominate)).status_code == 403
    assert await _rows(db, pid) == []
    assert await _details(db, pid) == []
    # Nor may they set a nominated check's status.
    await _apply(client, pid, PROJECT, nominate)
    for denied in (noplan_client, third_client, other_client):
        assert (await _put(denied, pid, "PSV", PROJECT, "Completed")).status_code == 403
    assert await _details(db, pid, "readiness_updated") == []

    # A Logistics grantee, and an admin (above), may.
    await _grant(client, await _user(noplan_client, db, "noplan@company.com"), ["logistics"])
    assert (await _apply(noplan_client, pid, _well("W-2"), {"PSV": False})).status_code == 200
    assert (await _put(noplan_client, pid, "PSV", PROJECT, "Completed")).status_code == 200
    assert len(await _details(db, pid)) == 2


@pytest.mark.asyncio
async def test_nominations_stay_live_while_the_plan_is_locked(
    client: AsyncClient, db: AsyncSession
) -> None:
    pid = await _setup(client, db, ["PSV"])
    rev = await client.post(f"/api/projects/{pid}/revisions", json={})
    assert rev.status_code in (200, 201), rev.text
    assert (await _lens(client, pid))["locked"] is True
    assert (await _apply(client, pid, PROJECT, {"PSV": True})).status_code == 200
    assert (await _put(client, pid, "PSV", PROJECT, "Completed")).status_code == 200
    assert (await _apply(client, pid, PROJECT, {"PSV": False})).status_code == 200
    assert await _rows(db, pid) == []
    # A Project gate is still frozen.
    assert (await _put(client, pid, "FID", PROJECT, "Completed")).status_code == 423


# ── The Project gates are unchanged (decision 31) ───────────────────────────


@pytest.mark.asyncio
async def test_the_project_gates_are_unchanged(client: AsyncClient, db: AsyncSession) -> None:
    pid = await _setup(client, db)
    rows = (await client.get(f"/api/projects/{pid}/readiness")).json()
    assert list(rows[0]["checks"]) == GATES
    assert set(rows[0]["checks"]["FID"]) == {"status", "notes", "updated_at"}
    assert rows[0]["figures"]["counted"] == 7
    gates = await _lens(client, pid, "projects")
    assert [c["code"] for c in gates["checks"]] == GATES
    assert all(c["category"] == "" and c["applies_by_default"] is True for c in gates["checks"])
    assert {_tick(c) for c in _project_row(gates)["checks"].values()} == {(True, "default")}
    # Still no tick list for them.
    assert (await _apply(client, pid, PROJECT, {"FID": False}, team="projects")).status_code == 422


# ── Lifecycle: retire, rename, clone (§4.4, §7.17) ──────────────────────────


@pytest.mark.asyncio
async def test_retiring_an_equipment_check_keeps_its_nominations(
    client: AsyncClient, db: AsyncSession
) -> None:
    pid = await _setup(client, db, ["PSV"])
    await _apply(client, pid, PROJECT, {"PSV": True})
    await _put(client, pid, "PSV", PROJECT, "Completed")
    assert (await client.post("/api/admin/readiness/checks/PSV/retire")).status_code == 200
    assert "PSV" not in _well_row(await _lens(client, pid))["checks"]
    assert "PSV" not in (await _logistics_cells(db, pid))[_key("W-1")]
    assert await _rows(db, pid) == [("PSV", "project", FP, "", True)]

    assert (await client.post("/api/admin/readiness/checks/PSV/restore")).status_code == 200
    cell = _cell(await _lens(client, pid), "PSV", "W-1")
    assert (cell["status"], _tick(cell)) == ("Completed", (True, "project"))


@pytest.mark.asyncio
async def test_a_rename_carries_a_nomination(client: AsyncClient, db: AsyncSession) -> None:
    pid = await _setup(client, db, ["CR"])
    await _apply(client, pid, _well("W-1"), {"CR": True})
    w1 = next(
        a for a in (await client.get(f"/api/projects/{pid}/activities")).json() if a["well_name"] == "W-1"
    )
    r = await client.patch(f"/api/projects/{pid}/activities/{w1['id']}", json={"well_name": "W-1A"})
    assert r.status_code == 200, r.text
    assert await _rows(db, pid) == [("CR", "well", FP, "W-1A", True)]
    assert _tick(_cell(await _lens(client, pid), "CR", "W-1A")) == (True, "well")
    (event,) = await _details(db, pid, "readiness_rekeyed")
    assert event.endswith(": CR: applies")


@pytest.mark.asyncio
async def test_a_clone_copies_nominations(client: AsyncClient, db: AsyncSession) -> None:
    pid = await _setup(client, db, ["PSV", "CR"])
    await _apply(client, pid, PROJECT, {"PSV": True})
    await _apply(client, pid, _well("W-2"), {"PSV": False, "CR": True})
    clone = await client.post(f"/api/projects/{pid}/clone", json={"name": "Next quarter"})
    assert clone.status_code == 201, clone.text
    cid = clone.json()["id"]
    lens = await _lens(client, cid)
    assert _tick(_cell(lens, "PSV", "W-1")) == (True, "project")
    assert _tick(_cell(lens, "PSV", "W-2")) == (False, "well")
    assert _tick(_cell(lens, "CR", "W-2")) == (True, "well")
    assert _tick(_cell(lens, "CR", "W-1")) == NOT_SELECTED


# ── A check an admin creates "starts unticked" (§5.1) ───────────────────────


@pytest.mark.asyncio
async def test_an_admin_created_check_that_starts_unticked_behaves_the_same(
    client: AsyncClient, db: AsyncSession
) -> None:
    """Not only the seed: any check created with ``applies_by_default: false`` —
    here a project-only one — is not selected until ticked, and carries nothing
    on a well with no field project at all."""
    pid = await _setup(client, db, equipment=[])
    r = await client.post(
        "/api/admin/readiness/checks",
        json={
            "code": "SWB",
            "label": "Swamp Buggy",
            "team_code": "logistics",
            "applies_project": True,
            "applies_well": False,
            "status_set": "standard",
            "icon_key": "tractor",
            "locks_with_plan": False,
            "sort_order": 400,
            "category": "Land transport",
            "applies_by_default": False,
        },
    )
    assert r.status_code == 201, r.text
    lens = await _lens(client, pid)
    assert _tick(_cell(lens, "SWB")) == NOT_SELECTED
    assert _tick(_cell(lens, "SWB", "W-1")) == NOT_SELECTED
    assert "SWB" not in _well_row(lens, "LONE-1")["checks"]
    assert _well_row(lens, "W-1")["figures"]["counted"] == 6
    # A project-only check is ticked per field project, never per well.
    assert (await _apply(client, pid, _well("W-1"), {"SWB": True})).status_code == 422

    assert (await _apply(client, pid, PROJECT, {"SWB": True})).status_code == 200
    assert await _details(db, pid) == ["SWB: not selected -> applies; for Bonga Phase 3"]
    lens = await _lens(client, pid)
    assert _tick(_cell(lens, "SWB", "W-1")) == (True, "project")
    assert _well_row(lens, "W-1")["figures"]["counted"] == 7
    assert _project_row(lens)["figures"]["counted"] == 7
