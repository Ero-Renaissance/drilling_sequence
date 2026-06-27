"""Tests for the two-stage review → approval workflow.

Roles in these tests: test@ (client) is the planner/creator; other@ (other_client)
is the designated reviewer; third@ (third_client) is the designated approver.
The creator can sign neither stage of their own plan (separation of duties).
"""
import pytest
from httpx import AsyncClient


async def _project(client: AsyncClient, name: str = "Review Project") -> str:
    pid = (await client.post("/api/projects", json={"name": name})).json()["id"]
    r = await client.post(
        f"/api/projects/{pid}/activities",
        json={
            "activity_type": "Drilling",
            "start_date": "2026-01-01",
            "end_date": "2026-03-31",
            "well_name": "Well-1",
            "location": "OFFSHORE",
            "plan_type": "Firm",
            "risk": "No Flood Risk",
        },
    )
    assert r.status_code == 201, r.text
    return pid


async def _add(client: AsyncClient, pid: str, kind: str, email: str) -> dict:
    r = await client.post(
        f"/api/projects/{pid}/{kind}", json={"email": email, "role_label": kind[:-1]}
    )
    assert r.status_code == 201, r.text
    return r.json()


async def _set_policy(client: AsyncClient, pid: str, policy: str) -> None:
    r = await client.patch(f"/api/projects/{pid}", json={"review_policy": policy})
    assert r.status_code == 200, r.text
    assert r.json()["review_policy"] == policy


# ── Reviewer matrix CRUD ─────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_reviewer_crud_and_isolation_from_approvers(client: AsyncClient) -> None:
    pid = await _project(client)
    # The same email can be both a reviewer and an approver — independent lists.
    await _add(client, pid, "reviewers", "rev@company.com")
    await _add(client, pid, "approvers", "rev@company.com")

    reviewers = (await client.get(f"/api/projects/{pid}/reviewers")).json()
    approvers = (await client.get(f"/api/projects/{pid}/approvers")).json()
    assert [r["email"] for r in reviewers] == ["rev@company.com"]
    assert [a["email"] for a in approvers] == ["rev@company.com"]


@pytest.mark.asyncio
async def test_duplicate_reviewer_returns_409(client: AsyncClient) -> None:
    pid = await _project(client)
    await _add(client, pid, "reviewers", "dup@company.com")
    r = await client.post(
        f"/api/projects/{pid}/reviewers", json={"email": "dup@company.com"}
    )
    assert r.status_code == 409


@pytest.mark.asyncio
async def test_reviewer_endpoints_planner_gated(
    client: AsyncClient, other_client: AsyncClient
) -> None:
    pid = await _project(client)
    # other@ is not a member at all → forbidden on add/list.
    assert (await other_client.get(f"/api/projects/{pid}/reviewers")).status_code == 403
    assert (
        await other_client.post(f"/api/projects/{pid}/reviewers", json={"email": "x@x.com"})
    ).status_code == 403


# ── review_policy setter ─────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_review_policy_default_and_set(client: AsyncClient) -> None:
    pid = await _project(client)
    assert (await client.get(f"/api/projects/{pid}")).json()["review_policy"] == "optional"
    await _set_policy(client, pid, "required")
    await _set_policy(client, pid, "off")


@pytest.mark.asyncio
async def test_review_policy_invalid_rejected(client: AsyncClient) -> None:
    pid = await _project(client)
    r = await client.patch(f"/api/projects/{pid}", json={"review_policy": "sometimes"})
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_review_policy_change_is_audited(client: AsyncClient) -> None:
    pid = await _project(client)
    await _set_policy(client, pid, "required")
    audit = (await client.get(f"/api/projects/{pid}/audit")).json()
    entry = next(
        (e for e in audit if e["field"] == "review_policy_changed"), None
    )
    assert entry is not None
    assert "required" in entry["new_value"]


