"""Tests for configurable approvers and approver-aware sign flow."""
import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from tests.conftest import OTHER_USER_ID, THIRD_USER_ID


async def _setup(client: AsyncClient) -> tuple[str, str]:
    """Return (project_id, revision_id) with 2 configured approvers and a pending
    revision. The creator (test@company.com) is deliberately NOT an approver —
    they can't sign their own plan — so the two approvers are other@ and third@.
    """
    # project
    r = await client.post("/api/projects", json={"name": "Approver Test Project"})
    assert r.status_code == 201
    project_id = r.json()["id"]

    # activity so we can create a revision
    await client.post(
        f"/api/projects/{project_id}/activities",
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

    # Configure required approvers (both distinct from the creator)
    await client.post(
        f"/api/projects/{project_id}/approvers",
        json={"email": "other@company.com", "name": "Other User", "role_label": "Project Manager"},
    )
    await client.post(
        f"/api/projects/{project_id}/approvers",
        json={"email": "third@company.com", "name": "Third User", "role_label": "HSE Manager"},
    )

    # revision
    r = await client.post(f"/api/projects/{project_id}/revisions", json={})
    assert r.status_code == 201
    revision_id = r.json()["id"]

    return project_id, revision_id


# ── Approver CRUD ─────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_add_approver(client: AsyncClient) -> None:
    r = await client.post("/api/projects", json={"name": "P"})
    project_id = r.json()["id"]

    r = await client.post(
        f"/api/projects/{project_id}/approvers",
        json={"email": "alice@company.com", "name": "Alice", "role_label": "Manager"},
    )
    assert r.status_code == 201
    data = r.json()
    assert data["email"] == "alice@company.com"
    assert data["role_label"] == "Manager"


@pytest.mark.asyncio
async def test_email_is_lowercased(client: AsyncClient) -> None:
    r = await client.post("/api/projects", json={"name": "P"})
    project_id = r.json()["id"]

    r = await client.post(
        f"/api/projects/{project_id}/approvers",
        json={"email": "Alice@Company.COM"},
    )
    assert r.status_code == 201
    assert r.json()["email"] == "alice@company.com"


@pytest.mark.asyncio
async def test_duplicate_email_returns_409(client: AsyncClient) -> None:
    r = await client.post("/api/projects", json={"name": "P"})
    project_id = r.json()["id"]

    await client.post(
        f"/api/projects/{project_id}/approvers", json={"email": "dup@company.com"}
    )
    r = await client.post(
        f"/api/projects/{project_id}/approvers", json={"email": "dup@company.com"}
    )
    assert r.status_code == 409


@pytest.mark.asyncio
async def test_list_approvers(client: AsyncClient) -> None:
    r = await client.post("/api/projects", json={"name": "P"})
    project_id = r.json()["id"]

    await client.post(f"/api/projects/{project_id}/approvers", json={"email": "a@x.com"})
    await client.post(f"/api/projects/{project_id}/approvers", json={"email": "b@x.com"})

    r = await client.get(f"/api/projects/{project_id}/approvers")
    assert r.status_code == 200
    assert len(r.json()) == 2


@pytest.mark.asyncio
async def test_remove_approver(client: AsyncClient) -> None:
    r = await client.post("/api/projects", json={"name": "P"})
    project_id = r.json()["id"]

    r = await client.post(f"/api/projects/{project_id}/approvers", json={"email": "x@x.com"})
    approver_id = r.json()["id"]

    r = await client.delete(f"/api/projects/{project_id}/approvers/{approver_id}")
    assert r.status_code == 204

    r = await client.get(f"/api/projects/{project_id}/approvers")
    assert r.json() == []


@pytest.mark.asyncio
async def test_non_member_cannot_access_approvers(
    client: AsyncClient, other_client: AsyncClient
) -> None:
    """Approver add/remove are planner-gated; the list is org-wide readable."""
    r = await client.post("/api/projects", json={"name": "P"})
    project_id = r.json()["id"]
    r = await client.post(
        f"/api/projects/{project_id}/approvers", json={"email": "x@x.com"}
    )
    approver_id = r.json()["id"]

    # Reads are org-wide; mutating the approver matrix stays planner-only.
    assert (await other_client.get(f"/api/projects/{project_id}/approvers")).status_code == 200
    assert (
        await other_client.post(
            f"/api/projects/{project_id}/approvers", json={"email": "y@y.com"}
        )
    ).status_code == 403
    assert (
        await other_client.delete(
            f"/api/projects/{project_id}/approvers/{approver_id}"
        )
    ).status_code == 403


# ── Approval flow with configured approvers ───────────────────────────────────


@pytest.mark.asyncio
async def test_approver_status_shows_unsigned(client: AsyncClient) -> None:
    project_id, revision_id = await _setup(client)

    r = await client.get(f"/api/projects/{project_id}/revisions")
    data = r.json()[0]
    assert data["status"] == "pending_approval"
    statuses = data["approver_status"]
    assert len(statuses) == 2
    assert all(s["signed"] is False for s in statuses)


@pytest.mark.asyncio
async def test_partial_sign_does_not_approve(
    client: AsyncClient, other_client: AsyncClient
) -> None:
    project_id, revision_id = await _setup(client)

    # other@company.com signs — but third@company.com hasn't yet
    r = await other_client.put(
        f"/api/projects/{project_id}/revisions/{revision_id}/sign",
        json={"role_label": "Project Manager", "attested": True},
    )
    assert r.status_code == 200
    data = r.json()
    # Still pending because third@company.com hasn't signed
    assert data["status"] == "pending_approval"
    # Approver status updated
    statuses = {s["email"]: s for s in data["approver_status"]}
    assert statuses["other@company.com"]["signed"] is True
    assert statuses["third@company.com"]["signed"] is False


@pytest.mark.asyncio
async def test_all_approvers_signed_triggers_approval(
    client: AsyncClient, other_client: AsyncClient, third_client: AsyncClient
) -> None:
    project_id, revision_id = await _setup(client)

    # First approver (other@company.com) signs
    await other_client.put(
        f"/api/projects/{project_id}/revisions/{revision_id}/sign",
        json={"role_label": "Project Manager", "attested": True},
    )

    # Second approver (third@company.com) signs
    r = await third_client.put(
        f"/api/projects/{project_id}/revisions/{revision_id}/sign",
        json={"role_label": "HSE Manager", "attested": True},
    )
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "approved"
    assert len(data["signatures"]) == 2
    assert all(s["signed"] for s in data["approver_status"])

    # Plan stays locked on approval (model B) — frozen until Revise Plan.
    acts = (await client.get(f"/api/projects/{project_id}/activities")).json()
    assert all(a["locked_by_revision_id"] == revision_id for a in acts)


@pytest.mark.asyncio
async def test_no_approvers_configured_cannot_approve(
    client: AsyncClient, other_client: AsyncClient, db: AsyncSession
) -> None:
    """With no approvers configured, only an admin can even sign — and the
    signature is recorded but the revision still can't auto-approve."""
    r = await client.post("/api/projects", json={"name": "No-approver project"})
    project_id = r.json()["id"]
    await client.post(
        f"/api/projects/{project_id}/activities",
        json={
            "activity_type": "X",
            "start_date": "2026-01-01",
            "end_date": "2026-01-31",
            "well_name": "Well-1",
            "location": "OFFSHORE",
            "plan_type": "Firm",
            "risk": "No Flood Risk",
        },
    )
    r = await client.post(f"/api/projects/{project_id}/revisions", json={})
    revision_id = r.json()["id"]

    # Promote other@ to global admin so they're permitted to sign at all.
    await other_client.get("/api/projects")  # materialize the user row
    other = (
        await db.execute(select(User).where(User.id == OTHER_USER_ID))
    ).scalar_one()
    other.is_admin = True
    await db.commit()

    r = await other_client.put(
        f"/api/projects/{project_id}/revisions/{revision_id}/sign",
        json={"role_label": "Manager", "attested": True},
    )
    assert r.status_code == 200
    assert r.json()["status"] == "pending_approval"
    assert len(r.json()["signatures"]) == 1


@pytest.mark.asyncio
async def test_admin_signature_does_not_trigger_approval(
    client: AsyncClient,
    other_client: AsyncClient,
    third_client: AsyncClient,
    db: AsyncSession,
) -> None:
    """An admin may sign even when not a required approver, but it doesn't count
    toward auto-approval — only the designated approver's signature does."""
    r = await client.post("/api/projects", json={"name": "P"})
    project_id = r.json()["id"]
    await client.post(
        f"/api/projects/{project_id}/activities",
        json={
            "activity_type": "X",
            "start_date": "2026-01-01",
            "end_date": "2026-01-31",
            "well_name": "Well-1",
            "location": "OFFSHORE",
            "plan_type": "Firm",
            "risk": "No Flood Risk",
        },
    )
    # other@company.com is the sole required approver.
    await client.post(
        f"/api/projects/{project_id}/approvers",
        json={"email": "other@company.com", "role_label": "PM"},
    )
    r = await client.post(f"/api/projects/{project_id}/revisions", json={})
    revision_id = r.json()["id"]

    # third@ is a global admin (permitted to sign) but not a required approver.
    await third_client.get("/api/projects")  # ensure the user row exists
    third = (
        await db.execute(select(User).where(User.id == THIRD_USER_ID))
    ).scalar_one()
    third.is_admin = True
    await db.commit()

    r = await third_client.put(
        f"/api/projects/{project_id}/revisions/{revision_id}/sign",
        json={"role_label": "Observer", "attested": True},
    )
    assert r.status_code == 200
    # Not approved yet — required other@company.com hasn't signed
    assert r.json()["status"] == "pending_approval"

    # Now the required approver signs → approved
    r = await other_client.put(
        f"/api/projects/{project_id}/revisions/{revision_id}/sign",
        json={"role_label": "PM", "attested": True},
    )
    assert r.status_code == 200
    assert r.json()["status"] == "approved"


@pytest.mark.asyncio
async def test_outsider_cannot_sign(client: AsyncClient, other_client: AsyncClient) -> None:
    """A user who is neither an admin nor a designated approver is denied."""
    r = await client.post("/api/projects", json={"name": "P"})
    project_id = r.json()["id"]
    await client.post(
        f"/api/projects/{project_id}/activities",
        json={
            "activity_type": "X",
            "start_date": "2026-01-01",
            "end_date": "2026-01-31",
            "well_name": "Well-1",
            "location": "OFFSHORE",
            "plan_type": "Firm",
            "risk": "No Flood Risk",
        },
    )
    r = await client.post(f"/api/projects/{project_id}/revisions", json={})
    revision_id = r.json()["id"]

    # Other User has no relationship to the project → forbidden
    r = await other_client.put(
        f"/api/projects/{project_id}/revisions/{revision_id}/sign",
        json={"role_label": "Observer", "attested": True},
    )
    assert r.status_code == 403


# ── Signer matrices freeze while a revision is open ───────────────────────────
# The required-signature sets are recomputed from the matrices at every signing
# event, so editing them mid-flight would move the approval bar under the
# signers — and removing the last unsigned approver would strand the revision
# pending forever.


@pytest.mark.asyncio
async def test_signer_lists_freeze_while_revision_open(client: AsyncClient) -> None:
    project_id, revision_id = await _setup(client)  # leaves a pending revision

    r = await client.post(
        f"/api/projects/{project_id}/approvers", json={"email": "late@company.com"}
    )
    assert r.status_code == 423, r.text

    approvers = (await client.get(f"/api/projects/{project_id}/approvers")).json()
    r = await client.delete(f"/api/projects/{project_id}/approvers/{approvers[0]['id']}")
    assert r.status_code == 423, r.text

    r = await client.post(
        f"/api/projects/{project_id}/reviewers", json={"email": "late-rev@company.com"}
    )
    assert r.status_code == 423, r.text

    # Resolving the revision (discard) unfreezes the lists.
    assert (
        await client.delete(f"/api/projects/{project_id}/revisions/{revision_id}")
    ).status_code == 204
    r = await client.post(
        f"/api/projects/{project_id}/approvers", json={"email": "late@company.com"}
    )
    assert r.status_code == 201, r.text


@pytest.mark.asyncio
async def test_signer_lists_unfreeze_after_approval(
    client: AsyncClient, other_client: AsyncClient, third_client: AsyncClient
) -> None:
    """An APPROVED (frozen) plan does NOT freeze the matrices — edits then only
    shape the next cycle's required set, never a revision in flight."""
    project_id, revision_id = await _setup(client)
    for signer in (other_client, third_client):
        r = await signer.put(
            f"/api/projects/{project_id}/revisions/{revision_id}/sign", json={"attested": True}
        )
        assert r.status_code == 200, r.text
    # All approvers signed → approved; the plan stays locked, the matrices don't.
    r = await client.post(
        f"/api/projects/{project_id}/approvers", json={"email": "next-quarter@company.com"}
    )
    assert r.status_code == 201, r.text


# ── The DB, not the app, is the authority on signing invariants ───────────────


@pytest.mark.asyncio
async def test_signature_uniqueness_enforced_by_schema(
    client: AsyncClient, db: AsyncSession
) -> None:
    """One signature per (revision, user, stage): the endpoint's read-then-insert
    check alone is racy; the unique constraint is the real guarantee."""
    import uuid as _uuid
    from datetime import datetime, timezone

    from sqlalchemy.exc import IntegrityError

    from app.models.revision import Signature

    _, revision_id = await _setup(client)
    rid = _uuid.UUID(revision_id)
    db.add(Signature(revision_id=rid, user_id=OTHER_USER_ID, role_label="A",
                     stage="approval", signed_at=datetime.now(timezone.utc)))
    await db.commit()
    db.add(Signature(revision_id=rid, user_id=OTHER_USER_ID, role_label="B",
                     stage="approval", signed_at=datetime.now(timezone.utc)))
    with pytest.raises(IntegrityError):
        await db.commit()
    await db.rollback()


@pytest.mark.asyncio
async def test_rev_number_uniqueness_enforced_by_schema(
    client: AsyncClient, db: AsyncSession
) -> None:
    import uuid as _uuid

    from sqlalchemy.exc import IntegrityError

    from app.models.revision import Revision

    project_id, _ = await _setup(client)  # created Rev 1
    db.add(Revision(project_id=_uuid.UUID(project_id), rev_number=1,
                    snapshot_json="[]", status="discarded"))
    with pytest.raises(IntegrityError):
        await db.commit()
    await db.rollback()


# ── Signature attestation: a signature is a declaration, not a click ─────────


@pytest.mark.asyncio
async def test_sign_refused_without_attestation(client: AsyncClient, other_client: AsyncClient) -> None:
    project_id, revision_id = await _setup(client)

    r = await other_client.put(
        f"/api/projects/{project_id}/revisions/{revision_id}/sign", json={}
    )
    assert r.status_code == 422, r.text
    assert "reviewed" in r.json()["detail"].lower()
    # Nothing was recorded.
    revs = (await client.get(f"/api/projects/{project_id}/revisions")).json()
    assert revs[0]["signatures"] == []


@pytest.mark.asyncio
async def test_signature_records_first_submission_attestation(
    client: AsyncClient, other_client: AsyncClient
) -> None:
    project_id, revision_id = await _setup(client)

    r = await other_client.put(
        f"/api/projects/{project_id}/revisions/{revision_id}/sign",
        json={"attested": True},
    )
    assert r.status_code == 200, r.text
    sig = r.json()["signatures"][0]
    # Server-owned wording: names the resolved baseline (none here) and the rev.
    assert "first submission" in sig["attestation"]
    assert "Rev. 01" in sig["attestation"]
    assert "before approving" in sig["attestation"]


@pytest.mark.asyncio
async def test_attestation_names_the_prior_approved_baseline(
    client: AsyncClient, other_client: AsyncClient, third_client: AsyncClient
) -> None:
    """Second cycle: the attestation must state WHAT was reviewed — the changes
    against the plan of record (Rev. 01), not a vague confirmation."""
    project_id, revision_id = await _setup(client)
    for signer in (other_client, third_client):
        r = await signer.put(
            f"/api/projects/{project_id}/revisions/{revision_id}/sign",
            json={"attested": True},
        )
        assert r.status_code == 200, r.text

    # Rev. 01 approved → reopen (Revise Plan) → next cycle's revision.
    assert (await client.post(f"/api/projects/{project_id}/revisions/reopen")).status_code == 204
    r = await client.post(f"/api/projects/{project_id}/revisions", json={})
    assert r.status_code == 201, r.text
    rev2_id = r.json()["id"]

    r = await other_client.put(
        f"/api/projects/{project_id}/revisions/{rev2_id}/sign", json={"attested": True}
    )
    assert r.status_code == 200, r.text
    attestation = r.json()["signatures"][0]["attestation"]
    assert "against the last approved plan (Rev. 01)" in attestation
    assert "Rev. 02" in attestation


@pytest.mark.asyncio
async def test_review_signoff_records_review_attestation(
    client: AsyncClient, other_client: AsyncClient, db: AsyncSession
) -> None:
    r = await client.post("/api/projects", json={"name": "Attest Review"})
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

    # Unattested review sign-off refused; attested records review wording.
    r = await other_client.put(
        f"/api/projects/{project_id}/revisions/{revision_id}/sign-review", json={}
    )
    assert r.status_code == 422, r.text
    r = await other_client.put(
        f"/api/projects/{project_id}/revisions/{revision_id}/sign-review",
        json={"attested": True},
    )
    assert r.status_code == 200, r.text
    reviewer_sig = r.json()["reviewer_status"][0]
    assert reviewer_sig["signed"] is True
    # Contract: the flat signatures list stays the BINDING (approval-stage)
    # record — a review concurrence must not appear there; the reviewer's
    # supported state travels via reviewer_status instead.
    assert r.json()["signatures"] == []
    assert all(sig["stage"] == "approval" for sig in r.json()["signatures"])
    # Review signatures aren't in the binding (approval-only) flat list — read
    # the row itself for the technical-review wording.
    import uuid as _uuid

    from app.models.revision import Signature

    row = (
        await db.execute(
            select(Signature).where(
                Signature.revision_id == _uuid.UUID(revision_id),
                Signature.stage == "review",
            )
        )
    ).scalar_one()
    assert "as its technical review" in (row.attestation or "")
    assert "first submission" in (row.attestation or "")
    # And the stage advanced: all required reviewers have signed.
    revs = (await client.get(f"/api/projects/{project_id}/revisions")).json()
    assert revs[0]["status"] == "pending_approval"
