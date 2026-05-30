"""A designated approver matched by email may not be a project member, but must
be able to view the diff of the revision they're being asked to approve.
"""

import pytest
from httpx import AsyncClient


async def _project_with_revision(client: AsyncClient) -> tuple[str, str]:
    project = (await client.post("/api/projects", json={"name": "Diff Access"})).json()
    await client.post(
        f"/api/projects/{project['id']}/activities",
        json={
            "activity_type": "Oil Well Drilling",
            "start_date": "2026-01-01",
            "end_date": "2026-02-01",
        },
    )
    revision = (await client.post(f"/api/projects/{project['id']}/revisions", json={})).json()
    return project["id"], revision["id"]


@pytest.mark.asyncio
async def test_designated_approver_can_view_diff(
    client: AsyncClient, other_client: AsyncClient
) -> None:
    project_id, revision_id = await _project_with_revision(client)
    url = f"/api/projects/{project_id}/revisions/compare?base={revision_id}&target=live"

    # The other user is neither a member nor an approver → denied.
    assert (await other_client.get(url)).status_code == 403

    # Designate them an approver by email → they can now see what they sign.
    await client.post(
        f"/api/projects/{project_id}/approvers",
        json={"email": "other@company.com", "role_label": "Approver"},
    )
    assert (await other_client.get(url)).status_code == 200


@pytest.mark.asyncio
async def test_unrelated_user_still_denied_diff(
    client: AsyncClient, other_client: AsyncClient
) -> None:
    project_id, revision_id = await _project_with_revision(client)
    url = f"/api/projects/{project_id}/revisions/compare?base={revision_id}&target=live"
    # No membership, no approver designation → stays 403 (BOLA scoping holds).
    assert (await other_client.get(url)).status_code == 403
