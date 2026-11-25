"""Equipment quantity (docs/equipment-quantity-spec.md §3).

A check that ``takes_quantity`` lets a target state HOW MANY of that type it
needs — "2 PSVs":

- a whole number 1–999, blank until someone states it; zero is not a quantity;
- a field project's number is the need of the WHOLE field project; a well shows
  it until it is given its own, and clearing the well's follows the project
  again; wells are never added together;
- who may write is who may write the check; only where the check applies (409);
  never refused under the plan lock; every real change is audited;
- no readiness figure reads it;
- it survives deselecting, follows a rename with the status and the tick, is
  copied by a clone and recorded in a revision's ``readiness_at_submission``;
- "takes a quantity" is set per check by an admin, editable later, never on a
  check that locks with the plan.
"""
import json
import uuid

import pytest
from httpx import AsyncClient, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.readiness import MAX_QUANTITY, MIN_QUANTITY, ReadinessQuantity
from app.services.readiness_effective import EntryIndex, project_quantity, well_quantity
from app.services.snapshot import build_project_snapshot
from tests.readiness_seed import EQUIPMENT_CATEGORIES, equipment_definitions, migration_041
from tests.test_readiness_equipment_checks import (
    ACT,
    FP,
    LONE,
    PROJECT,
    _apply,
    _campaign,
    _catalog,
    _cell,
    _details,
    _grant,
    _lens,
    _make_admin,
    _project_row,
    _put,
    _setup,
    _user,
    _well,
)

CHANGED = "readiness_quantity_changed"


async def _quantity(
    client: AsyncClient, pid: str, code: str, target: dict, quantity: object
) -> Response:
    return await client.put(
        f"/api/projects/{pid}/readiness/{code}/quantity", json={**target, "quantity": quantity}
    )


def _shown(cell: dict) -> tuple[int | None, str]:
    return cell["quantity"], cell["quantity_source"]


async def _stored(db: AsyncSession, pid: str) -> list[tuple]:
    rows = (
        await db.execute(
            select(ReadinessQuantity).where(ReadinessQuantity.project_id == uuid.UUID(pid))
        )
    ).scalars().all()
    return sorted((r.check_code, r.scope, r.well_project, r.well_name, r.quantity) for r in rows)


async def _selected(client: AsyncClient, db: AsyncSession, codes: list[str] | None = None) -> str:
    """A campaign whose field project has selected PSV (and any other ``codes``)."""
    codes = codes or ["PSV"]
    pid = await _setup(client, db, codes)
    r = await _apply(client, pid, PROJECT, dict.fromkeys(codes, True))
    assert r.status_code == 200, r.text
    return pid


# ── The seed ────────────────────────────────────────────────────────────────


def test_the_counted_categories_take_a_quantity_and_permits_do_not() -> None:
    counted = set(migration_041().QUANTITY_CATEGORIES)
    assert counted == {"Aviation", "Vessels", "Barges", "Land transport", "Lifting"}
    assert counted < set(EQUIPMENT_CATEGORIES.values())
    takes = {d["code"]: d["takes_quantity"] for d in equipment_definitions()}
    assert takes["PSV"] is True and takes["RW"] is True and takes["CR"] is True
    assert takes["NNRA"] is False  # Permits: held or not
    assert sum(takes.values()) == 20


# ── The rule, without a database ────────────────────────────────────────────


def test_a_check_that_takes_no_quantity_never_shows_one() -> None:
    from types import SimpleNamespace

    row = SimpleNamespace(quantity=4)
    index = EntryIndex(
        project_quantity={(FP, "X"): row}, well_quantity={(FP, "W-1", ACT, "X"): row}
    )
    plain = SimpleNamespace(
        code="X", applies_project=True, applies_well=True, locks_with_plan=False,
        applies_by_default=True, takes_quantity=False,
    )  # fmt: skip
    assert project_quantity(index, plain, FP) == (None, "default")
    assert well_quantity(index, plain, (FP, "W-1", ACT)) == (None, "default")
    # A definition from before migration 041 has no such setting: none either.
    old = SimpleNamespace(
        code="X", applies_project=True, applies_well=True, locks_with_plan=False,
        applies_by_default=True,
    )  # fmt: skip
    assert well_quantity(index, old, (FP, "W-1", ACT)) == (None, "default")


