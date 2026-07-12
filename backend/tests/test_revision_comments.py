"""Revision deliberation thread: who may post, when, and who can see it.

The thread exists so a reviewer/approver can record context WITHOUT ending the
pending state (signing carries no text; a decision reason only exists on
reject/request-changes). Posting is participant-only and pending-only; reading
is org-wide, before and after resolution — the thread is part of the record.
"""
import pytest
from httpx import AsyncClient


async def _pending_revision(client: AsyncClient) -> tuple[str, str]:
    """(project_id, revision_id) with approvers other@/third@ and a revision
    sitting pending_approval, created by test@ (the planner)."""
    r = await client.post("/api/projects", json={"name": "Discussion"})
    project_id = r.json()["id"]
    await client.post(
        f"/api/projects/{project_id}/activities",
        json={
            "activity_type": "Oil Development",
            "start_date": "2026-01-01",
            "end_date": "2026-03-01",
            "well_name": "W-1",
            "location": "LAND",
            "plan_type": "Firm",
            "risk": "No Flood Risk",
        },
    )
    for email in ("other@company.com", "third@company.com"):
        await client.post(f"/api/projects/{project_id}/approvers", json={"email": email})
    r = await client.post(f"/api/projects/{project_id}/revisions", json={})
    assert r.status_code == 201, r.text
    return project_id, r.json()["id"]


def _url(project_id: str, revision_id: str) -> str:
    return f"/api/projects/{project_id}/revisions/{revision_id}/comments"


@pytest.mark.asyncio
async def test_signer_can_comment_without_deciding_and_everyone_sees_it(
    client: AsyncClient, other_client: AsyncClient, noplan_client: AsyncClient
) -> None:
    project_id, revision_id = await _pending_revision(client)

    # A designated approver records context — the revision STAYS pending.
    r = await other_client.post(
        _url(project_id, revision_id),
        json={"body": "Checked the swamp lanes; waiting on LLI confirmation."},
    )
    assert r.status_code == 201, r.text
    posted = r.json()
    assert posted["author_role"] == "Approver"
    assert posted["stage"] == "approval"
    revs = (await client.get(f"/api/projects/{project_id}/revisions")).json()
    assert revs[0]["status"] == "pending_approval"

    # The planner (creator) can reply.
    r = await client.post(_url(project_id, revision_id), json={"body": "LLI confirmed."})
    assert r.status_code == 201, r.text
    assert r.json()["author_role"] == "Planner"

    # Org-wide visibility: a user with NO role anywhere sees the thread.
    r = await noplan_client.get(_url(project_id, revision_id))
    assert r.status_code == 200, r.text
    assert [c["body"] for c in r.json()] == [
        "Checked the swamp lanes; waiting on LLI confirmation.",
        "LLI confirmed.",
    ]


@pytest.mark.asyncio
async def test_only_participants_may_post(
    client: AsyncClient, noplan_client: AsyncClient
) -> None:
    project_id, revision_id = await _pending_revision(client)
    r = await noplan_client.post(_url(project_id, revision_id), json={"body": "hi"})
    assert r.status_code == 403, r.text


@pytest.mark.asyncio
async def test_thread_closes_on_resolution_but_stays_visible(
    client: AsyncClient, other_client: AsyncClient, third_client: AsyncClient,
    noplan_client: AsyncClient,
) -> None:
    project_id, revision_id = await _pending_revision(client)
    r = await other_client.post(
        _url(project_id, revision_id), json={"body": "Approving — assumptions look right."}
    )
    assert r.status_code == 201, r.text

    # Both approvers sign → approved.
    for signer in (other_client, third_client):
        r = await signer.put(
            f"/api/projects/{project_id}/revisions/{revision_id}/sign", json={"attested": True}
        )
        assert r.status_code == 200, r.text

    # Posting is over (the record is frozen with the decision context intact)…
    r = await other_client.post(_url(project_id, revision_id), json={"body": "late"})
    assert r.status_code == 409, r.text
    # …but the thread remains org-wide readable, attached to the approved record.
    r = await noplan_client.get(_url(project_id, revision_id))
    assert r.status_code == 200
    assert [c["body"] for c in r.json()] == ["Approving — assumptions look right."]


@pytest.mark.asyncio
async def test_reviewer_comments_during_review_stage(
    client: AsyncClient, other_client: AsyncClient
) -> None:
    r = await client.post("/api/projects", json={"name": "ReviewTalk"})
    project_id = r.json()["id"]
    await client.post(
        f"/api/projects/{project_id}/activities",
        json={
            "activity_type": "Oil Development",
            "start_date": "2026-01-01",
            "end_date": "2026-03-01",
            "well_name": "W-1",
            "location": "LAND",
            "plan_type": "Firm",
            "risk": "No Flood Risk",
        },
    )
    await client.post(
        f"/api/projects/{project_id}/reviewers", json={"email": "other@company.com"}
    )
    await client.post(
        f"/api/projects/{project_id}/approvers", json={"email": "third@company.com"}
    )
    r = await client.post(
        f"/api/projects/{project_id}/revisions", json={"request_review": True}
    )
    assert r.status_code == 201, r.text
    revision_id = r.json()["id"]
    assert r.json()["status"] == "pending_review"

    r = await other_client.post(
        _url(project_id, revision_id), json={"body": "Subsurface inputs verified."}
    )
    assert r.status_code == 201, r.text
    assert r.json()["author_role"] == "Reviewer"
    assert r.json()["stage"] == "review"


@pytest.mark.asyncio
async def test_comment_bounds_and_bola(client: AsyncClient) -> None:
    project_id, revision_id = await _pending_revision(client)
    assert (
        await client.post(_url(project_id, revision_id), json={"body": ""})
    ).status_code == 422
    assert (
        await client.post(_url(project_id, revision_id), json={"body": "x" * 2001})
    ).status_code == 422

    # BOLA: the revision must belong to the project in the path.
    r2 = await client.post("/api/projects", json={"name": "Other project"})
    other_project = r2.json()["id"]
    assert (
        await client.get(_url(other_project, revision_id))
    ).status_code == 404
    assert (
        await client.post(_url(other_project, revision_id), json={"body": "x"})
    ).status_code == 404
