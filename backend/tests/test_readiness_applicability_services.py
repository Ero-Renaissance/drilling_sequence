"""Checks that apply — the service layer (phase 6 of
docs/readiness-framework-spec.md, §3.7, §3.8, §4.4, §6).

What every reader computes from ``readiness_applicability`` rows: each cell's
effective ``applies`` and its source, the status-inheritance rule that goes with
it (a well inherits its field project's status only while the check applies to
the field project), the rollup (a cell that doesn't apply isn't counted), the
snapshot (recorded as N/A), the re-key (a status and its tick move as a pair),
the clone (rows copied, withdrawn checks skipped) and retire/restore (rows kept).

The rows are written with the ORM here: the applicability endpoint is the
router's, and its own tests pin who may write them.
"""
import logging
import uuid
from types import SimpleNamespace

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity
from app.models.audit import AuditLog
from app.models.readiness import (
    NA_STATUS,
    ReadinessApplicability,
    ReadinessCheck,
    ReadinessEntry,
)
from app.models.user import User
from app.services.readiness_catalog import active_checks, withdrawn_check_codes
from app.services.readiness_effective import (
    EntryIndex,
    cell_status,
    load_index,
    project_value,
    well_applies,
    well_cells,
    well_has_cell,
    well_value,
)
from app.services.readiness_rollup import in_scope, live_cells, rollup
from app.services.snapshot import build_project_snapshot

FP = "Bonga Phase 3"
ACT = "Oil Development"

# Logistics: two two-level checks and a project-only one; Wells: a well-only one.
CHECKS = (
    ("NAV", "Naval Clearance", "logistics", True, True, "ship", 10),
    ("PO", "Purchase Order", "logistics", True, True, "receipt", 20),
    ("L-PRJ", "Project Permit", "logistics", True, False, "truck", 30),
    ("LPR", "Location Preparation", "wells", False, True, "map-pin", 10),
)


# ── Fixtures ────────────────────────────────────────────────────────────────


async def _setup(client: AsyncClient, db: AsyncSession) -> str:
    """As admin: the Wells and Logistics teams and their checks, and a campaign
    with wells W-1 and W-2 under one field project."""
    await client.get("/api/projects")
    me = (await db.execute(select(User).where(User.email == "test@company.com"))).scalar_one()
    me.is_admin = True
    await db.commit()
    for code, name, icon in (("wells", "Wells", "map-pin"), ("logistics", "Logistics", "truck")):
        r = await client.post(
            "/api/admin/readiness/teams", json={"code": code, "name": name, "icon_key": icon}
        )
        assert r.status_code == 201, r.text
    for code, label, team, at_project, at_well, icon, order in CHECKS:
        r = await client.post(
            "/api/admin/readiness/checks",
            json={
                "code": code,
                "label": label,
                "team_code": team,
                "applies_project": at_project,
                "applies_well": at_well,
                "status_set": "standard",
                "icon_key": icon,
                "locks_with_plan": False,
                "sort_order": order,
            },
        )
        assert r.status_code == 201, r.text
    pid = (await client.post("/api/projects", json={"name": "Applies"})).json()["id"]
    for well in ("W-1", "W-2"):
        await _activity(client, pid, well)
    return pid


async def _activity(client: AsyncClient, pid: str, well: str, project: str | None = FP) -> dict:
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
    return r.json()


def _target(well: str | None = None, project: str = FP) -> dict:
    if well is None:
        return {"well_project": project}
    return {"scope": "well", "well_project": project, "well_name": well, "activity_type": ACT}


async def _put(client: AsyncClient, pid: str, code: str, target: dict, status: str) -> None:
    r = await client.put(f"/api/projects/{pid}/readiness/{code}", json={**target, "status": status})
    assert r.status_code == 200, r.text


def _choice(
    pid: str, code: str, *, well: str | None = None, applies: bool = False, project: str = FP
) -> ReadinessApplicability:
    """A team's choice for one target — as the applicability endpoint stores it."""
    return ReadinessApplicability(
        project_id=uuid.UUID(pid),
        check_code=code,
        scope="well" if well else "project",
        well_project=project,
        well_name=well or "",
        activity_type=ACT if well else "",
        applies=applies,
    )


async def _choose(db: AsyncSession, *rows: ReadinessApplicability) -> None:
    db.add_all(rows)
    await db.commit()


