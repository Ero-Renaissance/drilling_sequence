"""changes-since-approved resolves the right approved baseline server-side:
the last approved revision in this project, else the clone parent's, else none.
"""

import pytest
from httpx import AsyncClient


async def _approved_project(
    client: AsyncClient, other_client: AsyncClient
) -> tuple[str, str, str]:
    """Project with one activity and an approved Rev 1.

    test@ (client) is the planner/creator; other@ (other_client) is the
    designated approver who signs — the creator can't approve their own plan.

    Returns (project_id, rev1_id, activity_id).
    """
    project = (await client.post("/api/projects", json={"name": "CSA"})).json()
    pid = project["id"]
    activity = (
        await client.post(
            f"/api/projects/{pid}/activities",
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
    ).json()
    await client.post(
        f"/api/projects/{pid}/approvers",
        json={"email": "other@company.com", "role_label": "Approver"},
    )
    rev = (await client.post(f"/api/projects/{pid}/revisions", json={})).json()
    signed = await other_client.put(
        f"/api/projects/{pid}/revisions/{rev['id']}/sign",
        json={"role_label": "Manager"},
    )
    assert signed.json()["status"] == "approved"
    return pid, rev["id"], activity["id"]


@pytest.mark.asyncio
async def test_live_vs_last_approved(
    client: AsyncClient, other_client: AsyncClient
) -> None:
    """Planner pre-submit: live working plan vs the last approved revision."""
    pid, _rev1, aid = await _approved_project(client, other_client)
    await client.patch(f"/api/projects/{pid}/activities/{aid}", json={"well_name": "Well-1B"})

    data = (
        await client.get(f"/api/projects/{pid}/revisions/changes-since-approved?target=live")
    ).json()
    assert data["base"]["kind"] == "revision"
    assert data["base"]["rev_number"] == 1
    assert data["target"]["kind"] == "live"
    assert data["summary"]["modified"] == 1


@pytest.mark.asyncio
async def test_pending_revision_vs_last_approved(
    client: AsyncClient, other_client: AsyncClient
) -> None:
    """Approver view: the pending revision vs the last approved one."""
    pid, _rev1, aid = await _approved_project(client, other_client)
    await client.patch(f"/api/projects/{pid}/activities/{aid}", json={"well_name": "Well-1B"})
    rev2 = (await client.post(f"/api/projects/{pid}/revisions", json={})).json()

    data = (
        await client.get(
            f"/api/projects/{pid}/revisions/changes-since-approved?target={rev2['id']}"
        )
    ).json()
    assert data["base"]["rev_number"] == 1
    assert data["target"]["rev_number"] == 2
    assert data["summary"]["modified"] == 1


@pytest.mark.asyncio
async def test_no_prior_approved_baseline(client: AsyncClient) -> None:
    project = (await client.post("/api/projects", json={"name": "Fresh"})).json()
    pid = project["id"]
    await client.post(
        f"/api/projects/{pid}/activities",
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

    data = (
        await client.get(f"/api/projects/{pid}/revisions/changes-since-approved?target=live")
    ).json()
    assert data["base"]["kind"] == "none"
    assert data["summary"]["added"] == 1


@pytest.mark.asyncio
async def test_falls_back_to_clone_parent(
    client: AsyncClient, other_client: AsyncClient
) -> None:
    """A freshly cloned quarter with no approvals of its own diffs against the
    parent's last approved revision, matched by lineage across the clone."""
    q1, _rev1, _aid = await _approved_project(client, other_client)
    q2 = (await client.post(f"/api/projects/{q1}/clone", json={"name": "Q2"})).json()

    data = (
        await client.get(
            f"/api/projects/{q2['id']}/revisions/changes-since-approved?target=live"
        )
    ).json()
    assert data["base"]["kind"] == "revision"
    assert data["base"]["project_id"] == q1  # baseline came from the parent project
    # The copied activity matches by lineage — no add/remove churn across the clone.
    assert data["summary"]["added"] == 0
    assert data["summary"]["removed"] == 0
    assert data["summary"]["unchanged"] >= 1


@pytest.mark.asyncio
async def test_baseline_parent_forces_previous_quarter(
    client: AsyncClient, other_client: AsyncClient
) -> None:
    """baseline=parent compares against the clone-parent's (previous quarter's) last
    approved plan even once this project has approvals of its own — which `auto`
    would otherwise prefer."""
    q1, _rev1, _aid = await _approved_project(client, other_client)
    q2 = (await client.post(f"/api/projects/{q1}/clone", json={"name": "Q2"})).json()
    q2id = q2["id"]

    # The clone copies the approver list, so other@ is already a Q2 approver and can
    # sign Q2's own first revision (test@ is the creator and can't approve it).
    rev = (await client.post(f"/api/projects/{q2id}/revisions", json={})).json()
    signed = await other_client.put(
        f"/api/projects/{q2id}/revisions/{rev['id']}/sign", json={"role_label": "Manager"}
    )
    assert signed.json()["status"] == "approved", signed.text

    base_url = f"/api/projects/{q2id}/revisions/changes-since-approved?target=live"

    # auto → this project's own last approved (an in-project baseline, no project_id).
    auto = (await client.get(base_url)).json()
    assert auto["base"]["kind"] == "revision"
    assert auto["base"].get("project_id") in (None, q2id)

    # parent → forced to Q1's last approved.
    parent = (await client.get(f"{base_url}&baseline=parent")).json()
    assert parent["base"]["kind"] == "revision"
    assert parent["base"]["project_id"] == q1


@pytest.mark.asyncio
async def test_baseline_parent_none_when_not_cloned(client: AsyncClient) -> None:
    """baseline=parent on a project that wasn't cloned yields an empty baseline."""
    pid = (await client.post("/api/projects", json={"name": "Standalone"})).json()["id"]
    await client.post(
        f"/api/projects/{pid}/activities",
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
    data = (
        await client.get(
            f"/api/projects/{pid}/revisions/changes-since-approved?target=live&baseline=parent"
        )
    ).json()
    assert data["base"]["kind"] == "none"


@pytest.mark.asyncio
async def test_baseline_rejects_unknown_value(client: AsyncClient) -> None:
    """The baseline allow-list rejects anything but auto/parent (422)."""
    pid = (await client.post("/api/projects", json={"name": "AL"})).json()["id"]
    resp = await client.get(
        f"/api/projects/{pid}/revisions/changes-since-approved?target=live&baseline=bogus"
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_access_allows_designated_approver(
    client: AsyncClient, other_client: AsyncClient, third_client: AsyncClient
) -> None:
    # other@ already approves in _approved_project, so test access with third@.
    pid, _rev1, _aid = await _approved_project(client, other_client)
    url = f"/api/projects/{pid}/revisions/changes-since-approved?target=live"

    assert (await third_client.get(url)).status_code == 403  # not a member or approver
    await client.post(
        f"/api/projects/{pid}/approvers",
        json={"email": "third@company.com", "role_label": "Approver"},
    )
    assert (await third_client.get(url)).status_code == 200
