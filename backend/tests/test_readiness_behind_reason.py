"""Behind needs a reason (2026-11-26, every team).

A check can't be saved as BEHIND without saying why: the note sent with the
status is the reason, free text, and only has to be non-blank.

- becoming behind (a new value, or a well taking its own where it only followed
  its field project's) must carry a reason — 422 otherwise, nothing written;
- while behind, the reason can be reworded, never blanked; a save that sends no
  note keeps it — so a check that was behind with no reason before this rule
  stays as it is until its next change;
- leaving behind clears the reason from the entry (unless a note is sent); the
  audit trail keeps what it was;
- a well that follows a behind field project shows the project's reason;
- the audit event carries the reason's text; a revision records it;
- who may write is unchanged, and authorization still comes first.
"""
import json
import uuid

import pytest
from httpx import AsyncClient, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.readiness import ReadinessEntry
from app.services.snapshot import build_project_snapshot
from tests.test_readiness_equipment_checks import (
    FP,
    PROJECT,
    _campaign,
    _catalog,
    _cell,
    _details,
    _lens,
    _make_admin,
    _setup,
    _well,
)

REQUIRED = "Say why it is behind: a reason is required"
UPDATED = "readiness_updated"


async def _status(
    client: AsyncClient, pid: str, code: str, target: dict, status: str, **extra: object
) -> Response:
    """A raw status PUT — ``notes`` is sent only when given."""
    return await client.put(
        f"/api/projects/{pid}/readiness/{code}", json={**target, "status": status, **extra}
    )


async def _entries(db: AsyncSession, pid: str) -> list[tuple]:
    rows = (
        await db.execute(select(ReadinessEntry).where(ReadinessEntry.project_id == uuid.UUID(pid)))
    ).scalars().all()
    return sorted((r.check_code, r.scope, r.well_name, r.status, r.notes) for r in rows)


# ── Becoming behind ─────────────────────────────────────────────────────────


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("code", "target"),
    [("FID", PROJECT), ("FID", _well("W-1")), ("PO", PROJECT), ("PO", _well("W-1"))],
    ids=["gate-project", "gate-well", "logistics-project", "logistics-well"],
)
async def test_behind_is_refused_without_a_reason_on_every_team(
    client: AsyncClient, db: AsyncSession, code: str, target: dict
) -> None:
    pid = await _setup(client, db, [])
    # No note, a null note, an empty one, or only spaces: none is a reason.
    for extra in ({}, {"notes": None}, {"notes": ""}, {"notes": "   \n "}):
        r = await _status(client, pid, code, target, "Behind", **extra)
        assert (r.status_code, r.json()["detail"]) == (422, REQUIRED), extra
    assert await _entries(db, pid) == []
    assert await _details(db, pid, UPDATED) == []

    r = await _status(client, pid, code, target, "Behind", notes="Rig slot moved to Q2")
    assert r.status_code == 200, r.text
    assert (r.json()["status"], r.json()["notes"]) == ("Behind", "Rig slot moved to Q2")
    (event,) = await _details(db, pid, UPDATED)
    assert event.endswith("-> Behind; reason: Rig slot moved to Q2")


@pytest.mark.asyncio
async def test_no_other_status_needs_a_reason(client: AsyncClient, db: AsyncSession) -> None:
    pid = await _setup(client, db, [])
    for status in ("Not started", "On Track", "Completed", "N/A"):
        assert (await _status(client, pid, "FID", PROJECT, status)).status_code == 200, status
    for status in ("On Track", "Completed"):
        assert (await _status(client, pid, "PO", PROJECT, status)).status_code == 200, status
    # A note stays optional there, and is still a plain note in the trail.
    r = await _status(client, pid, "PO", PROJECT, "Completed", notes="10k")
    assert r.status_code == 200 and r.json()["notes"] == "10k"
    assert (await _details(db, pid, UPDATED))[-1].endswith("Completed -> Completed; notes changed")