# ── Stating, following, clearing ────────────────────────────────────────────


@pytest.mark.asyncio
async def test_a_number_is_blank_until_stated_and_a_well_follows_its_field_project(
    client: AsyncClient, db: AsyncSession
) -> None:
    pid = await _selected(client, db)
    lens = await _lens(client, pid)
    # Selecting a type states no number: nothing is stamped "x1".
    assert _shown(_cell(lens, "PSV")) == (None, "default")
    assert _shown(_cell(lens, "PSV", "W-1")) == (None, "default")
    assert await _stored(db, pid) == []

    # The field project's need: each of its wells repeats it.
    r = await _quantity(client, pid, "PSV", PROJECT, 2)
    assert r.status_code == 200, r.text
    assert r.json() == {"quantity": 2, "quantity_source": "project"}
    lens = await _lens(client, pid)
    assert _shown(_cell(lens, "PSV")) == (2, "project")
    assert _shown(_cell(lens, "PSV", "W-1")) == (2, "project")
    assert _shown(_cell(lens, "PSV", "W-2")) == (2, "project")

    # A well's own number; the other well still follows.
    r = await _quantity(client, pid, "PSV", _well("W-2"), 1)
    assert r.json() == {"quantity": 1, "quantity_source": "well"}
    lens = await _lens(client, pid)
    assert _shown(_cell(lens, "PSV", "W-2")) == (1, "well")
    assert _shown(_cell(lens, "PSV", "W-1")) == (2, "project")
    assert await _stored(db, pid) == [
        ("PSV", "project", FP, "", 2),
        ("PSV", "well", FP, "W-2", 1),
    ]

    # Clearing the well's follows its field project again; clearing the field
    # project's leaves none stated.
    r = await _quantity(client, pid, "PSV", _well("W-2"), None)
    assert r.json() == {"quantity": 2, "quantity_source": "project"}
    r = await _quantity(client, pid, "PSV", PROJECT, None)
    assert r.json() == {"quantity": None, "quantity_source": "default"}
    assert await _stored(db, pid) == []

    assert await _details(db, pid, CHANGED) == [
        f"PSV for {FP}: quantity not stated -> 2",
        f"PSV for W-2 ({FP}, {ACT}): quantity 2 -> 1 (set on this well)",
        f"PSV for W-2 ({FP}, {ACT}): quantity 1 -> 2 (now follows the field project)",
        f"PSV for {FP}: quantity 2 -> not stated",
    ]


@pytest.mark.asyncio
async def test_saving_what_is_already_stored_is_not_a_change(
    client: AsyncClient, db: AsyncSession
) -> None:
    pid = await _selected(client, db)
    assert (await _quantity(client, pid, "PSV", PROJECT, 3)).status_code == 200
    assert (await _quantity(client, pid, "PSV", PROJECT, 3)).status_code == 200
    # Clearing a well that has no number of its own changes nothing either.
    r = await _quantity(client, pid, "PSV", _well("W-1"), None)
    assert r.status_code == 200 and r.json() == {"quantity": 3, "quantity_source": "project"}
    assert len(await _details(db, pid, CHANGED)) == 1
    # A well's own number equal to its field project's is still its own.
    assert (await _quantity(client, pid, "PSV", _well("W-1"), 3)).json()["quantity_source"] == "well"
    assert len(await _details(db, pid, CHANGED)) == 2


@pytest.mark.asyncio
async def test_a_well_with_no_field_project_states_its_own(
    client: AsyncClient, db: AsyncSession
) -> None:
    pid = await _setup(client, db, ["PSV"])
    assert (await _apply(client, pid, LONE, {"PSV": True})).status_code == 200
    r = await _quantity(client, pid, "PSV", LONE, 5)
    assert r.status_code == 200 and r.json() == {"quantity": 5, "quantity_source": "well"}
    r = await _quantity(client, pid, "PSV", LONE, None)
    assert r.json() == {"quantity": None, "quantity_source": "default"}
    assert (await _details(db, pid, CHANGED))[-1] == (
        f"PSV for LONE-1 (no field project, {ACT}): quantity 5 -> not stated"
    )


