"""Server-side enforcement of the revision lock: while a revision is awaiting
approval its activities are frozen, so the plan can't change out from under the
approvers. The lock clears on approve / discard.
"""

import io

import pytest
from httpx import AsyncClient

CSV = "Activity Type,Start Date,End Date\nOil Well Drilling,2026-01-01,2026-02-01\n"


async def _project_with_activity(client: AsyncClient) -> tuple[str, str]:
    project = (await client.post("/api/projects", json={"name": "Lock Test"})).json()
    activity = (
        await client.post(
            f"/api/projects/{project['id']}/activities",
            json={
                "activity_type": "Oil Well Drilling",
                "start_date": "2026-01-01",
                "end_date": "2026-02-01",
                "well_name": "Well-1",
                "well_project": "Lock Project",
                "location": "OFFSHORE",
                "plan_type": "Firm",
                "risk": "No Flood Risk",
            },
        )
    ).json()
    return project["id"], activity["id"]


async def _create_revision(client: AsyncClient, project_id: str) -> str:
    r = await client.post(f"/api/projects/{project_id}/revisions", json={})
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


@pytest.mark.asyncio
async def test_cannot_edit_complete_or_delete_locked_activity(client: AsyncClient) -> None:
    project_id, activity_id = await _project_with_activity(client)
    await _create_revision(client, project_id)  # locks the activity

    base = f"/api/projects/{project_id}/activities/{activity_id}"
    assert (await client.patch(base, json={"well_name": "Changed"})).status_code == 423
    assert (await client.post(f"{base}/complete")).status_code == 423
    assert (await client.delete(base)).status_code == 423


@pytest.mark.asyncio
async def test_cannot_import_while_revision_pending(client: AsyncClient) -> None:
    project_id, _ = await _project_with_activity(client)
    await _create_revision(client, project_id)

    r = await client.post(
        f"/api/projects/{project_id}/activities/import",
        files={"file": ("a.csv", io.BytesIO(CSV.encode()), "text/csv")},
    )
    assert r.status_code == 423


@pytest.mark.asyncio
async def test_cannot_create_activity_while_revision_pending(client: AsyncClient) -> None:
    """Adding an activity mutates the plan, so it is barred while a revision is
    pending — the live plan can't diverge from the snapshot under approval. It is
    allowed again once the revision is discarded."""
    project_id, _ = await _project_with_activity(client)
    revision_id = await _create_revision(client, project_id)

    new_activity = {
        "activity_type": "Oil Well Drilling",
        "start_date": "2026-03-01",
        "end_date": "2026-04-01",
        "well_name": "Well-2",
        "location": "OFFSHORE",
        "plan_type": "Firm",
        "risk": "No Flood Risk",
    }
    blocked = await client.post(
        f"/api/projects/{project_id}/activities", json=new_activity
    )
    assert blocked.status_code == 423

    discard = await client.delete(f"/api/projects/{project_id}/revisions/{revision_id}")
    assert discard.status_code == 204

    assert (
        await client.post(f"/api/projects/{project_id}/activities", json=new_activity)
    ).status_code == 201


@pytest.mark.asyncio
async def test_edit_allowed_after_revision_discarded(client: AsyncClient) -> None:
    project_id, activity_id = await _project_with_activity(client)
    revision_id = await _create_revision(client, project_id)

    base = f"/api/projects/{project_id}/activities/{activity_id}"
    assert (await client.patch(base, json={"well_name": "Nope"})).status_code == 423

    discard = await client.delete(f"/api/projects/{project_id}/revisions/{revision_id}")
    assert discard.status_code == 204

    ok = await client.patch(base, json={"well_name": "Now Editable"})
    assert ok.status_code == 200
    assert ok.json()["well_name"] == "Now Editable"


@pytest.mark.asyncio
async def test_readiness_upsert_locked_then_unlocked(client: AsyncClient) -> None:
    project_id, _activity_id = await _project_with_activity(client)
    revision_id = await _create_revision(client, project_id)

    # Readiness is per FIELD PROJECT now — the gate freezes with the plan.
    url = f"/api/projects/{project_id}/readiness/Lock Project/BUD"
    assert (await client.put(url, json={"status": "On Track"})).status_code == 423

    discard = await client.delete(f"/api/projects/{project_id}/revisions/{revision_id}")
    assert discard.status_code == 204

    assert (await client.put(url, json={"status": "On Track"})).status_code == 200