@pytest.mark.asyncio
async def test_review_policy_setter_denied_to_viewer(
    client: AsyncClient, other_client: AsyncClient
) -> None:
    pid = await _project(client)
    # other@ is not a member → can't change the policy.
    r = await other_client.patch(f"/api/projects/{pid}", json={"review_policy": "off"})
    assert r.status_code == 403


# ── Submit routing ───────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_optional_policy_routes_to_review_when_requested(
    client: AsyncClient,
) -> None:
    pid = await _project(client)
    await _add(client, pid, "reviewers", "other@company.com")
    r = await client.post(f"/api/projects/{pid}/revisions", json={"request_review": True})
    assert r.status_code == 201, r.text
    data = r.json()
    assert data["status"] == "pending_review"
    assert data["stage"] == "review"
    assert data["review_required"] is True
    assert data["review_skipped"] is False


@pytest.mark.asyncio
async def test_optional_policy_skips_review_by_default(
    client: AsyncClient,
) -> None:
    pid = await _project(client)
    await _add(client, pid, "approvers", "other@company.com")
    r = await client.post(f"/api/projects/{pid}/revisions", json={})
    data = r.json()
    assert data["status"] == "pending_approval"
    assert data["review_required"] is False
    assert data["review_skipped"] is True  # review was available but skipped


@pytest.mark.asyncio
async def test_required_policy_forces_review(client: AsyncClient) -> None:
    pid = await _project(client)
    await _set_policy(client, pid, "required")
    await _add(client, pid, "reviewers", "other@company.com")
    # Even without request_review, the policy forces the review stage.
    r = await client.post(f"/api/projects/{pid}/revisions", json={})
    data = r.json()
    assert data["status"] == "pending_review"
    assert data["review_skipped"] is False


@pytest.mark.asyncio
async def test_off_policy_forbids_review(client: AsyncClient) -> None:
    pid = await _project(client)
    await _set_policy(client, pid, "off")
    await _add(client, pid, "approvers", "other@company.com")
    # request_review is ignored when the policy is off.
    r = await client.post(f"/api/projects/{pid}/revisions", json={"request_review": True})
    data = r.json()
    assert data["status"] == "pending_approval"
    assert data["review_required"] is False
    assert data["review_skipped"] is False  # review wasn't an option, not "skipped"


@pytest.mark.asyncio
async def test_required_policy_without_reviewer_blocks_submit(client: AsyncClient) -> None:
    pid = await _project(client)
    await _set_policy(client, pid, "required")
    # No reviewers configured → review could never complete → submit blocked.
    r = await client.post(f"/api/projects/{pid}/revisions", json={})
    assert r.status_code == 409