# ── What is refused ─────────────────────────────────────────────────────────


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "bad", [0, -1, MAX_QUANTITY + 1, "2", 2.0, 2.5, True, [], {"n": 2}], ids=repr
)
async def test_only_a_whole_number_in_range_is_a_quantity(
    client: AsyncClient, db: AsyncSession, bad: object
) -> None:
    pid = await _selected(client, db)
    assert (await _quantity(client, pid, "PSV", PROJECT, bad)).status_code == 422
    assert await _stored(db, pid) == []


@pytest.mark.asyncio
async def test_the_bounds_and_the_body_are_strict(client: AsyncClient, db: AsyncSession) -> None:
    pid = await _selected(client, db)
    url = f"/api/projects/{pid}/readiness/PSV/quantity"
    for ok in (MIN_QUANTITY, MAX_QUANTITY):
        assert (await _quantity(client, pid, "PSV", PROJECT, ok)).status_code == 200
    # ``quantity`` must be sent (null clears); an unknown field is refused.
    assert (await client.put(url, json=PROJECT)).status_code == 422
    assert (await client.put(url, json={**PROJECT, "quantity": 2, "secured": 1})).status_code == 422
    # A field project takes no well names; a well needs them.
    assert (
        await client.put(url, json={**PROJECT, "well_name": "W-1", "quantity": 2})
    ).status_code == 422
    assert (
        await client.put(url, json={"scope": "well", "well_project": FP, "quantity": 2})
    ).status_code == 422
    assert await _stored(db, pid) == [("PSV", "project", FP, "", MAX_QUANTITY)]


@pytest.mark.asyncio
async def test_only_a_check_that_takes_a_quantity_has_one(
    client: AsyncClient, db: AsyncSession
) -> None:
    pid = await _selected(client, db, ["PSV", "NNRA"])
    # A permit, a plain Logistics check and a well execution readiness check.
    for code in ("NNRA", "PO", "FID"):
        r = await _quantity(client, pid, code, PROJECT, 2)
        assert (r.status_code, r.json()["detail"]) == (422, "This readiness check takes no quantity")
    # An unknown or retired check is refused like any readiness write to one.
    assert (await _quantity(client, pid, "NOPE", PROJECT, 2)).status_code == 422
    assert (await client.post("/api/admin/readiness/checks/PSV/retire")).status_code == 200
    r = await _quantity(client, pid, "PSV", PROJECT, 2)
    assert (r.status_code, r.json()["detail"]) == (422, "Unknown or retired readiness check")
    assert await _stored(db, pid) == []


@pytest.mark.asyncio
async def test_a_quantity_needs_the_check_to_apply_and_the_target_to_exist(
    client: AsyncClient, db: AsyncSession
) -> None:
    pid = await _setup(client, db, ["PSV"])
    # Not selected: select it first, as for a status.
    for target in (PROJECT, _well("W-1"), LONE):
        r = await _quantity(client, pid, "PSV", target, 2)
        assert r.status_code == 409, target
    # A well that unticked it while its field project selected it.
    assert (await _apply(client, pid, PROJECT, {"PSV": True})).status_code == 200
    assert (await _apply(client, pid, _well("W-2"), {"PSV": False})).status_code == 200
    assert (await _quantity(client, pid, "PSV", _well("W-2"), 2)).status_code == 409
    assert (await _quantity(client, pid, "PSV", _well("W-1"), 2)).status_code == 200
    # BOLA: no inventing a number for names with no activities in this campaign.
    assert (await _quantity(client, pid, "PSV", {**PROJECT, "well_project": "Egina"}, 2)).status_code == 404
    assert (await _quantity(client, pid, "PSV", _well("W-9"), 2)).status_code == 404
    assert (await _quantity(client, str(uuid.uuid4()), "PSV", PROJECT, 2)).status_code in (403, 404)
    assert await _stored(db, pid) == [("PSV", "well", FP, "W-1", 2)]