@pytest.mark.asyncio
async def test_a_well_follows_its_projects_reason_and_needs_its_own_to_differ(
    client: AsyncClient, db: AsyncSession
) -> None:
    pid = await _setup(client, db, [])
    assert (
        await _status(client, pid, "PO", PROJECT, "Behind", notes="Vendor not yet awarded")
    ).status_code == 200
    lens = await _lens(client, pid)
    w1 = _cell(lens, "PO", "W-1")
    # The well shows its field project's status AND its reason.
    assert (w1["status"], w1["source"], w1["notes"]) == ("Behind", "project", "Vendor not yet awarded")

    # Picking Behind on the well makes the value its own: it needs its own reason.
    r = await _status(client, pid, "PO", _well("W-1"), "Behind")
    assert (r.status_code, r.json()["detail"]) == (422, REQUIRED)
    r = await _status(client, pid, "PO", _well("W-1"), "Behind", notes="Its PO is disputed")
    assert r.status_code == 200
    lens = await _lens(client, pid)
    assert _cell(lens, "PO", "W-1")["notes"] == "Its PO is disputed"
    assert _cell(lens, "PO", "W-2")["notes"] == "Vendor not yet awarded"  # still follows

    # Reset to project: the well follows the project's status and reason again.
    reset = await client.post(f"/api/projects/{pid}/readiness/PO/reset", json=_well("W-1"))
    assert reset.status_code == 200, reset.text
    assert _cell(await _lens(client, pid), "PO", "W-1")["notes"] == "Vendor not yet awarded"


# ── While behind ────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_while_behind_the_reason_can_change_but_not_be_blanked(
    client: AsyncClient, db: AsyncSession
) -> None:
    pid = await _setup(client, db, [])
    assert (await _status(client, pid, "FID", PROJECT, "Behind", notes="Board slipped")).status_code == 200

    # The same status with no note keeps the reason — and isn't a change.
    r = await _status(client, pid, "FID", PROJECT, "Behind")
    assert r.status_code == 200 and r.json()["notes"] == "Board slipped"
    assert len(await _details(db, pid, UPDATED)) == 1
    # Blanking it is refused.
    for blank in (None, "", "  "):
        r = await _status(client, pid, "FID", PROJECT, "Behind", notes=blank)
        assert (r.status_code, r.json()["detail"]) == (422, REQUIRED), blank
    assert (await _entries(db, pid))[0][-1] == "Board slipped"
    # Rewording it is a change, audited with the new text.
    r = await _status(client, pid, "FID", PROJECT, "Behind", notes="Board slipped to Q3")
    assert r.status_code == 200 and r.json()["notes"] == "Board slipped to Q3"
    assert (await _details(db, pid, UPDATED))[-1] == (
        f"FID for {FP}: Behind -> Behind; reason: Board slipped to Q3"
    )


@pytest.mark.asyncio
async def test_a_check_behind_before_the_rule_stays_as_it_is_until_its_next_change(
    client: AsyncClient, db: AsyncSession
) -> None:
    pid = await _setup(client, db, [])
    # As stored before 2026-11-26: behind, no note.
    db.add(
        ReadinessEntry(
            project_id=uuid.UUID(pid), check_code="PO", scope="project", well_project=FP,
            well_name="", activity_type="", status="Behind", notes=None,
        )  # fmt: skip
    )
    await db.commit()
    cell = _cell(await _lens(client, pid), "PO")
    assert (cell["status"], cell["notes"]) == ("Behind", None)

    # Saving what it already is — a dialog that saves every check — is fine.
    assert (await _status(client, pid, "PO", PROJECT, "Behind")).status_code == 200
    assert await _details(db, pid, UPDATED) == []
    # A revision can still be submitted over it; it just records no reason.
    rows = await build_project_snapshot(uuid.UUID(pid), db)
    w1 = next(a for a in rows if a["well_name"] == "W-1")
    assert w1["readiness_at_submission"]["PO"] == {"status": "Behind", "source": "project"}
    # Touching the note needs a real reason; giving one, or moving on, works.
    assert (await _status(client, pid, "PO", PROJECT, "Behind", notes="")).status_code == 422
    assert (
        await _status(client, pid, "PO", PROJECT, "Behind", notes="Now explained")
    ).status_code == 200
    assert (await _status(client, pid, "PO", PROJECT, "On Track")).status_code == 200


# ── Leaving behind ──────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_leaving_behind_clears_the_reason_and_the_trail_keeps_it(
    client: AsyncClient, db: AsyncSession
) -> None:
    pid = await _setup(client, db, [])
    assert (await _status(client, pid, "PO", PROJECT, "Behind", notes="Vendor late")).status_code == 200

    r = await _status(client, pid, "PO", PROJECT, "On Track")
    assert r.status_code == 200 and r.json()["notes"] is None
    assert _cell(await _lens(client, pid), "PO")["notes"] is None
    assert (await _details(db, pid, UPDATED))[-1] == (
        f"PO for {FP}: Behind -> On Track; no longer behind - reason was: Vendor late"
    )
    # Behind again later: the old reason isn't reused — a new one is asked for.
    assert (await _status(client, pid, "PO", PROJECT, "Behind")).status_code == 422


