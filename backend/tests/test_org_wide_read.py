"""Org-wide read-only visibility.

Every authenticated user can see every campaign and all of its data; only the
campaign's planners (holding the global grant) and admins can change anything.
The noplan user — no grant, no memberships — is the purest "everyone else".
"""

import pytest
from httpx import AsyncClient


async def _campaign_with_activity(client: AsyncClient) -> tuple[str, str]:
    r = await client.post("/api/projects", json={"name": "Org Read Campaign"})
    assert r.status_code == 201
    pid = r.json()["id"]
    r = await client.post(
        f"/api/projects/{pid}/activities",
        json={
            "activity_type": "Oil Well Drilling",
            "start_date": "2026-01-01",
            "end_date": "2026-03-31",
            "well_name": "Well-A1",
            "rig_name": "Rig Alpha",
            "location": "OFFSHORE",
            "plan_type": "Firm",
            "risk": "No Flood Risk",
        },
    )
    assert r.status_code == 201
    return pid, r.json()["id"]


@pytest.mark.asyncio
async def test_every_read_surface_is_open(
    client: AsyncClient, noplan_client: AsyncClient
) -> None:
    pid, _aid = await _campaign_with_activity(client)

    reads = [
        "/api/projects",
        f"/api/projects/{pid}",
        f"/api/projects/{pid}/activities",
        f"/api/projects/{pid}/readiness",
        f"/api/projects/{pid}/contracts",
        f"/api/projects/{pid}/hwu-contracts",
        f"/api/projects/{pid}/revisions",
        f"/api/projects/{pid}/approvers",
        f"/api/projects/{pid}/reviewers",
        f"/api/projects/{pid}/audit",
        f"/api/projects/{pid}/dashboard",
        f"/api/projects/{pid}/viewers",
        f"/api/projects/{pid}/change-notes",
    ]
    for url in reads:
        r = await noplan_client.get(url)
        assert r.status_code == 200, f"{url} -> {r.status_code}: {r.text[:120]}"

    # The org-wide list shows the campaign to the non-member.
    names = [p["name"] for p in (await noplan_client.get("/api/projects")).json()]
    assert "Org Read Campaign" in names


@pytest.mark.asyncio
async def test_writes_stay_denied_for_plain_users(
    client: AsyncClient, noplan_client: AsyncClient
) -> None:
    pid, aid = await _campaign_with_activity(client)

    # Campaign creation needs the grant.
    assert (await noplan_client.post("/api/projects", json={"name": "X"})).status_code == 403
    # Plan mutations need the planner role on this campaign.
    assert (
        await noplan_client.patch(
            f"/api/projects/{pid}/activities/{aid}", json={"well_name": "Hacked"}
        )
    ).status_code == 403
    assert (
        await noplan_client.put(
            f"/api/projects/{pid}/activities/{aid}/readiness/BUD",
            json={"status": "Completed"},
        )
    ).status_code == 403
    assert (
        await noplan_client.put(
            f"/api/projects/{pid}/contracts/Rig%20Alpha",
            json={"contract_end": "2027-01-01"},
        )
    ).status_code == 403
    assert (
        await noplan_client.post(
            f"/api/projects/{pid}/approvers", json={"email": "x@x.com"}
        )
    ).status_code == 403
    assert (
        await noplan_client.post(f"/api/projects/{pid}/revisions", json={})
    ).status_code == 403
    assert (
        await noplan_client.patch(f"/api/projects/{pid}", json={"name": "Renamed"})
    ).status_code == 403
    assert (await noplan_client.delete(f"/api/projects/{pid}")).status_code == 403
    # Signing still requires designation — reading everything grants no authority.
    revs = await client.post(f"/api/projects/{pid}/revisions", json={})
    rev_id = revs.json()["id"]
    assert (
        await noplan_client.put(f"/api/projects/{pid}/revisions/{rev_id}/sign", json={"attested": True})
    ).status_code in (403, 409)