@pytest.mark.asyncio
async def test_readiness_list_reports_locked(client: AsyncClient) -> None:
    """The readiness list flags each row as locked while a revision is pending, so
    the grid can disable the dots up front; the flag clears once resolved."""
    project_id, _ = await _project_with_activity(client)
    revision_id = await _create_revision(client, project_id)

    locked = (await client.get(f"/api/projects/{project_id}/readiness")).json()
    assert locked and all(row["locked"] for row in locked)

    await client.delete(f"/api/projects/{project_id}/revisions/{revision_id}")
    unlocked = (await client.get(f"/api/projects/{project_id}/readiness")).json()
    assert unlocked and not any(row["locked"] for row in unlocked)


@pytest.mark.asyncio
async def test_contract_edit_locked_then_unlocked(client: AsyncClient) -> None:
    """Rig-contract edits are captured in the snapshot (via its expiry), so they're
    frozen while a revision is pending and allowed again once it's resolved."""
    project_id, _ = await _project_with_activity(client)
    revision_id = await _create_revision(client, project_id)

    url = f"/api/projects/{project_id}/contracts/RigAlpha"
    payload = {"contract_end": "2027-06-30"}
    assert (await client.put(url, json=payload)).status_code == 423

    discard = await client.delete(f"/api/projects/{project_id}/revisions/{revision_id}")
    assert discard.status_code == 204

    assert (await client.put(url, json=payload)).status_code == 200


@pytest.mark.asyncio
async def test_approved_plan_frozen_until_revised(
    client: AsyncClient, other_client: AsyncClient
) -> None:
    """Model B: approval FREEZES the plan (the snapshot is the record); a planner
    must Revise Plan (reopen) to edit it for the next cycle."""
    project_id, activity_id = await _project_with_activity(client)
    # other@ is the approver — the creator can't approve their own plan.
    await client.post(
        f"/api/projects/{project_id}/approvers",
        json={"email": "other@company.com", "role_label": "Approver"},
    )
    revision_id = await _create_revision(client, project_id)

    base = f"/api/projects/{project_id}/activities/{activity_id}"
    assert (await client.patch(base, json={"well_name": "Nope"})).status_code == 423

    signed = await other_client.put(
        f"/api/projects/{project_id}/revisions/{revision_id}/sign",
        json={"role_label": "Manager", "attested": True},
    )
    assert signed.status_code == 200
    assert signed.json()["status"] == "approved"

    # Still frozen after approval — no silent edits to an approved plan.
    assert (await client.patch(base, json={"well_name": "Nope"})).status_code == 423

    # Revise Plan reopens it for the next cycle.
    assert (await client.post(f"/api/projects/{project_id}/revisions/reopen")).status_code == 204

    ok = await client.patch(base, json={"well_name": "Editable After Revise"})
    assert ok.status_code == 200
    assert ok.json()["well_name"] == "Editable After Revise"


@pytest.mark.asyncio
async def test_reopen_requires_an_approved_plan(client: AsyncClient) -> None:
    """Revise Plan is only valid when the plan is frozen by an APPROVED revision."""
    project_id, _ = await _project_with_activity(client)
    # Draft — nothing locked.
    assert (await client.post(f"/api/projects/{project_id}/revisions/reopen")).status_code == 409
    # Pending revision — resolve it through its own workflow, not reopen.
    await _create_revision(client, project_id)
    assert (await client.post(f"/api/projects/{project_id}/revisions/reopen")).status_code == 409


@pytest.mark.asyncio
async def test_reopen_denied_for_non_planner(
    client: AsyncClient, other_client: AsyncClient
) -> None:
    """Reopen is a write — a designated approver who isn't a project member can't do it."""
    project_id, _ = await _project_with_activity(client)
    await client.post(
        f"/api/projects/{project_id}/approvers",
        json={"email": "other@company.com", "role_label": "Approver"},
    )
    revision_id = await _create_revision(client, project_id)
    await other_client.put(
        f"/api/projects/{project_id}/revisions/{revision_id}/sign",
        json={"role_label": "Manager", "attested": True},
    )
    # other@ approved it but is not a member → cannot reopen the plan.
    assert (
        await other_client.post(f"/api/projects/{project_id}/revisions/reopen")
    ).status_code in (403, 404)


