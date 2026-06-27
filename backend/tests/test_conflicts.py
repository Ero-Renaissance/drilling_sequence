"""Rig conflicts hard-block submitting a physically-impossible plan for approval."""

import pytest
from httpx import AsyncClient


async def _project(client: AsyncClient, name: str = "Conflict") -> str:
    return (await client.post("/api/projects", json={"name": name})).json()["id"]


async def _activity(
    client: AsyncClient, pid: str, *, rig: str, start: str, end: str, well: str = "W"
) -> dict:
    r = await client.post(
        f"/api/projects/{pid}/activities",
        json={
            "activity_type": "Oil Development",
            "start_date": start,
            "end_date": end,
            "rig_name": rig,
            "well_name": well,
            "location": "OFFSHORE",
            "plan_type": "Firm",
            "risk": "No Flood Risk",
        },
    )
    assert r.status_code == 201, r.text
    return r.json()


@pytest.mark.asyncio
async def test_create_revision_blocked_by_rig_conflict(client: AsyncClient) -> None:
    pid = await _project(client)
    await _activity(client, pid, rig="Rig Alpha", start="2026-01-01", end="2026-03-01", well="W-A")
    await _activity(client, pid, rig="Rig Alpha", start="2026-02-01", end="2026-04-01", well="W-B")

    r = await client.post(f"/api/projects/{pid}/revisions", json={})
    assert r.status_code == 409, r.text
    assert "conflict" in r.json()["detail"].lower()
    assert "Rig Alpha" in r.json()["detail"]


@pytest.mark.asyncio
async def test_create_revision_allowed_when_no_overlap(client: AsyncClient) -> None:
    pid = await _project(client)
    await _activity(client, pid, rig="Rig Alpha", start="2026-01-01", end="2026-01-31")
    await _activity(client, pid, rig="Rig Alpha", start="2026-02-01", end="2026-02-28")

    r = await client.post(f"/api/projects/{pid}/revisions", json={})
    assert r.status_code in (200, 201), r.text


@pytest.mark.asyncio
async def test_create_revision_allowed_when_overlap_is_completed(client: AsyncClient) -> None:
    pid = await _project(client)
    a = await _activity(client, pid, rig="Rig Alpha", start="2026-01-01", end="2026-03-01", well="W-A")
    await _activity(client, pid, rig="Rig Alpha", start="2026-02-01", end="2026-04-01", well="W-B")
    # Completing the first releases the rig — no live conflict remains.
    await client.post(f"/api/projects/{pid}/activities/{a['id']}/complete")

    r = await client.post(f"/api/projects/{pid}/revisions", json={})
    assert r.status_code in (200, 201), r.text


@pytest.mark.asyncio
async def test_create_revision_allowed_for_different_rigs(client: AsyncClient) -> None:
    pid = await _project(client)
    await _activity(client, pid, rig="Rig Alpha", start="2026-01-01", end="2026-03-01")
    await _activity(client, pid, rig="Rig Beta", start="2026-02-01", end="2026-04-01")

    r = await client.post(f"/api/projects/{pid}/revisions", json={})
    assert r.status_code in (200, 201), r.text