async def _check(db: AsyncSession, code: str) -> ReadinessCheck:
    return (await db.execute(select(ReadinessCheck).where(ReadinessCheck.code == code))).scalar_one()


async def _index(db: AsyncSession, pid: str, *codes: str) -> EntryIndex:
    return await load_index(db, uuid.UUID(pid), list(codes))


def _key(well: str, project: str = FP) -> tuple[str, str, str]:
    return (project, well, ACT)


async def _logistics_cells(db: AsyncSession, pid: str) -> dict[tuple[str, ...], dict[str, str]]:
    activities = (
        await db.execute(select(Activity).where(Activity.project_id == uuid.UUID(pid)))
    ).scalars().all()
    # Per well: these tests pin the well cells' rules (the tiles count field
    # projects, each folding these cells — test_readiness_project_tiles.py).
    unit, cells = await live_cells(
        db,
        uuid.UUID(pid),
        await active_checks(db, team_code="logistics"),
        [a for a in activities if in_scope(a, None)],
        unit="wells",
    )
    assert unit == "wells"
    return cells


# ── The §3.8 tables, without a database ─────────────────────────────────────


def _def(code: str = "NAV", *, project: bool = True, well: bool = True, governed: bool = False):
    return SimpleNamespace(
        code=code,
        status_set="standard",
        applies_project=project,
        applies_well=well,
        locks_with_plan=governed,
        applies_by_default=True,  # every check before phase 7 starts ticked
    )


def _row(applies: bool) -> SimpleNamespace:
    return SimpleNamespace(applies=applies)


@pytest.mark.parametrize(
    ("project_row", "well_row", "expected"),
    [
        (None, None, (True, "default")),  # every check starts ticked
        (False, None, (False, "project")),  # the well follows its field project
        (False, True, (True, "well")),  # …until it makes its own choice
        (None, False, (False, "well")),
        # A well's own choice stays, even once it matches its field project.
        (False, False, (False, "well")),
    ],
)
def test_applies_inherits_from_the_field_project_until_the_well_chooses(
    project_row: bool | None, well_row: bool | None, expected: tuple[bool, str]
) -> None:
    index = EntryIndex(
        project_applies={} if project_row is None else {(FP, "NAV"): _row(project_row)},
        well_applies={} if well_row is None else {(*_key("W-1"), "NAV"): _row(well_row)},
    )
    assert well_applies(index, _def(), _key("W-1")) == expected


def test_a_check_that_locks_with_the_plan_always_applies() -> None:
    """The Project gates use N/A, never a tick (decision 31): a stray row is
    ignored."""
    gate = _def("FID", well=False, governed=True)
    index = EntryIndex(project_applies={(FP, "FID"): _row(False)})
    assert well_applies(index, gate, _key("W-1")) == (True, "default")
    value = project_value(index, gate, FP)
    assert (value.applies, value.applies_source) == (True, "default")


def test_level_decides_where_a_choice_can_come_from() -> None:
    index = EntryIndex(
        project_applies={(FP, "LPR"): _row(False), (FP, "L-PRJ"): _row(False)},
        well_applies={(*_key("W-1"), "L-PRJ"): _row(True)},
    )
    # A well-only check has no field-project choice to follow…
    assert well_applies(index, _def("LPR", project=False), _key("W-1")) == (True, "default")
    # …and a project-only check no choice of the well's own.
    assert well_applies(index, _def("L-PRJ", well=False), _key("W-1")) == (False, "project")
    # A well with no field project has nothing to inherit.
    assert well_applies(index, _def("L-PRJ", well=False), ("", "W-1", ACT)) == (True, "default")


def test_project_only_checks_carry_nothing_on_a_well_with_no_field_project() -> None:
    project_only, both, well_only = _def(well=False), _def(), _def(project=False)
    assert not well_has_cell(project_only, "")
    assert well_has_cell(project_only, FP)
    assert well_has_cell(both, "") and well_has_cell(well_only, "")
    cells = well_cells(
        EntryIndex(), [_def("L-PRJ", well=False), _def("NAV"), _def("LPR", project=False)], ("", "W", ACT)
    )
    assert list(cells) == ["NAV", "LPR"]