@pytest.mark.asyncio
async def test_a_check_is_given_a_quantity_only_at_a_level_it_is_enabled_at(
    client: AsyncClient, db: AsyncSession
) -> None:
    pid = await _setup(client, db, [])
    for code, project, well in (("Q-PRJ", True, False), ("Q-WEL", False, True)):
        r = await client.post(
            "/api/admin/readiness/checks",
            json={
                "code": code, "label": f"{code} label", "team_code": "logistics",
                "applies_project": project, "applies_well": well, "status_set": "standard",
                "icon_key": "anchor", "locks_with_plan": False, "takes_quantity": True,
            },
        )  # fmt: skip
        assert r.status_code == 201, r.text
    assert (await _quantity(client, pid, "Q-PRJ", _well("W-1"), 2)).status_code == 422
    assert (await _quantity(client, pid, "Q-WEL", PROJECT, 2)).status_code == 422
    assert (await _quantity(client, pid, "Q-PRJ", PROJECT, 2)).status_code == 200
    assert (await _quantity(client, pid, "Q-WEL", _well("W-1"), 3)).status_code == 200
    lens = await _lens(client, pid)
    # A project-only check reads its field project's number on each well.
    assert _shown(_cell(lens, "Q-PRJ", "W-1")) == (2, "project")
    assert _shown(_cell(lens, "Q-WEL", "W-1")) == (3, "well")
    assert _shown(_cell(lens, "Q-WEL", "W-2")) == (None, "default")


# ── Who, and locks ──────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_only_the_teams_editors_state_a_quantity(
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
    assert (await _apply(client, pid, PROJECT, {"PSV": True})).status_code == 200

    # A non-grantee, another team's grantee and the campaign's own planner: 403,
    # on a field project and a well — to set and to clear — with nothing written.
    for denied in (noplan_client, third_client, other_client):
        for target in (PROJECT, _well("W-1")):
            for quantity in (2, None):
                r = await _quantity(denied, pid, "PSV", target, quantity)
                assert r.status_code == 403, r.text
    assert await _stored(db, pid) == []
    assert await _details(db, pid, CHANGED) == []

    # A Logistics grantee, and an admin, may.
    await _grant(client, await _user(noplan_client, db, "noplan@company.com"), ["logistics"])
    assert (await _quantity(noplan_client, pid, "PSV", PROJECT, 2)).status_code == 200
    assert (await _quantity(client, pid, "PSV", _well("W-1"), 1)).status_code == 200
    assert len(await _details(db, pid, CHANGED)) == 2


@pytest.mark.asyncio
async def test_a_quantity_stays_live_while_the_plan_is_locked(
    client: AsyncClient, db: AsyncSession
) -> None:
    pid = await _selected(client, db)
    rev = await client.post(f"/api/projects/{pid}/revisions", json={})
    assert rev.status_code in (200, 201), rev.text
    assert (await _lens(client, pid))["locked"] is True
    assert (await _quantity(client, pid, "PSV", PROJECT, 2)).status_code == 200
    assert (await _quantity(client, pid, "PSV", PROJECT, None)).status_code == 200


# ── It is information: no figure reads it ───────────────────────────────────


@pytest.mark.asyncio
async def test_a_quantity_changes_no_readiness_figure(
    client: AsyncClient, db: AsyncSession
) -> None:
    pid = await _selected(client, db)
    assert (await _put(client, pid, "PSV", PROJECT, "Behind")).status_code == 200

    async def figures() -> tuple:
        lens = await _lens(client, pid)
        tile = next(
            t
            for t in (await client.get(f"/api/projects/{pid}/dashboard")).json()["team_readiness"]
            if t["team_code"] == "logistics"
        )
        return (
            _project_row(lens)["figures"],
            [w["figures"] for w in lens["well_rows"]],
            {k: tile[k] for k in ("focus_count", "overall_pct", "on_track_pct", "behind_cells")},
        )

    before = await figures()
    assert (await _quantity(client, pid, "PSV", PROJECT, 7)).status_code == 200
    assert (await _quantity(client, pid, "PSV", _well("W-1"), 3)).status_code == 200
    assert await figures() == before


# ── Lifecycle: deselecting, renames, clones, revisions ──────────────────────