# ── Review stage flow ────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_full_review_then_approval(
    client: AsyncClient, other_client: AsyncClient, third_client: AsyncClient
) -> None:
    pid = await _project(client)
    await _add(client, pid, "reviewers", "other@company.com")
    await _add(client, pid, "approvers", "third@company.com")
    rev = (
        await client.post(f"/api/projects/{pid}/revisions", json={"request_review": True})
    ).json()
    rid = rev["id"]

    # Reviewer signs → all reviewers signed → advances to approval.
    r = await other_client.put(
        f"/api/projects/{pid}/revisions/{rid}/sign-review", json={"role_label": "Subsurface"}
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["status"] == "pending_approval"
    assert data["reviewer_status"][0]["signed"] is True

    # Approver signs → approved.
    r = await third_client.put(
        f"/api/projects/{pid}/revisions/{rid}/sign", json={"role_label": "GM"}
    )
    assert r.json()["status"] == "approved"


@pytest.mark.asyncio
async def test_partial_review_stays_pending_review(
    client: AsyncClient, other_client: AsyncClient
) -> None:
    pid = await _project(client)
    await _add(client, pid, "reviewers", "other@company.com")
    await _add(client, pid, "reviewers", "third@company.com")
    await _add(client, pid, "approvers", "other@company.com")
    rev = (
        await client.post(f"/api/projects/{pid}/revisions", json={"request_review": True})
    ).json()

    r = await other_client.put(
        f"/api/projects/{pid}/revisions/{rev['id']}/sign-review",
        json={"role_label": "Reviewer"},
    )
    # third@ hasn't reviewed yet → still in review.
    assert r.json()["status"] == "pending_review"


@pytest.mark.asyncio
async def test_reviewer_requests_changes_unlocks(
    client: AsyncClient, other_client: AsyncClient
) -> None:
    pid = await _project(client)
    await _add(client, pid, "reviewers", "other@company.com")
    rev = (
        await client.post(f"/api/projects/{pid}/revisions", json={"request_review": True})
    ).json()

    r = await other_client.post(
        f"/api/projects/{pid}/revisions/{rev['id']}/review-changes",
        json={"reason": "Re-sequence the casing run before the BOP test."},
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "changes_requested"
    # Activities unlocked so the planner can revise.
    acts = (await client.get(f"/api/projects/{pid}/activities")).json()
    assert all(a["locked_by_revision_id"] is None for a in acts)


# ── Denial / separation-of-duties ────────────────────────────────────────────


@pytest.mark.asyncio
async def test_non_reviewer_cannot_sign_review(
    client: AsyncClient, third_client: AsyncClient
) -> None:
    pid = await _project(client)
    await _add(client, pid, "reviewers", "other@company.com")
    rev = (
        await client.post(f"/api/projects/{pid}/revisions", json={"request_review": True})
    ).json()
    # third@ is neither a reviewer nor an admin → forbidden.
    r = await third_client.put(
        f"/api/projects/{pid}/revisions/{rev['id']}/sign-review",
        json={"role_label": "Nope"},
    )
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_creator_cannot_sign_review_own(
    client: AsyncClient, other_client: AsyncClient
) -> None:
    pid = await _project(client)
    # test@ (creator) is also a reviewer, plus other@ keeps the stage completable.
    await _add(client, pid, "reviewers", "test@company.com")
    await _add(client, pid, "reviewers", "other@company.com")
    rev = (
        await client.post(f"/api/projects/{pid}/revisions", json={"request_review": True})
    ).json()
    r = await client.put(
        f"/api/projects/{pid}/revisions/{rev['id']}/sign-review",
        json={"role_label": "Self"},
    )
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_reviewer_cannot_reject_or_sign_approval(
    client: AsyncClient, other_client: AsyncClient
) -> None:
    """A reviewer has no approval authority: they can't terminally reject, and
    can't cast an approval signature."""
    pid = await _project(client)
    await _add(client, pid, "reviewers", "other@company.com")
    await _add(client, pid, "approvers", "third@company.com")
    rev = (
        await client.post(f"/api/projects/{pid}/revisions", json={"request_review": True})
    ).json()
    rid = rev["id"]

    # Reviewer can't reject (that's approval-stage authority).
    assert (
        await other_client.post(
            f"/api/projects/{pid}/revisions/{rid}/reject", json={"reason": "no"}
        )
    ).status_code == 403

    # Advance to approval, then the reviewer still can't cast an approval signature.
    await other_client.put(
        f"/api/projects/{pid}/revisions/{rid}/sign-review", json={"role_label": "Rev"}
    )
    assert (
        await other_client.put(
            f"/api/projects/{pid}/revisions/{rid}/sign", json={"role_label": "x"}
        )
    ).status_code == 403


@pytest.mark.asyncio
async def test_sign_review_rejected_when_not_in_review(
    client: AsyncClient, other_client: AsyncClient
) -> None:
    pid = await _project(client)
    await _add(client, pid, "reviewers", "other@company.com")
    await _add(client, pid, "approvers", "third@company.com")
    # Direct-to-approval submit (no review) → pending_approval.
    rev = (await client.post(f"/api/projects/{pid}/revisions", json={})).json()
    # A reviewer trying to sign-review a non-review revision → 400.
    r = await other_client.put(
        f"/api/projects/{pid}/revisions/{rev['id']}/sign-review",
        json={"role_label": "Rev"},
    )
    assert r.status_code == 400