def test_a_rollup_reads_n_a_for_a_check_that_does_not_apply() -> None:
    index = EntryIndex(well_applies={(*_key("W-1"), "NAV"): _row(False)})
    value = well_value(index, _def(), _key("W-1"))
    assert (value.status, value.applies) == ("On Track", False)  # the status underneath
    assert cell_status(value) == NA_STATUS
    assert cell_status(well_value(index, _def(), _key("W-2"))) == "On Track"


# ── Effective values from stored rows ───────────────────────────────────────


@pytest.mark.asyncio
async def test_unticking_keeps_the_status_and_reaches_wells_with_their_own(
    client: AsyncClient, db: AsyncSession
) -> None:
    pid = await _setup(client, db)
    po = await _check(db, "PO")
    await _put(client, pid, "PO", _target(), "Completed")
    await _put(client, pid, "PO", _target("W-2"), "Behind")

    await _choose(db, _choice(pid, "PO"))
    index = await _index(db, pid, "PO")
    project = project_value(index, po, FP)
    assert (project.status, project.source, project.applies, project.applies_source) == (
        "Completed", "project", False, "project",
    )
    # A following well doesn't apply; nor does one with its own status.
    w1, w2 = well_value(index, po, _key("W-1")), well_value(index, po, _key("W-2"))
    assert (w1.applies, w1.applies_source) == (False, "project")
    assert (w2.status, w2.source, w2.applies, w2.applies_source) == ("Behind", "well", False, "project")

    # Re-ticking brings back the status kept underneath.
    row = (await db.execute(select(ReadinessApplicability))).scalar_one()
    await db.delete(row)
    await db.commit()
    index = await _index(db, pid, "PO")
    w1 = well_value(index, po, _key("W-1"))
    assert (w1.status, w1.source, w1.applies, w1.applies_source) == (
        "Completed", "project", True, "default",
    )
    assert project_value(index, po, FP).applies is True


@pytest.mark.asyncio
async def test_a_well_ticked_under_an_unticked_field_project_reads_the_default(
    client: AsyncClient, db: AsyncSession
) -> None:
    """Spec §3.8: the field project's status is inherited only while the check
    applies to the field project — never its hidden status."""
    pid = await _setup(client, db)
    po = await _check(db, "PO")
    await _put(client, pid, "PO", _target(), "Completed")
    await _choose(db, _choice(pid, "PO"), _choice(pid, "PO", well="W-1", applies=True))

    w1 = well_value(await _index(db, pid, "PO"), po, _key("W-1"))
    assert (w1.status, w1.source, w1.applies, w1.applies_source) == (
        "On Track", "default", True, "well",
    )
    cells = await _logistics_cells(db, pid)
    assert cells[_key("W-1")]["PO"] == "On Track"
    assert cells[_key("W-2")]["PO"] == NA_STATUS  # follows the untick


@pytest.mark.asyncio
async def test_a_wells_own_choice_outlives_a_matching_project_choice(
    client: AsyncClient, db: AsyncSession
) -> None:
    pid = await _setup(client, db)
    nav = await _check(db, "NAV")
    await _choose(db, _choice(pid, "NAV", well="W-1"))
    assert well_applies(await _index(db, pid, "NAV"), nav, _key("W-1")) == (False, "well")
    # The field project changes to match: the well keeps its own choice.
    await _choose(db, _choice(pid, "NAV"))
    assert well_applies(await _index(db, pid, "NAV"), nav, _key("W-1")) == (False, "well")
    assert well_applies(await _index(db, pid, "NAV"), nav, _key("W-2")) == (False, "project")


@pytest.mark.asyncio
async def test_rows_of_another_campaign_or_check_change_nothing(
    client: AsyncClient, db: AsyncSession
) -> None:
    pid = await _setup(client, db)
    other = (await client.post("/api/projects", json={"name": "Elsewhere"})).json()["id"]
    await _activity(client, other, "W-1")
    await _choose(db, _choice(other, "NAV"), _choice(pid, "PO"))
    nav = await _check(db, "NAV")
    index = await _index(db, pid, "NAV")
    assert index.project_applies == {} and well_value(index, nav, _key("W-1")).applies


# ── Rollup: a cell that doesn't apply isn't counted (§3.7) ──────────────────