@pytest.mark.asyncio
async def test_the_number_survives_deselecting_the_type(
    client: AsyncClient, db: AsyncSession
) -> None:
    pid = await _selected(client, db)
    assert (await _quantity(client, pid, "PSV", PROJECT, 2)).status_code == 200
    # Deselecting deletes the applicability row (the check starts unticked) —
    # the number is stored apart, so it is still there...
    assert (await _apply(client, pid, PROJECT, {"PSV": False})).status_code == 200
    assert await _stored(db, pid) == [("PSV", "project", FP, "", 2)]
    assert _cell(await _lens(client, pid), "PSV")["applies"] is False
    # ...and back when the type is selected again.
    assert (await _apply(client, pid, PROJECT, {"PSV": True})).status_code == 200
    lens = await _lens(client, pid)
    assert _shown(_cell(lens, "PSV")) == (2, "project")
    assert _shown(_cell(lens, "PSV", "W-1")) == (2, "project")


@pytest.mark.asyncio
async def test_a_well_reads_the_projects_number_only_while_the_project_selects_the_type(
    client: AsyncClient, db: AsyncSession
) -> None:
    """As with the status: a well ticked under a field project that doesn't
    select the type must not surface the project's hidden number."""
    pid = await _selected(client, db)
    assert (await _quantity(client, pid, "PSV", PROJECT, 4)).status_code == 200
    assert (await _apply(client, pid, PROJECT, {"PSV": False})).status_code == 200
    assert (await _apply(client, pid, _well("W-1"), {"PSV": True})).status_code == 200
    assert _shown(_cell(await _lens(client, pid), "PSV", "W-1")) == (None, "default")


@pytest.mark.asyncio
async def test_a_rename_carries_the_number_with_the_status_and_the_tick(
    client: AsyncClient, db: AsyncSession
) -> None:
    pid = await _setup(client, db, ["PSV", "CR"])
    assert (await _apply(client, pid, _well("W-1"), {"PSV": True, "CR": True})).status_code == 200
    assert (await _quantity(client, pid, "PSV", _well("W-1"), 2)).status_code == 200
    w1 = next(
        a for a in (await client.get(f"/api/projects/{pid}/activities")).json() if a["well_name"] == "W-1"
    )
    r = await client.patch(f"/api/projects/{pid}/activities/{w1['id']}", json={"well_name": "W-1A"})
    assert r.status_code == 200, r.text
    assert await _stored(db, pid) == [("PSV", "well", FP, "W-1A", 2)]
    assert _shown(_cell(await _lens(client, pid), "PSV", "W-1A")) == (2, "well")
    (event,) = await _details(db, pid, "readiness_rekeyed")
    assert event.endswith(": CR: applies, PSV: applies, quantity 2")


@pytest.mark.asyncio
async def test_a_rename_onto_a_name_that_has_any_part_moves_none(
    client: AsyncClient, db: AsyncSession
) -> None:
    """W-1 has PSV selected with a number; W-2 already has a number of its own
    for PSV. Renaming W-1 to W-2's name... is refused upstream when W-2 exists,
    so the collision is made the way it happens in practice: a stored number
    left under a name no activity carries any more."""
    pid = await _setup(client, db, ["PSV"])
    assert (await _apply(client, pid, _well("W-1"), {"PSV": True})).status_code == 200
    assert (await _quantity(client, pid, "PSV", _well("W-1"), 2)).status_code == 200
    db.add(
        ReadinessQuantity(
            project_id=uuid.UUID(pid), check_code="PSV", scope="well", well_project=FP,
            well_name="W-OLD", activity_type=ACT, quantity=9,
        )  # fmt: skip
    )
    await db.commit()
    w1 = next(
        a for a in (await client.get(f"/api/projects/{pid}/activities")).json() if a["well_name"] == "W-1"
    )
    r = await client.patch(f"/api/projects/{pid}/activities/{w1['id']}", json={"well_name": "W-OLD"})
    assert r.status_code == 200, r.text
    # The name already had a number for PSV: nothing of W-1's PSV moved — not
    # the number, and not the tick either.
    assert await _stored(db, pid) == [
        ("PSV", "well", FP, "W-1", 2),
        ("PSV", "well", FP, "W-OLD", 9),
    ]
    cell = _cell(await _lens(client, pid), "PSV", "W-OLD")
    assert (cell["applies"], cell["applies_source"]) == (False, "default")
    assert await _details(db, pid, "readiness_rekeyed") == []