@pytest.mark.asyncio
async def test_leaving_behind_with_a_note_keeps_that_note(
    client: AsyncClient, db: AsyncSession
) -> None:
    pid = await _setup(client, db, [])
    assert (await _status(client, pid, "PO", PROJECT, "Behind", notes="Vendor late")).status_code == 200
    r = await _status(client, pid, "PO", PROJECT, "Completed", notes="Delivered 12 Nov")
    assert r.status_code == 200 and r.json()["notes"] == "Delivered 12 Nov"
    # The reason it replaces is still on record, with the event that ends it.
    assert (await _details(db, pid, UPDATED))[-1] == (
        f"PO for {FP}: Behind -> Completed; no longer behind - reason was: Vendor late; notes changed"
    )


# ── Who, and locks ──────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_authorization_comes_before_the_reason_rule(
    client: AsyncClient, other_client: AsyncClient, noplan_client: AsyncClient, db: AsyncSession
) -> None:
    await _make_admin(client, db)
    await _catalog(db, [])
    pid = await _campaign(other_client)  # other@ plans it, without a Logistics grant
    # Someone who may not write the check is told 403 — with or without a
    # reason — never the validation message.
    for denied, code in ((noplan_client, "PO"), (other_client, "PO"), (noplan_client, "FID")):
        for extra in ({}, {"notes": "A reason"}):
            r = await _status(denied, pid, code, PROJECT, "Behind", **extra)
            assert r.status_code == 403, r.text
    assert await _entries(db, pid) == []
    # The campaign's planner writes a Well Execution check — with a reason.
    assert (await _status(other_client, pid, "FID", PROJECT, "Behind")).status_code == 422
    assert (
        await _status(other_client, pid, "FID", PROJECT, "Behind", notes="FID deferred")
    ).status_code == 200


@pytest.mark.asyncio
async def test_the_rule_holds_while_the_plan_is_locked(
    client: AsyncClient, db: AsyncSession
) -> None:
    pid = await _setup(client, db, [])
    rev = await client.post(f"/api/projects/{pid}/revisions", json={})
    assert rev.status_code in (200, 201), rev.text
    assert (await _status(client, pid, "FID", PROJECT, "Behind")).status_code == 422
    r = await _status(client, pid, "FID", PROJECT, "Behind", notes="Partner approval late")
    assert r.status_code == 200
    assert (await _details(db, pid, UPDATED))[-1] == (
        f"FID for {FP}: Not started -> Behind; plan locked; reason: Partner approval late"
    )


@pytest.mark.asyncio
async def test_a_long_reason_is_kept_whole_in_the_trail(
    client: AsyncClient, db: AsyncSession
) -> None:
    pid = await _setup(client, db, [])
    reason = "r" * 512  # the longest note
    assert (await _status(client, pid, "PO", _well("W-1"), "Behind", notes=reason)).status_code == 200
    (event,) = await _details(db, pid, UPDATED)
    assert event.endswith(f"; reason: {reason}")
    assert (await _status(client, pid, "PO", _well("W-1"), "Behind", notes="r" * 513)).status_code == 422