@pytest.mark.asyncio
async def test_a_cell_that_does_not_apply_is_not_counted(
    client: AsyncClient, db: AsyncSession
) -> None:
    pid = await _setup(client, db)
    await _put(client, pid, "PO", _target("W-1"), "Completed")
    # NAV doesn't apply to the field project, so to both wells; on W-2 nothing
    # applies at all.
    await _choose(
        db,
        _choice(pid, "NAV"),
        _choice(pid, "PO", well="W-2"),
        _choice(pid, "L-PRJ"),
    )
    cells = await _logistics_cells(db, pid)
    assert cells[_key("W-1")] == {"NAV": NA_STATUS, "PO": "Completed", "L-PRJ": NA_STATUS}
    assert cells[_key("W-2")] == {"NAV": NA_STATUS, "PO": NA_STATUS, "L-PRJ": NA_STATUS}

    f = rollup(cells.values())
    assert (f.targets, f.counted, f.done, f.na) == (2, 1, 1, 5)
    # W-2 reads "Nothing applies": out of the ready count, W-1 ready.
    assert (f.ready, f.ready_of, f.complete_pct) == (1, 1, 100)


@pytest.mark.asyncio
async def test_live_cells_skip_project_only_checks_without_a_field_project(
    client: AsyncClient, db: AsyncSession
) -> None:
    pid = await _setup(client, db)
    await _activity(client, pid, "LONE-1", project=None)
    # Ticked per well, with nothing to inherit.
    await _choose(db, _choice(pid, "NAV", well="LONE-1", project=""))
    cells = await _logistics_cells(db, pid)
    assert cells[("", "LONE-1", ACT)] == {"NAV": NA_STATUS, "PO": "On Track"}
    assert list(cells[_key("W-1")]) == ["NAV", "PO", "L-PRJ"]


@pytest.mark.asyncio
async def test_the_project_gates_are_unchanged(client: AsyncClient, db: AsyncSession) -> None:
    """Decision 31: a gate that doesn't apply is N/A; no row ever touches it."""
    pid = await _setup(client, db)
    await _put(client, pid, "FID", _target(), "N/A")
    await _put(client, pid, "BUD", _target(), "Completed")
    # A stray row for a gate (none is ever written) is ignored.
    await _choose(db, _choice(pid, "BUD"))
    activities = (
        await db.execute(select(Activity).where(Activity.project_id == uuid.UUID(pid)))
    ).scalars().all()
    unit, cells = await live_cells(
        db,
        uuid.UUID(pid),
        await active_checks(db, team_code="projects"),
        activities,
        unit="projects",
    )
    assert unit == "projects"
    assert cells[(FP,)]["FID"] == NA_STATUS and cells[(FP,)]["BUD"] == "Completed"


# ── Snapshot (§6) ───────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_a_snapshot_records_an_unticked_team_check_as_n_a(
    client: AsyncClient, db: AsyncSession
) -> None:
    pid = await _setup(client, db)
    await _put(client, pid, "PO", _target(), "Completed")
    await _put(client, pid, "FID", _target(), "N/A")
    await _choose(db, _choice(pid, "PO"), _choice(pid, "NAV", well="W-1"))

    rows = {a["well_name"]: a for a in await build_project_snapshot(uuid.UUID(pid), db)}
    w1, w2 = rows["W-1"]["readiness_at_submission"], rows["W-2"]["readiness_at_submission"]
    assert w1["PO"]["status"] == NA_STATUS and w1["NAV"]["status"] == NA_STATUS
    assert w2["PO"]["status"] == NA_STATUS and w2["NAV"] == {"status": "On Track", "source": "default"}
    assert w1["L-PRJ"] == {"status": "On Track", "source": "default"}
    assert w1["LPR"] == {"status": "On Track", "source": "default"}
    # No snapshot carries tags any more.
    assert all(set(item) == {"status", "source"} for item in (*w1.values(), *w2.values()))
    # The governed block is unchanged: an N/A gate is recorded as N/A.
    assert rows["W-1"]["readiness"]["FID"] == NA_STATUS
    assert rows["W-1"]["readiness"]["BUD"] == "On Track"


# ── Re-key: a status and its tick move as a pair (§4.4) ─────────────────────


async def _rename(client: AsyncClient, pid: str, aid: str, **fields) -> None:
    r = await client.patch(f"/api/projects/{pid}/activities/{aid}", json=fields)
    assert r.status_code == 200, r.text


