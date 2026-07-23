"""The low-severity audit hardening batch: project-mutation audit entries, a
server-authoritative signature title, persisted review_skipped, and import
length bounds."""
import pytest
from httpx import AsyncClient


async def _project(client: AsyncClient, name: str = "Audit Hardening") -> str:
    r = await client.post("/api/projects", json={"name": name})
    return r.json()["id"]


async def _activity(client: AsyncClient, pid: str, **over) -> None:
    payload = {
        "activity_type": "Oil Development", "start_date": "2027-01-01",
        "end_date": "2027-03-01", "well_name": "W-1", "location": "LAND",
        "plan_type": "Firm", "risk": "No Flood Risk", **over,
    }
    r = await client.post(f"/api/projects/{pid}/activities", json=payload)
    assert r.status_code == 201, r.text


async def _audit_actions(client: AsyncClient, pid: str) -> list[str]:
    r = await client.get(f"/api/projects/{pid}/audit")
    assert r.status_code == 200, r.text
    return [e["field"] if "field" in e else e.get("action", "") for e in r.json()]


@pytest.mark.asyncio
async def test_project_update_and_archive_are_audited(client: AsyncClient) -> None:
    pid = await _project(client)

    r = await client.patch(f"/api/projects/{pid}", json={"name": "Renamed Campaign", "region": "Delta"})
    assert r.status_code == 200, r.text
    r = await client.delete(f"/api/projects/{pid}")
    assert r.status_code == 204, r.text

    actions = await _audit_actions(client, pid)
    assert "project_updated" in actions
    assert "project_archived" in actions


@pytest.mark.asyncio
async def test_rename_rejects_out_of_bounds_name(client: AsyncClient) -> None:
    """Campaign name is bounded to the column width (256) and must be non-empty —
    both are clean 422s at the schema boundary, never a DB-layer 500."""
    pid = await _project(client)
    too_long = await client.patch(f"/api/projects/{pid}", json={"name": "x" * 257})
    assert too_long.status_code == 422, too_long.text
    blank = await client.patch(f"/api/projects/{pid}", json={"name": "   "})
    assert blank.status_code == 422, blank.text


@pytest.mark.asyncio
async def test_signature_title_comes_from_the_matrix_not_the_client(
    client: AsyncClient, other_client: AsyncClient
) -> None:
    """A designated approver can't inscribe a false title: the recorded
    role_label is the one on their matrix row, whatever the client sends."""
    pid = await _project(client)
    await _activity(client, pid)
    await client.post(
        f"/api/projects/{pid}/approvers",
        json={"email": "other@company.com", "role_label": "Asset Manager"},
    )
    rev = (await client.post(f"/api/projects/{pid}/revisions", json={})).json()

    signed = await other_client.put(
        f"/api/projects/{pid}/revisions/{rev['id']}/sign",
        json={"role_label": "Managing Director", "attested": True},
    )
    assert signed.status_code == 200, signed.text
    # The flat approval-signature list records the matrix title, not "Managing Director".
    titles = [s["role_label"] for s in signed.json()["signatures"]]
    assert titles == ["Asset Manager"]


@pytest.mark.asyncio
async def test_review_skipped_is_frozen_against_later_policy_change(
    client: AsyncClient, other_client: AsyncClient
) -> None:
    """Submitting straight to approval under the optional policy flags the
    revision review_skipped; flipping the policy afterwards must NOT rewrite it."""
    pid = await _project(client)
    await _activity(client, pid)
    await client.post(
        f"/api/projects/{pid}/approvers",
        json={"email": "other@company.com", "role_label": "Approver"},
    )
    # Optional policy is the default; submit without requesting review → skipped.
    rev = (await client.post(f"/api/projects/{pid}/revisions", json={"request_review": False})).json()
    assert rev["review_skipped"] is True

    # Change the policy to "off"; the historical revision keeps its stored flag.
    r = await client.patch(f"/api/projects/{pid}", json={"review_policy": "off"})
    assert r.status_code == 200, r.text
    after = (await client.get(f"/api/projects/{pid}/revisions/{rev['id']}")).json()
    assert after["review_skipped"] is True


@pytest.mark.asyncio
async def test_import_rejects_over_length_free_text() -> None:
    """The lenient import schema now bounds free text to the DB column widths —
    an over-length comment is a clean validation error, not a 500."""
    from pydantic import ValidationError

    from app.schemas.activity import ActivityCreate

    # 512 is the comment column width.
    ActivityCreate(activity_type="Oil Development", start_date="2027-01-01",
                   end_date="2027-03-01", comment="x" * 512)  # ok at the boundary
    with pytest.raises(ValidationError):
        ActivityCreate(activity_type="Oil Development", start_date="2027-01-01",
                       end_date="2027-03-01", comment="x" * 513)
    with pytest.raises(ValidationError):
        ActivityCreate(activity_type="A" * 257, start_date="2027-01-01", end_date="2027-03-01")
