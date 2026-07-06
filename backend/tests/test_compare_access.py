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
            "well_name": "Well-1",
            "location": "OFFSHORE",
            "plan_type": "Firm",
            "risk": "No Flood Risk",
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

    # Reads are org-wide, so the designated approver can always see what they
    # sign — with or without membership.
    await client.post(
        f"/api/projects/{project_id}/approvers",
        json={"email": "other@company.com", "role_label": "Approver"},
    )
    assert (await other_client.get(url)).status_code == 200


@pytest.mark.asyncio
async def test_unrelated_user_may_view_diff(
    client: AsyncClient, other_client: AsyncClient
) -> None:
    project_id, revision_id = await _project_with_revision(client)
    url = f"/api/projects/{project_id}/revisions/compare?base={revision_id}&target=live"
    # Reads are org-wide: no membership or designation needed to view.
    assert (await other_client.get(url)).status_code == 200