async def _at(db: AsyncSession, pid: str, well: str, project: str = FP) -> dict[str, tuple]:
    """Per check at one well key: (its status entry, its applicability row)."""
    out: dict[str, list] = {}
    for model, slot in ((ReadinessEntry, 0), (ReadinessApplicability, 1)):
        for v in (
            await db.execute(
                select(model).where(
                    model.project_id == uuid.UUID(pid),
                    model.scope == "well",
                    model.well_project == project,
                    model.well_name == well,
                )
            )
        ).scalars():
            pair = out.setdefault(v.check_code, [None, None])
            pair[slot] = v.status if slot == 0 else v.applies
    return {code: tuple(pair) for code, pair in out.items()}


async def _rekey_events(db: AsyncSession) -> list[str]:
    return list(
        (
            await db.execute(
                select(AuditLog.new_value).where(AuditLog.field == "readiness_rekeyed")
            )
        ).scalars()
    )


@pytest.mark.asyncio
async def test_a_rename_moves_a_status_and_its_tick_together(
    client: AsyncClient, db: AsyncSession
) -> None:
    pid = await _setup(client, db)
    activities = (await client.get(f"/api/projects/{pid}/activities")).json()
    w1 = next(a for a in activities if a["well_name"] == "W-1")
    await _put(client, pid, "PO", _target("W-1"), "Behind")
    await _put(client, pid, "LPR", _target("W-1"), "Completed")
    await _choose(db, _choice(pid, "PO", well="W-1"), _choice(pid, "NAV", well="W-1", applies=True))

    await _rename(client, pid, w1["id"], well_name="W-1A")
    assert await _at(db, pid, "W-1") == {}
    assert await _at(db, pid, "W-1A") == {
        "PO": ("Behind", False),
        "NAV": (None, True),
        "LPR": ("Completed", None),
    }
    [event] = await _rekey_events(db)
    assert event.endswith("-> W-1A (Bonga Phase 3, Oil Development): LPR, NAV: applies, PO: does not apply")


@pytest.mark.asyncio
async def test_neither_half_moves_when_the_new_key_has_either(
    client: AsyncClient, db: AsyncSession, caplog: pytest.LogCaptureFixture
) -> None:
    pid = await _setup(client, db)
    activities = (await client.get(f"/api/projects/{pid}/activities")).json()
    w1 = next(a for a in activities if a["well_name"] == "W-1")
    w2 = next(a for a in activities if a["well_name"] == "W-2")
    await _put(client, pid, "PO", _target("W-1"), "Behind")
    await _put(client, pid, "NAV", _target("W-1"), "Completed")
    await _put(client, pid, "PO", _target("W-2"), "Completed")  # W-2 has PO's status…
    await _choose(
        db,
        _choice(pid, "PO", well="W-1"),
        _choice(pid, "NAV", well="W-1"),
        _choice(pid, "NAV", well="W-2", applies=True),  # …and NAV's tick
    )
    await client.delete(f"/api/projects/{pid}/activities/{w2['id']}")  # W-2's values linger

    with caplog.at_level(logging.WARNING, logger="app.services.readiness_rekey"):
        await _rename(client, pid, w1["id"], well_name="W-2")
    # Both pairs stay whole at the old key; the new key keeps what it had.
    assert await _at(db, pid, "W-1") == {"PO": ("Behind", False), "NAV": ("Completed", False)}
    assert await _at(db, pid, "W-2") == {"PO": ("Completed", None), "NAV": (None, True)}
    assert await _rekey_events(db) == []
    assert "readiness_rekey_conflict" in caplog.text and "NAV,PO" in caplog.text


@pytest.mark.asyncio
async def test_project_choices_follow_the_last_activity_out(
    client: AsyncClient, db: AsyncSession
) -> None:
    pid = await _setup(client, db)
    a1, a2 = (await client.get(f"/api/projects/{pid}/activities")).json()
    await _choose(db, _choice(pid, "NAV"))

    async def project_rows() -> dict[str, list[str]]:
        rows = (
            await db.execute(
                select(ReadinessApplicability).where(ReadinessApplicability.scope == "project")
            )
        ).scalars().all()
        return {r.well_project: [r.check_code] for r in rows}

    await _rename(client, pid, a1["id"], well_project="Bonga Phase 3B")
    assert await project_rows() == {FP: ["NAV"]}  # one activity still carries it
    await _rename(client, pid, a2["id"], well_project="Bonga Phase 3B")
    assert await project_rows() == {"Bonga Phase 3B": ["NAV"]}
    assert any(
        "field project Bonga Phase 3 -> Bonga Phase 3B: NAV: does not apply" in e
        for e in await _rekey_events(db)
    )