@pytest.mark.asyncio
async def test_a_clone_copies_the_numbers(client: AsyncClient, db: AsyncSession) -> None:
    pid = await _selected(client, db)
    assert (await _quantity(client, pid, "PSV", PROJECT, 2)).status_code == 200
    assert (await _quantity(client, pid, "PSV", _well("W-2"), 1)).status_code == 200
    clone = await client.post(f"/api/projects/{pid}/clone", json={"name": "Next quarter"})
    assert clone.status_code == 201, clone.text
    lens = await _lens(client, clone.json()["id"])
    assert _shown(_cell(lens, "PSV")) == (2, "project")
    assert _shown(_cell(lens, "PSV", "W-1")) == (2, "project")
    assert _shown(_cell(lens, "PSV", "W-2")) == (1, "well")
    # The source keeps its own.
    assert len(await _stored(db, pid)) == 2


@pytest.mark.asyncio
async def test_a_revision_records_the_number_as_it_stood(
    client: AsyncClient, db: AsyncSession
) -> None:
    pid = await _selected(client, db, ["PSV", "CR"])
    assert (await _quantity(client, pid, "PSV", PROJECT, 2)).status_code == 200
    assert (await _quantity(client, pid, "PSV", _well("W-2"), 1)).status_code == 200
    rows = {a["well_name"]: a for a in await build_project_snapshot(uuid.UUID(pid), db)}
    assert rows["W-1"]["readiness_at_submission"]["PSV"] == {
        "status": "On Track", "source": "default", "quantity": 2,
    }  # fmt: skip
    assert rows["W-2"]["readiness_at_submission"]["PSV"]["quantity"] == 1
    # Selected with no number stated: no ``quantity`` key at all.
    assert "quantity" not in rows["W-1"]["readiness_at_submission"]["CR"]
    # Not on LONE-1 (nothing selected there), nor on any plain check.
    assert "PSV" not in rows["LONE-1"]["readiness_at_submission"]
    assert "quantity" not in rows["W-1"]["readiness_at_submission"]["PO"]

    rev = await client.post(f"/api/projects/{pid}/revisions", json={})
    assert rev.status_code in (200, 201), rev.text
    detail = (await client.get(f"/api/projects/{pid}/revisions/{rev.json()['id']}")).json()
    stored = {a["well_name"]: a for a in json.loads(detail["snapshot_json"])}
    assert stored["W-1"]["readiness_at_submission"]["PSV"]["quantity"] == 2
    # The revision froze which checks could state a number.
    frozen = {c["code"]: c for c in detail["readiness_catalog"]}
    assert frozen["PSV"]["takes_quantity"] is True and frozen["PO"]["takes_quantity"] is False
    # A change after submission doesn't touch what was recorded.
    assert (await _quantity(client, pid, "PSV", PROJECT, 5)).status_code == 200
    detail = (await client.get(f"/api/projects/{pid}/revisions/{rev.json()['id']}")).json()
    stored = {a["well_name"]: a for a in json.loads(detail["snapshot_json"])}
    assert stored["W-1"]["readiness_at_submission"]["PSV"]["quantity"] == 2


# ── The catalog: "takes a quantity" (admin) ─────────────────────────────────


async def _catalog_events(db: AsyncSession, action: str) -> list[str]:
    from app.models.audit import AuditLog

    return list(
        (
            await db.execute(
                select(AuditLog.new_value)
                .where(AuditLog.field == action, AuditLog.project_id.is_(None))
                .order_by(AuditLog.timestamp)
            )
        ).scalars()
    )


CHECK = {
    "code": "FLT", "label": "Forklift", "team_code": "logistics", "applies_project": True,
    "applies_well": True, "status_set": "standard", "icon_key": "forklift",
    "locks_with_plan": False, "category": "Lifting", "applies_by_default": False,
}  # fmt: skip