@pytest.mark.asyncio
async def test_project_lock_summary_tracks_lifecycle(
    client: AsyncClient, other_client: AsyncClient
) -> None:
    """The project detail's `lock` summary drives the Revise Plan banner: draft →
    pending → approved (frozen) → draft."""
    project_id, _ = await _project_with_activity(client)
    await client.post(
        f"/api/projects/{project_id}/approvers",
        json={"email": "other@company.com", "role_label": "Approver"},
    )

    async def lock() -> dict:
        return (await client.get(f"/api/projects/{project_id}")).json()["lock"]

    assert (await lock())["locked"] is False

    revision_id = await _create_revision(client, project_id)
    pending = await lock()
    assert pending["locked"] and pending["reason"] == "pending"

    await other_client.put(
        f"/api/projects/{project_id}/revisions/{revision_id}/sign",
        json={"role_label": "Manager", "attested": True},
    )
    approved = await lock()
    assert approved["locked"] and approved["reason"] == "approved"

    await client.post(f"/api/projects/{project_id}/revisions/reopen")
    assert (await lock())["locked"] is False


@pytest.mark.asyncio
async def test_project_detail_carries_the_approval_summary(
    client: AsyncClient, other_client: AsyncClient
) -> None:
    """The campaign header chip reads GET /projects/{id}.approval: "draft"
    before any revision, signature progress while pending, then approved."""
    project_id, _ = await _project_with_activity(client)

    detail = (await client.get(f"/api/projects/{project_id}")).json()
    assert detail["approval"] == {
        "status": "draft", "rev_number": None, "rev_label": None,
        "signed": 0, "approvers": 0, "your_action": None,
    }

    await client.post(
        f"/api/projects/{project_id}/approvers",
        json={"email": "other@company.com", "role_label": "Approver"},
    )
    revision_id = await _create_revision(client, project_id)

    pending = (await client.get(f"/api/projects/{project_id}")).json()["approval"]
    assert pending["status"] == "pending_approval"
    assert pending["rev_number"] == 1
    assert (pending["signed"], pending["approvers"]) == (0, 1)

    signed = await other_client.put(
        f"/api/projects/{project_id}/revisions/{revision_id}/sign",
        json={"role_label": "Manager", "attested": True},
    )
    assert signed.status_code == 200

    approved = (await client.get(f"/api/projects/{project_id}")).json()["approval"]
    assert approved["status"] == "approved"
    assert approved["rev_number"] == 1


async def test_your_action_flags_only_eligible_non_creator_signers(
    client: AsyncClient, other_client: AsyncClient
) -> None:
    """The signer banner's server-side gate: the pending revision's designated
    approver sees your_action="approve"; the CREATOR — even though an admin in
    the dev fixture — sees None (separation of duties)."""
    project_id, _ = await _project_with_activity(client)
    await client.post(
        f"/api/projects/{project_id}/approvers",
        json={"email": "other@company.com", "role_label": "Approver"},
    )
    await _create_revision(client, project_id)

    creator_view = (await client.get(f"/api/projects/{project_id}")).json()["approval"]
    assert creator_view["your_action"] is None

    signer_view = (await other_client.get(f"/api/projects/{project_id}")).json()["approval"]
    assert signer_view["your_action"] == "approve"