# ── Clone, retire and restore ───────────────────────────────────────────────


@pytest.mark.asyncio
async def test_clone_copies_choices_and_keeps_a_merely_retired_check(
    client: AsyncClient, db: AsyncSession
) -> None:
    pid = await _setup(client, db)
    await _put(client, pid, "L-PRJ", _target(), "Behind")
    await _choose(
        db,
        _choice(pid, "NAV"),
        _choice(pid, "NAV", well="W-1", applies=True),
        _choice(pid, "L-PRJ"),
    )
    # Retired, not withdrawn: it may be restored, so its values still travel.
    assert (await client.post("/api/admin/readiness/checks/L-PRJ/retire")).status_code == 200

    clone = await client.post(f"/api/projects/{pid}/clone", json={"name": "Next quarter"})
    assert clone.status_code == 201, clone.text
    cid = uuid.UUID(clone.json()["id"])
    rows = (
        await db.execute(
            select(ReadinessApplicability).where(ReadinessApplicability.project_id == cid)
        )
    ).scalars().all()
    assert sorted((r.check_code, r.scope, r.well_name, r.applies) for r in rows) == [
        ("L-PRJ", "project", "", False),
        ("NAV", "project", "", False),
        ("NAV", "well", "W-1", True),
    ]
    me = (await db.execute(select(User).where(User.email == "test@company.com"))).scalar_one()
    assert {r.updated_by for r in rows} == {me.id}
    entry = (
        await db.execute(select(ReadinessEntry).where(ReadinessEntry.project_id == cid))
    ).scalar_one()
    assert (entry.check_code, entry.status) == ("L-PRJ", "Behind")
    # The clone reads them as its source did.
    cells = await _logistics_cells(db, str(cid))
    assert cells[_key("W-1")]["NAV"] == "On Track" and cells[_key("W-2")]["NAV"] == NA_STATUS


@pytest.mark.asyncio
async def test_restore_keeps_a_pre_retirement_untick(client: AsyncClient, db: AsyncSession) -> None:
    pid = await _setup(client, db)
    await _put(client, pid, "NAV", _target(), "Completed")
    await _choose(db, _choice(pid, "NAV"))
    assert (await client.post("/api/admin/readiness/checks/NAV/retire")).status_code == 200
    assert "NAV" not in (await _logistics_cells(db, pid))[_key("W-1")]

    assert (await client.post("/api/admin/readiness/checks/NAV/restore")).status_code == 200
    cells = await _logistics_cells(db, pid)
    assert cells[_key("W-1")]["NAV"] == NA_STATUS  # still unticked
    nav = await _check(db, "NAV")
    assert project_value(await _index(db, pid, "NAV"), nav, FP).status == "Completed"


@pytest.mark.asyncio
async def test_withdrawn_checks_are_never_in_use(client: AsyncClient, db: AsyncSession) -> None:
    """A history-only status set or a tag list withdraws a check (spec §4.4),
    retired or not; a check merely retired isn't withdrawn."""
    await _setup(client, db)
    for code, status_set, tag_list in (
        ("AVL", "availability", ""),
        ("TAG", "standard", "equipment"),
        ("NEQ", "availability", "equipment"),
    ):
        db.add(
            ReadinessCheck(
                code=code,
                label=code,
                team_code="logistics",
                applies_project=True,
                applies_well=True,
                status_set=status_set,
                icon_key="truck",
                locks_with_plan=False,
                tag_list=tag_list,
            )
        )
    await db.commit()
    assert (await client.post("/api/admin/readiness/checks/PO/retire")).status_code == 200

    assert await withdrawn_check_codes(db) == {"AVL", "TAG", "NEQ"}
    assert [c.code for c in await active_checks(db, team_code="logistics")] == ["NAV", "L-PRJ"]
    assert [c.code for c in await active_checks(db, governed=False)] == ["LPR", "NAV", "L-PRJ"]