# ── Revisions ───────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_a_revision_records_why_each_check_was_behind(
    client: AsyncClient, db: AsyncSession
) -> None:
    pid = await _setup(client, db, [])
    assert (await _status(client, pid, "FID", PROJECT, "Behind", notes="FID deferred")).status_code == 200
    assert (
        await _status(client, pid, "LLI", _well("W-2"), "Behind", notes="Wellhead lead time")
    ).status_code == 200
    assert (await _status(client, pid, "PO", PROJECT, "Behind", notes="Vendor late")).status_code == 200
    # A note on a check that isn't behind is not a reason.
    assert (await _status(client, pid, "BUD", PROJECT, "On Track", notes="10k")).status_code == 200

    rows = {a["well_name"]: a for a in await build_project_snapshot(uuid.UUID(pid), db)}
    # The Well Execution checks: plain statuses, as every reader expects, with
    # the reasons beside them — each well's effective one.
    assert rows["W-1"]["readiness"]["FID"] == "Behind"
    assert rows["W-1"]["readiness_reasons"] == {"FID": "FID deferred"}
    assert rows["W-2"]["readiness_reasons"] == {"FID": "FID deferred", "LLI": "Wellhead lead time"}
    # No field project, nothing behind: no block at all.
    assert "readiness_reasons" not in rows["LONE-1"]
    # A team's live values carry it with the status.
    assert rows["W-1"]["readiness_at_submission"]["PO"] == {
        "status": "Behind", "source": "project", "reason": "Vendor late",
    }  # fmt: skip
    assert "reason" not in rows["W-1"]["readiness_at_submission"]["CTR"]

    rev = await client.post(f"/api/projects/{pid}/revisions", json={})
    assert rev.status_code in (200, 201), rev.text
    # Later changes don't touch what was recorded.
    assert (await _status(client, pid, "FID", PROJECT, "Completed")).status_code == 200
    detail = (await client.get(f"/api/projects/{pid}/revisions/{rev.json()['id']}")).json()
    stored = {a["well_name"]: a for a in json.loads(detail["snapshot_json"])}
    assert stored["W-1"]["readiness_reasons"] == {"FID": "FID deferred"}
    assert stored["W-1"]["readiness_at_submission"]["PO"]["reason"] == "Vendor late"


# ── The trail never loses a reason (PR 39 review) ───────────────────────────


@pytest.mark.asyncio
async def test_a_note_already_on_the_entry_is_written_out_when_it_becomes_the_reason(
    client: AsyncClient, db: AsyncSession
) -> None:
    """The note's text doesn't change — the status does — so the event must
    still say why the check is behind."""
    pid = await _setup(client, db, [])
    assert (
        await _status(client, pid, "PO", PROJECT, "On Track", notes="Awaiting quote")
    ).status_code == 200
    assert (
        await _status(client, pid, "PO", PROJECT, "Behind", notes="Awaiting quote")
    ).status_code == 200
    assert (await _details(db, pid, UPDATED))[-1] == (
        f"PO for {FP}: On Track -> Behind; reason: Awaiting quote"
    )


@pytest.mark.asyncio
async def test_a_well_leaving_the_behind_it_followed_records_the_reason_it_showed(
    client: AsyncClient, db: AsyncSession
) -> None:
    """W-1 follows its field project's Behind and its reason. Giving the well
    its own On Track ends that for the well: the event names the reason the
    well was showing, though the well never stored it."""
    pid = await _setup(client, db, [])
    assert (
        await _status(client, pid, "PO", PROJECT, "Behind", notes="Vendor not awarded")
    ).status_code == 200
    assert (await _status(client, pid, "PO", _well("W-1"), "On Track")).status_code == 200
    assert (await _details(db, pid, UPDATED))[-1] == (
        f"PO for W-1 ({FP}, Oil Development): Behind -> On Track; "
        "no longer behind - reason was: Vendor not awarded"
    )
    # The field project — and the well still following it — keep the reason.
    lens = await _lens(client, pid)
    assert _cell(lens, "PO")["notes"] == "Vendor not awarded"
    assert _cell(lens, "PO", "W-2")["notes"] == "Vendor not awarded"
    assert _cell(lens, "PO", "W-1")["notes"] is None

    # The well takes its own Behind over the project's, with its own reason.
    assert (
        await _status(client, pid, "PO", _well("W-2"), "Behind", notes="Its PO is disputed")
    ).status_code == 200
    assert (await _details(db, pid, UPDATED))[-1] == (
        f"PO for W-2 ({FP}, Oil Development): Behind -> Behind; reason: Its PO is disputed"
    )


@pytest.mark.asyncio
async def test_leaving_a_behind_that_never_had_a_reason_is_a_plain_change(
    client: AsyncClient, db: AsyncSession
) -> None:
    pid = await _setup(client, db, [])
    db.add(
        ReadinessEntry(
            project_id=uuid.UUID(pid), check_code="PO", scope="project", well_project=FP,
            well_name="", activity_type="", status="Behind", notes=None,
        )  # fmt: skip
    )
    await db.commit()
    assert (await _status(client, pid, "PO", PROJECT, "On Track")).status_code == 200
    assert (await _details(db, pid, UPDATED))[-1] == f"PO for {FP}: Behind -> On Track"