@pytest.mark.asyncio
async def test_an_admin_sets_takes_a_quantity_at_creation_and_it_is_audited(
    client: AsyncClient, db: AsyncSession
) -> None:
    await _setup(client, db, [])
    r = await client.post("/api/admin/readiness/checks", json={**CHECK, "takes_quantity": True})
    assert r.status_code == 201, r.text
    assert r.json()["takes_quantity"] is True
    (event,) = await _catalog_events(db, "readiness_check_created")
    # Worded ahead of the category, so "; starts unticked" stays the ending
    # migration 039's re-upgrade reads.
    assert event.endswith("stays live; takes a quantity; category Lifting; starts unticked")
    # The public catalog says so; a check created without it takes none.
    r = await client.post("/api/admin/readiness/checks", json={**CHECK, "code": "FLT2"})
    assert r.status_code == 201 and r.json()["takes_quantity"] is False
    catalog = {c["code"]: c for c in (await client.get("/api/readiness/catalog")).json()["checks"]}
    assert (catalog["FLT"]["takes_quantity"], catalog["FLT2"]["takes_quantity"]) == (True, False)
    assert catalog["FID"]["takes_quantity"] is False
    # Strict: "true" or 1 is a 422, never coerced into the setting.
    for bad in ("true", 1):
        r = await client.post(
            "/api/admin/readiness/checks", json={**CHECK, "code": "FLT3", "takes_quantity": bad}
        )
        assert r.status_code == 422, bad


@pytest.mark.asyncio
async def test_a_check_that_locks_with_the_plan_takes_no_quantity(
    client: AsyncClient, db: AsyncSession
) -> None:
    await _setup(client, db, [])
    governed = {
        "code": "GOV", "label": "Governed", "team_code": "projects", "applies_project": True,
        "applies_well": True, "status_set": "execution", "icon_key": "stamp",
        "locks_with_plan": True, "takes_quantity": True,
    }  # fmt: skip
    assert (await client.post("/api/admin/readiness/checks", json=governed)).status_code == 422
    r = await client.patch("/api/admin/readiness/checks/FID", json={"takes_quantity": True})
    assert (r.status_code, r.json()["detail"]) == (
        422, "A check that locks with the plan takes no quantity",
    )  # fmt: skip
    # False is what it has: nothing changes, nothing is audited.
    r = await client.patch("/api/admin/readiness/checks/FID", json={"takes_quantity": False})
    assert r.status_code == 200 and r.json()["takes_quantity"] is False
    assert await _catalog_events(db, "readiness_check_updated") == []


@pytest.mark.asyncio
async def test_turning_it_off_hides_the_numbers_and_keeps_them(
    client: AsyncClient, db: AsyncSession
) -> None:
    pid = await _selected(client, db)
    assert (await _quantity(client, pid, "PSV", PROJECT, 2)).status_code == 200

    r = await client.patch("/api/admin/readiness/checks/PSV", json={"takes_quantity": False})
    assert r.status_code == 200 and r.json()["takes_quantity"] is False
    lens = await _lens(client, pid)
    assert _shown(_cell(lens, "PSV")) == (None, "default")
    assert _shown(_cell(lens, "PSV", "W-1")) == (None, "default")
    assert (await _quantity(client, pid, "PSV", PROJECT, 3)).status_code == 422
    assert await _stored(db, pid) == [("PSV", "project", FP, "", 2)]  # kept
    rows = {a["well_name"]: a for a in await build_project_snapshot(uuid.UUID(pid), db)}
    assert "quantity" not in rows["W-1"]["readiness_at_submission"]["PSV"]

    # Saving the same setting again is not a change.
    assert (
        await client.patch("/api/admin/readiness/checks/PSV", json={"takes_quantity": False})
    ).status_code == 200
    r = await client.patch("/api/admin/readiness/checks/PSV", json={"takes_quantity": True})
    assert r.status_code == 200
    assert _shown(_cell(await _lens(client, pid), "PSV", "W-1")) == (2, "project")
    assert await _catalog_events(db, "readiness_check_updated") == [
        "Updated readiness check PSV: no longer takes a quantity",
        "Updated readiness check PSV: takes a quantity",
    ]


@pytest.mark.asyncio
async def test_only_an_admin_changes_the_setting(
    client: AsyncClient, other_client: AsyncClient, db: AsyncSession
) -> None:
    await _setup(client, db, ["PSV"])
    r = await other_client.patch("/api/admin/readiness/checks/PSV", json={"takes_quantity": False})
    assert r.status_code == 403
    r = await other_client.post("/api/admin/readiness/checks", json={**CHECK, "takes_quantity": True})
    assert r.status_code == 403
    assert await _catalog_events(db, "readiness_check_updated") == []

