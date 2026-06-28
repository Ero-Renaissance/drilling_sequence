"""HWU (Hydraulic Workover Unit) — the resource parallel to Rig."""
import pytest
from httpx import AsyncClient


async def _project(client: AsyncClient, name: str = "HWU") -> str:
    return (await client.post("/api/projects", json={"name": name})).json()["id"]


async def _activity(client: AsyncClient, pid: str, **overrides) -> AsyncClient:
    payload = {
        "activity_type": "Oil Development",
        "start_date": "2026-01-01",
        "end_date": "2026-03-31",
        "well_name": "W",
        "location": "OFFSHORE",
        "plan_type": "Firm",
        "risk": "No Flood Risk",
        **overrides,
    }
    return await client.post(f"/api/projects/{pid}/activities", json=payload)


# ── Activity hwu_name + rig/HWU exclusivity ──────────────────────────────────

@pytest.mark.asyncio
async def test_create_activity_with_hwu(client: AsyncClient) -> None:
    pid = await _project(client)
    r = await _activity(client, pid, hwu_name="HWU-1")
    assert r.status_code == 201, r.text
    assert r.json()["hwu_name"] == "HWU-1"
    assert r.json()["rig_name"] is None


@pytest.mark.asyncio
async def test_create_activity_rejects_both_rig_and_hwu(client: AsyncClient) -> None:
    pid = await _project(client)
    r = await _activity(client, pid, rig_name="R-1", hwu_name="HWU-1")
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_update_activity_rejects_merged_both(client: AsyncClient) -> None:
    pid = await _project(client)
    a = (await _activity(client, pid, rig_name="R-1")).json()
    # Adding an HWU while the rig is still set → merged state has both → 422.
    r = await client.patch(
        f"/api/projects/{pid}/activities/{a['id']}", json={"hwu_name": "HWU-1"}
    )
    assert r.status_code == 422
    # Switching cleanly (clear the rig, set the HWU) is allowed.
    r2 = await client.patch(
        f"/api/projects/{pid}/activities/{a['id']}",
        json={"rig_name": None, "hwu_name": "HWU-1"},
    )
    assert r2.status_code == 200, r2.text
    assert r2.json()["hwu_name"] == "HWU-1"
    assert r2.json()["rig_name"] is None


# ── HWU contract CRUD + RBAC ─────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_hwu_contract_crud(client: AsyncClient) -> None:
    pid = await _project(client)
    r = await client.put(
        f"/api/projects/{pid}/hwu-contracts/HWU-1",
        json={"status": "Completed", "contract_end": "2027-01-01"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["hwu_name"] == "HWU-1"
    assert r.json()["status"] == "Completed"

    listing = (await client.get(f"/api/projects/{pid}/hwu-contracts")).json()
    assert [c["hwu_name"] for c in listing] == ["HWU-1"]

    assert (await client.delete(f"/api/projects/{pid}/hwu-contracts/HWU-1")).status_code == 204
    assert (await client.get(f"/api/projects/{pid}/hwu-contracts")).json() == []


@pytest.mark.asyncio
async def test_hwu_contract_denied_for_non_member(
    client: AsyncClient, other_client: AsyncClient
) -> None:
    pid = await _project(client)
    # A non-member can neither read nor write the project's HWU contracts (BOLA).
    assert (await other_client.get(f"/api/projects/{pid}/hwu-contracts")).status_code == 403
    assert (
        await other_client.put(
            f"/api/projects/{pid}/hwu-contracts/HWU-1", json={"status": "Completed"}
        )
    ).status_code == 403


# ── Conflict + clone parity ──────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_hwu_double_booking_is_a_conflict(client: AsyncClient) -> None:
    pid = await _project(client)
    await _activity(client, pid, hwu_name="HWU-1", start_date="2026-01-01", end_date="2026-03-01")
    await _activity(client, pid, hwu_name="HWU-1", start_date="2026-02-01", end_date="2026-04-01")
    d = (await client.get(f"/api/projects/{pid}/dashboard")).json()
    assert d["rigs"]["conflicts"] == 1


@pytest.mark.asyncio
async def test_clone_copies_hwu_contracts(client: AsyncClient) -> None:
    pid = await _project(client)
    await client.put(
        f"/api/projects/{pid}/hwu-contracts/HWU-1",
        json={"status": "Completed", "contract_end": "2027-01-01"},
    )
    clone = await client.post(f"/api/projects/{pid}/clone", json={"name": "Clone"})
    assert clone.status_code == 201, clone.text
    contracts = (
        await client.get(f"/api/projects/{clone.json()['id']}/hwu-contracts")
    ).json()
    assert [c["hwu_name"] for c in contracts] == ["HWU-1"]
