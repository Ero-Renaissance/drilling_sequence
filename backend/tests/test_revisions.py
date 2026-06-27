"""Tests for Phase 6: revision snapshots and signatures."""
import json
import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.project import ProjectMember, ProjectRole
from app.models.user import User


async def _create_project(client: AsyncClient, name: str = "Rev Test Project") -> str:
    r = await client.post(
        "/api/projects",
        json={"name": name, "field": "North Sea", "region": "Offshore"},
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def _create_activity(client: AsyncClient, project_id: str, seq: int = 1) -> str:
    r = await client.post(
        f"/api/projects/{project_id}/activities",
        json={
            "activity_type": f"Activity {seq}",
            "start_date": f"2026-0{seq}-01",
            "end_date": f"2026-0{seq}-28",
            "well_name": f"Well-{seq}",
            "location": "OFFSHORE",
            "plan_type": "Firm",
            "risk": "No Flood Risk",
        },
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def _create_project_with_activities(client: AsyncClient) -> tuple[str, list[str]]:
    project_id = await _create_project(client)
    ids = [await _create_activity(client, project_id, i + 1) for i in range(2)]
    return project_id, ids


async def _add_approver(
    client: AsyncClient, project_id: str, email: str = "other@company.com"
) -> None:
    """Configure a designated approver. Defaults to other@company.com — a user
    distinct from the test@company.com creator, since the submitter can't approve
    their own revision (separation of duties)."""
    r = await client.post(
        f"/api/projects/{project_id}/approvers",
        json={"email": email, "role_label": "Approver"},
    )
    assert r.status_code == 201, r.text


@pytest.mark.asyncio
async def test_create_revision(client: AsyncClient) -> None:
    project_id, _ = await _create_project_with_activities(client)

    r = await client.post(
        f"/api/projects/{project_id}/revisions",
        json={"label": "Initial plan"},
    )
    assert r.status_code == 201, r.text
    data = r.json()
    assert data["rev_number"] == 1
    assert data["label"] == "Initial plan"
    assert data["status"] == "pending_approval"
    assert data["signatures"] == []


@pytest.mark.asyncio
async def test_create_revision_auto_label(client: AsyncClient) -> None:
    project_id, _ = await _create_project_with_activities(client)

    r = await client.post(f"/api/projects/{project_id}/revisions", json={})
    assert r.status_code == 201, r.text
    assert r.json()["label"] == "Rev. 01"


@pytest.mark.asyncio
async def test_create_revision_no_activities_fails(client: AsyncClient) -> None:
    project_id = await _create_project(client, "Empty Project")
    r = await client.post(f"/api/projects/{project_id}/revisions", json={})
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_create_revision_locks_activities(client: AsyncClient) -> None:
    project_id, _ = await _create_project_with_activities(client)

    r = await client.post(f"/api/projects/{project_id}/revisions", json={})
    revision_id = r.json()["id"]

    activities = (await client.get(f"/api/projects/{project_id}/activities")).json()
    assert all(a["locked_by_revision_id"] == revision_id for a in activities)


@pytest.mark.asyncio
async def test_cannot_create_second_pending_revision(client: AsyncClient) -> None:
    project_id, _ = await _create_project_with_activities(client)
    await client.post(f"/api/projects/{project_id}/revisions", json={})

    r = await client.post(f"/api/projects/{project_id}/revisions", json={})
    assert r.status_code == 409


@pytest.mark.asyncio
async def test_list_revisions(client: AsyncClient) -> None:
    project_id, _ = await _create_project_with_activities(client)
    await client.post(f"/api/projects/{project_id}/revisions", json={"label": "Rev A"})

    r = await client.get(f"/api/projects/{project_id}/revisions")
    assert r.status_code == 200, r.text
    revisions = r.json()
    assert len(revisions) == 1
    assert revisions[0]["label"] == "Rev A"


@pytest.mark.asyncio
async def test_get_revision_detail_has_snapshot(client: AsyncClient) -> None:
    project_id, _ = await _create_project_with_activities(client)
    create_r = await client.post(f"/api/projects/{project_id}/revisions", json={})
    revision_id = create_r.json()["id"]

    r = await client.get(f"/api/projects/{project_id}/revisions/{revision_id}")
    assert r.status_code == 200, r.text
    data = r.json()
    assert "snapshot_json" in data
    snapshot = json.loads(data["snapshot_json"])
    assert len(snapshot) == 2
    assert snapshot[0]["activity_type"] == "Activity 1"


@pytest.mark.asyncio
async def test_sign_revision_approves_and_keeps_plan_locked(
    client: AsyncClient, other_client: AsyncClient
) -> None:
    project_id, _ = await _create_project_with_activities(client)
    await _add_approver(client, project_id)  # other@company.com signs
    create_r = await client.post(f"/api/projects/{project_id}/revisions", json={})
    revision_id = create_r.json()["id"]

    r = await other_client.put(
        f"/api/projects/{project_id}/revisions/{revision_id}/sign",
        json={"role_label": "Project Manager"},
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["status"] == "approved"
    assert len(data["signatures"]) == 1
    assert data["signatures"][0]["role_label"] == "Project Manager"
    assert data["signatures"][0]["user_name"] == "Other User"

    # Plan stays LOCKED on approval (model B) — frozen until Revise Plan reopens it.
    activities = (await client.get(f"/api/projects/{project_id}/activities")).json()
    assert all(a["locked_by_revision_id"] == revision_id for a in activities)


@pytest.mark.asyncio
async def test_sign_revision_twice_returns_409(
    client: AsyncClient, other_client: AsyncClient
) -> None:
    project_id, _ = await _create_project_with_activities(client)
    # Two approvers so the first signature leaves the revision pending (not yet
    # fully approved), letting the second signature hit the duplicate guard.
    await _add_approver(client, project_id, email="other@company.com")
    await _add_approver(client, project_id, email="third@company.com")
    create_r = await client.post(f"/api/projects/{project_id}/revisions", json={})
    revision_id = create_r.json()["id"]

    first = await other_client.put(
        f"/api/projects/{project_id}/revisions/{revision_id}/sign",
        json={"role_label": "Manager"},
    )
    assert first.json()["status"] == "pending_approval"
    r = await other_client.put(
        f"/api/projects/{project_id}/revisions/{revision_id}/sign",
        json={"role_label": "Manager"},
    )
    assert r.status_code == 409


@pytest.mark.asyncio
async def test_discard_revision_unlocks_activities(client: AsyncClient) -> None:
    project_id, _ = await _create_project_with_activities(client)
    create_r = await client.post(f"/api/projects/{project_id}/revisions", json={})
    revision_id = create_r.json()["id"]

    r = await client.delete(f"/api/projects/{project_id}/revisions/{revision_id}")
    assert r.status_code == 204

    activities = (await client.get(f"/api/projects/{project_id}/activities")).json()
    assert all(a["locked_by_revision_id"] is None for a in activities)


@pytest.mark.asyncio
async def test_discard_approved_revision_fails(
    client: AsyncClient, other_client: AsyncClient
) -> None:
    project_id, _ = await _create_project_with_activities(client)
    await _add_approver(client, project_id)
    create_r = await client.post(f"/api/projects/{project_id}/revisions", json={})
    revision_id = create_r.json()["id"]

    await other_client.put(
        f"/api/projects/{project_id}/revisions/{revision_id}/sign",
        json={"role_label": "Manager"},
    )
    r = await client.delete(f"/api/projects/{project_id}/revisions/{revision_id}")
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_rev_number_increments(
    client: AsyncClient, other_client: AsyncClient
) -> None:
    project_id, _ = await _create_project_with_activities(client)
    await _add_approver(client, project_id)

    r1 = await client.post(f"/api/projects/{project_id}/revisions", json={})
    rev1_id = r1.json()["id"]
    await other_client.put(
        f"/api/projects/{project_id}/revisions/{rev1_id}/sign",
        json={"role_label": "Manager"},
    )

    r2 = await client.post(f"/api/projects/{project_id}/revisions", json={})
    assert r2.status_code == 201, r2.text
    assert r2.json()["rev_number"] == 2
    assert r2.json()["label"] == "Rev. 02"


# ── RBAC: non-members are denied ────────────────────────────────────────────


@pytest.mark.asyncio
async def test_non_member_cannot_access_revisions(
    client: AsyncClient, other_client: AsyncClient
) -> None:
    project_id, _ = await _create_project_with_activities(client)
    create_r = await client.post(f"/api/projects/{project_id}/revisions", json={})
    revision_id = create_r.json()["id"]

    # Other User is not a member of this project → every endpoint is forbidden
    assert (await other_client.get(f"/api/projects/{project_id}/revisions")).status_code == 403
    assert (
        await other_client.get(f"/api/projects/{project_id}/revisions/{revision_id}")
    ).status_code == 403
    assert (
        await other_client.post(f"/api/projects/{project_id}/revisions", json={})
    ).status_code == 403
    assert (
        await other_client.delete(f"/api/projects/{project_id}/revisions/{revision_id}")
    ).status_code == 403
    assert (
        await other_client.post(
            f"/api/projects/{project_id}/revisions/{revision_id}/reject",
            json={"reason": "no"},
        )
    ).status_code == 403
    assert (
        await other_client.post(
            f"/api/projects/{project_id}/revisions/{revision_id}/request-changes",
            json={"reason": "no"},
        )
    ).status_code == 403


@pytest.mark.asyncio
async def test_designated_signer_can_read_without_membership(
    client: AsyncClient, other_client: AsyncClient
) -> None:
    """A designated approver/reviewer is matched by email and is NOT a project
    member, yet must be able to open the project + its revisions to review/approve
    them — read goes through assert_can_view, not assert_member."""
    project_id, _ = await _create_project_with_activities(client)
    await _add_approver(client, project_id)  # other@company.com — an email-only signer
    create_r = await client.post(f"/api/projects/{project_id}/revisions", json={})
    revision_id = create_r.json()["id"]

    proj = await other_client.get(f"/api/projects/{project_id}")
    assert proj.status_code == 200, proj.text

    revs = await other_client.get(f"/api/projects/{project_id}/revisions")
    assert revs.status_code == 200, revs.text

    one = await other_client.get(f"/api/projects/{project_id}/revisions/{revision_id}")
    assert one.status_code == 200, one.text
    assert one.json()["id"] == revision_id


@pytest.mark.asyncio
async def test_outsider_cannot_read_project_or_revisions(
    client: AsyncClient, third_client: AsyncClient
) -> None:
    """A user who is neither a member nor a designated signer is still denied read
    (the broadened access admits signers only, not the whole world)."""
    project_id, _ = await _create_project_with_activities(client)
    assert (await third_client.get(f"/api/projects/{project_id}")).status_code == 403
    assert (await third_client.get(f"/api/projects/{project_id}/revisions")).status_code == 403


# ── Reject / request-changes workflow ───────────────────────────────────────


@pytest.mark.asyncio
async def test_reject_revision_unlocks_and_records_reason(
    client: AsyncClient, other_client: AsyncClient
) -> None:
    project_id, _ = await _create_project_with_activities(client)
    await _add_approver(client, project_id)  # other@ can decide; test@ is the creator
    create_r = await client.post(f"/api/projects/{project_id}/revisions", json={})
    revision_id = create_r.json()["id"]

    r = await other_client.post(
        f"/api/projects/{project_id}/revisions/{revision_id}/reject",
        json={"reason": "Dates conflict with rig availability"},
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["status"] == "rejected"
    assert data["decision_reason"] == "Dates conflict with rig availability"
    assert data["decision_by_name"] == "Other User"
    assert data["decision_at"] is not None

    # Activities unlocked
    activities = (await client.get(f"/api/projects/{project_id}/activities")).json()
    assert all(a["locked_by_revision_id"] is None for a in activities)


@pytest.mark.asyncio
async def test_request_changes_reopens_for_new_revision(
    client: AsyncClient, other_client: AsyncClient
) -> None:
    project_id, _ = await _create_project_with_activities(client)
    await _add_approver(client, project_id)
    create_r = await client.post(f"/api/projects/{project_id}/revisions", json={})
    revision_id = create_r.json()["id"]

    r = await other_client.post(
        f"/api/projects/{project_id}/revisions/{revision_id}/request-changes",
        json={"reason": "Please add the casing run activity"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "changes_requested"
    assert r.json()["decision_reason"] == "Please add the casing run activity"

    # No longer pending → planner can create a fresh revision
    r2 = await client.post(f"/api/projects/{project_id}/revisions", json={})
    assert r2.status_code == 201
    assert r2.json()["rev_number"] == 2


@pytest.mark.asyncio
async def test_reject_requires_reason(
    client: AsyncClient, other_client: AsyncClient
) -> None:
    project_id, _ = await _create_project_with_activities(client)
    await _add_approver(client, project_id)
    create_r = await client.post(f"/api/projects/{project_id}/revisions", json={})
    revision_id = create_r.json()["id"]

    r = await other_client.post(
        f"/api/projects/{project_id}/revisions/{revision_id}/reject",
        json={"reason": ""},
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_cannot_reject_already_decided_revision(
    client: AsyncClient, other_client: AsyncClient
) -> None:
    project_id, _ = await _create_project_with_activities(client)
    await _add_approver(client, project_id)
    create_r = await client.post(f"/api/projects/{project_id}/revisions", json={})
    revision_id = create_r.json()["id"]

    await other_client.post(
        f"/api/projects/{project_id}/revisions/{revision_id}/reject",
        json={"reason": "first"},
    )
    r = await other_client.post(
        f"/api/projects/{project_id}/revisions/{revision_id}/reject",
        json={"reason": "again"},
    )
    assert r.status_code == 400


# ── Separation of duties + signing authority (the tightened rules) ──────────


@pytest.mark.asyncio
async def test_creator_cannot_sign_own_revision(
    client: AsyncClient, other_client: AsyncClient
) -> None:
    """Even when the creator is also a designated approver, they can't sign their
    own revision (separation of duties). A second approver keeps submit valid."""
    project_id, _ = await _create_project_with_activities(client)
    await _add_approver(client, project_id, email="test@company.com")  # the creator
    await _add_approver(client, project_id, email="other@company.com")
    create_r = await client.post(f"/api/projects/{project_id}/revisions", json={})
    revision_id = create_r.json()["id"]

    r = await client.put(
        f"/api/projects/{project_id}/revisions/{revision_id}/sign",
        json={"role_label": "Approver"},
    )
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_creator_cannot_be_sole_approver_at_submit(client: AsyncClient) -> None:
    """If the only configured approver is the submitter, submit is blocked —
    otherwise the revision could never be approved."""
    project_id, _ = await _create_project_with_activities(client)
    await _add_approver(client, project_id, email="test@company.com")  # creator only
    r = await client.post(f"/api/projects/{project_id}/revisions", json={})
    assert r.status_code == 409


@pytest.mark.asyncio
async def test_non_approver_member_cannot_sign(
    client: AsyncClient,
    other_client: AsyncClient,
    third_client: AsyncClient,
    db: AsyncSession,
) -> None:
    """Membership no longer grants signing rights — only designated approvers
    (or admins) may sign. third@ is a planner member but not an approver."""
    project_id, _ = await _create_project_with_activities(client)
    await _add_approver(client, project_id)  # other@ is the approver

    # Make third@ a project member (planner) but NOT a designated approver.
    await third_client.get("/api/projects")  # materialize the user row
    third = (
        await db.execute(select(User).where(User.email == "third@company.com"))
    ).scalar_one()
    db.add(
        ProjectMember(
            project_id=uuid.UUID(project_id),
            user_id=third.id,
            role=ProjectRole.planner,
        )
    )
    await db.commit()

    create_r = await client.post(f"/api/projects/{project_id}/revisions", json={})
    revision_id = create_r.json()["id"]

    r = await third_client.put(
        f"/api/projects/{project_id}/revisions/{revision_id}/sign",
        json={"role_label": "Planner"},
    )
    assert r.status_code == 403


# ── Document integrity fingerprint (printed "Document ID") ─────────────────────


@pytest.mark.asyncio
async def test_integrity_digest_is_stable_hex(client: AsyncClient) -> None:
    """The printed Document ID is a 64-char SHA-256 hex, reproducible across reads
    because it derives only from the immutable snapshot + signature set."""
    project_id, _ = await _create_project_with_activities(client)
    create_r = await client.post(f"/api/projects/{project_id}/revisions", json={})
    revision_id = create_r.json()["id"]
    digest = create_r.json()["integrity_digest"]

    assert len(digest) == 64
    assert all(c in "0123456789abcdef" for c in digest)

    again = (
        await client.get(f"/api/projects/{project_id}/revisions/{revision_id}")
    ).json()
    assert again["integrity_digest"] == digest


@pytest.mark.asyncio
async def test_integrity_digest_differs_by_content(client: AsyncClient) -> None:
    """Different content fingerprints differently — tampering with the sequence on
    a printed document would not match the system's Document ID."""
    p1, _ = await _create_project_with_activities(client)
    p2 = await _create_project(client, "Other Rev Project")
    await _create_activity(client, p2, 5)

    d1 = (await client.post(f"/api/projects/{p1}/revisions", json={})).json()[
        "integrity_digest"
    ]
    d2 = (await client.post(f"/api/projects/{p2}/revisions", json={})).json()[
        "integrity_digest"
    ]
    assert d1 != d2


@pytest.mark.asyncio
async def test_integrity_digest_changes_when_signed(
    client: AsyncClient, other_client: AsyncClient
) -> None:
    """A cast approval is bound into the fingerprint, so the approval set on the
    printed document can't be altered without changing the Document ID."""
    project_id, _ = await _create_project_with_activities(client)
    await _add_approver(client, project_id)
    create_r = await client.post(f"/api/projects/{project_id}/revisions", json={})
    revision_id = create_r.json()["id"]
    before = create_r.json()["integrity_digest"]

    signed = await other_client.put(
        f"/api/projects/{project_id}/revisions/{revision_id}/sign",
        json={"role_label": "Approver"},
    )
    assert signed.status_code == 200, signed.text
    assert signed.json()["integrity_digest"] != before