async def test_key_notes_planner_only_lock_gated_and_audited(
    client: AsyncClient, other_client: AsyncClient
) -> None:
    """Key notes (the Overview bulletin): planner-writable, refused for
    non-members, frozen with the plan lock, cleared by an empty body, and
    each write leaves an activity-log entry."""
    project_id, _ = await _project_with_activity(client)

    saved = await client.put(
        f"/api/projects/{project_id}/key-notes",
        json={"body": "- RIG_2 renewal in negotiation\n- Q3 spuds exposed"},
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["updated_by_name"]

    detail = (await client.get(f"/api/projects/{project_id}")).json()
    assert detail["key_notes"]["body"].startswith("- RIG_2")

    # Not a member (org-wide READ only) → denied the write.
    denied = await other_client.put(
        f"/api/projects/{project_id}/key-notes", json={"body": "nope"}
    )
    assert denied.status_code == 403

    # Locked with the plan: pending revision → 423.
    await client.post(
        f"/api/projects/{project_id}/approvers",
        json={"email": "other@company.com", "role_label": "Approver"},
    )
    await _create_revision(client, project_id)
    locked = await client.put(
        f"/api/projects/{project_id}/key-notes", json={"body": "changed story"}
    )
    assert locked.status_code == 423

    audit = (await client.get(f"/api/projects/{project_id}/audit")).json()
    assert any(e["field"] == "key_notes_updated" for e in audit)


@pytest.mark.asyncio
async def test_submit_blocked_while_frozen_by_approved(
    client: AsyncClient, other_client: AsyncClient
) -> None:
    """An approved freeze reopens ONLY through Revise Plan (audited). Creating
    a new revision straight over it would steal the approved lock and, via
    discard, unlock the plan with no plan_reopened event — refused 409."""
    project_id, _activity_id = await _project_with_activity(client)
    await client.post(
        f"/api/projects/{project_id}/approvers",
        json={"email": "other@company.com", "role_label": "Approver"},
    )
    revision_id = await _create_revision(client, project_id)
    signed = await other_client.put(
        f"/api/projects/{project_id}/revisions/{revision_id}/sign",
        json={"role_label": "Manager", "attested": True},
    )
    assert signed.status_code == 200
    assert signed.json()["status"] == "approved"

    # Frozen by the approved revision → submit is refused, pointing at Revise Plan.
    r = await client.post(f"/api/projects/{project_id}/revisions", json={})
    assert r.status_code == 409, r.text
    assert "Revise Plan" in r.json()["detail"]

    # The audited reopen path unfreezes; submitting then works again.
    assert (await client.post(f"/api/projects/{project_id}/revisions/reopen")).status_code == 204
    r = await client.post(f"/api/projects/{project_id}/revisions", json={})
    assert r.status_code == 201, r.text


@pytest.mark.asyncio
async def test_reopened_plan_reads_revising_not_approved(
    client: AsyncClient, other_client: AsyncClient
) -> None:
    """After Revise Plan, the campaign must not present as (still) Approved —
    the header chip and the Campaigns-list card both read "revising"."""
    project_id, _ = await _project_with_activity(client)
    await client.post(
        f"/api/projects/{project_id}/approvers",
        json={"email": "other@company.com", "role_label": "Approver"},
    )
    revision_id = await _create_revision(client, project_id)
    signed = await other_client.put(
        f"/api/projects/{project_id}/revisions/{revision_id}/sign",
        json={"role_label": "Manager", "attested": True},
    )
    assert signed.status_code == 200

    # Frozen-by-approved: both the detail and the list say approved.
    assert (await client.get(f"/api/projects/{project_id}")).json()["approval"]["status"] == "approved"
    listed = next(
        p for p in (await client.get("/api/projects")).json() if p["id"] == project_id
    )
    assert listed["approval"]["status"] == "approved"
    assert listed["approval"]["rev_number"] == 1

    # Revise Plan → live edits in flight → "revising" everywhere.
    assert (await client.post(f"/api/projects/{project_id}/revisions/reopen")).status_code == 204
    assert (await client.get(f"/api/projects/{project_id}")).json()["approval"]["status"] == "revising"
    listed = next(
        p for p in (await client.get("/api/projects")).json() if p["id"] == project_id
    )
    assert listed["approval"]["status"] == "revising"


@pytest.mark.asyncio
async def test_campaign_list_carries_summaries_and_clone_lineage(
    client: AsyncClient,
) -> None:
    """The Campaigns-list cards read plan state + lineage straight off the list
    response — a draft campaign, and a clone naming its source."""
    project_id, _ = await _project_with_activity(client)
    r = await client.post(
        f"/api/projects/{project_id}/clone", json={"name": "Q2 drilling sequence"}
    )
    assert r.status_code == 201, r.text
    clone_id = r.json()["id"]

    listed = {p["id"]: p for p in (await client.get("/api/projects")).json()}
    assert listed[project_id]["approval"]["status"] == "draft"
    assert listed[clone_id]["approval"]["status"] == "draft"
    assert listed[clone_id]["cloned_from_name"] is not None
    assert listed[project_id]["cloned_from_name"] is None
