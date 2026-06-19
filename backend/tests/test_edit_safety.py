"""Tests for Phase 5: optimistic locking, audit log, updated_by, viewers."""

from datetime import datetime, timedelta, timezone

import pytest
from httpx import AsyncClient


async def _mk_project(client: AsyncClient, name: str = "Proj") -> dict:
    r = await client.post("/api/projects", json={"name": name})
    assert r.status_code == 201
    return r.json()


async def _mk_activity(client: AsyncClient, pid: str, **kw) -> dict:
    body = {"activity_type": "Oil Dev", "start_date": "2026-01-01", "end_date": "2026-03-31", **kw}
    r = await client.post(f"/api/projects/{pid}/activities", json=body)
    assert r.status_code == 201
    return r.json()


# ── updated_by_name ──────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_sets_updated_by_name(client: AsyncClient) -> None:
    proj = await _mk_project(client)
    act = await _mk_activity(client, proj["id"])
    assert act["updated_by_name"] == "Test User"


@pytest.mark.asyncio
async def test_patch_updates_updated_by_name(client: AsyncClient) -> None:
    proj = await _mk_project(client)
    act = await _mk_activity(client, proj["id"])
    r = await client.patch(
        f"/api/projects/{proj['id']}/activities/{act['id']}",
        json={"well_name": "Well-X"},
    )
    assert r.status_code == 200
    assert r.json()["updated_by_name"] == "Test User"


# ── Optimistic lock detection ────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_patch_with_correct_timestamp_succeeds(client: AsyncClient) -> None:
    proj = await _mk_project(client)
    act = await _mk_activity(client, proj["id"])
    r = await client.patch(
        f"/api/projects/{proj['id']}/activities/{act['id']}",
        json={"well_name": "Well-X", "expected_updated_at": act["updated_at"]},
    )
    assert r.status_code == 200
    assert r.json()["well_name"] == "Well-X"


@pytest.mark.asyncio
async def test_patch_with_stale_timestamp_returns_409(client: AsyncClient) -> None:
    proj = await _mk_project(client)
    act = await _mk_activity(client, proj["id"])

    # Use a timestamp that's clearly in the past (60 s ago) — simulates User A
    # loading the page before User B made a change.
    clearly_stale = (datetime.now(timezone.utc) - timedelta(seconds=60)).isoformat()

    r = await client.patch(
        f"/api/projects/{proj['id']}/activities/{act['id']}",
        json={"well_name": "Well-B", "expected_updated_at": clearly_stale},
    )
    assert r.status_code == 409
    detail = r.json()["detail"]
    assert detail["code"] == "conflict"
    assert "updated_by" in detail
    assert "updated_at" in detail


@pytest.mark.asyncio
async def test_patch_without_expected_timestamp_always_saves(client: AsyncClient) -> None:
    proj = await _mk_project(client)
    act = await _mk_activity(client, proj["id"])
    # First patch to advance updated_at
    await client.patch(
        f"/api/projects/{proj['id']}/activities/{act['id']}",
        json={"well_name": "Well-A"},
    )
    # Second patch without expected_updated_at — should succeed unconditionally
    r = await client.patch(
        f"/api/projects/{proj['id']}/activities/{act['id']}",
        json={"well_name": "Well-B"},
    )
    assert r.status_code == 200
    assert r.json()["well_name"] == "Well-B"


# ── Audit log ────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_patch_creates_audit_entries(client: AsyncClient) -> None:
    proj = await _mk_project(client)
    act = await _mk_activity(client, proj["id"])
    await client.patch(
        f"/api/projects/{proj['id']}/activities/{act['id']}",
        json={"well_name": "Well-X", "risk": "Flood Risk"},
    )
    r = await client.get(
        f"/api/projects/{proj['id']}/activities/{act['id']}/history"
    )
    assert r.status_code == 200
    entries = r.json()
    fields_changed = {e["field"] for e in entries}
    assert "well_name" in fields_changed
    assert "risk" in fields_changed


@pytest.mark.asyncio
async def test_audit_entry_records_old_and_new_values(client: AsyncClient) -> None:
    proj = await _mk_project(client)
    act = await _mk_activity(client, proj["id"], well_name="Well-Original")
    await client.patch(
        f"/api/projects/{proj['id']}/activities/{act['id']}",
        json={"well_name": "Well-New"},
    )
    r = await client.get(f"/api/projects/{proj['id']}/activities/{act['id']}/history")
    entries = {e["field"]: e for e in r.json()}
    assert entries["well_name"]["old_value"] == "Well-Original"
    assert entries["well_name"]["new_value"] == "Well-New"
    assert entries["well_name"]["user_name"] == "Test User"


@pytest.mark.asyncio
async def test_audit_unchanged_fields_not_logged(client: AsyncClient) -> None:
    proj = await _mk_project(client)
    act = await _mk_activity(client, proj["id"], well_name="Well-A", risk="No Flood Risk")
    await client.patch(
        f"/api/projects/{proj['id']}/activities/{act['id']}",
        json={"well_name": "Well-A"},  # same value — no change
    )
    r = await client.get(f"/api/projects/{proj['id']}/activities/{act['id']}/history")
    assert r.json() == []


@pytest.mark.asyncio
async def test_history_empty_for_new_activity(client: AsyncClient) -> None:
    proj = await _mk_project(client)
    act = await _mk_activity(client, proj["id"])
    r = await client.get(f"/api/projects/{proj['id']}/activities/{act['id']}/history")
    assert r.status_code == 200
    assert r.json() == []


# ── Viewers / presence ───────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_viewers_includes_current_user(client: AsyncClient) -> None:
    proj = await _mk_project(client)
    r = await client.get(f"/api/projects/{proj['id']}/viewers")
    assert r.status_code == 200
    names = [v["user_name"] for v in r.json()]
    assert "Test User" in names


@pytest.mark.asyncio
async def test_viewers_denied_for_non_member(
    client: AsyncClient, other_client: AsyncClient
) -> None:
    proj = await _mk_project(client)
    r = await other_client.get(f"/api/projects/{proj['id']}/viewers")
    assert r.status_code == 403
