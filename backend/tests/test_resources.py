"""Resource registry: auto-registration, attribute edits, rename-on-award,
terrain-qualified contracts (docs/rig-registry-spec.md)."""
import io

import pytest
from httpx import AsyncClient


async def _project(client: AsyncClient, name: str = "Registry") -> str:
    return (await client.post("/api/projects", json={"name": name})).json()["id"]


async def _activity(
    client: AsyncClient,
    pid: str,
    *,
    rig: str | None = None,
    hwu: str | None = None,
    location: str = "LAND",
    well: str = "W",
    start: str = "2026-01-01",
    end: str = "2026-02-01",
) -> dict:
    body: dict = {
        "activity_type": "Oil Development",
        "start_date": start,
        "end_date": end,
        "well_name": well,
        "location": location,
        "plan_type": "Firm",
        "risk": "No Flood Risk",
    }
    if rig:
        body["rig_name"] = rig
    if hwu:
        body["hwu_name"] = hwu
    r = await client.post(f"/api/projects/{pid}/activities", json=body)
    assert r.status_code == 201, r.text
    return r.json()


async def _resources(client: AsyncClient, pid: str) -> list[dict]:
    r = await client.get(f"/api/projects/{pid}/resources")
    assert r.status_code == 200, r.text
    return r.json()


@pytest.mark.asyncio
async def test_activities_auto_register_units(client: AsyncClient) -> None:
    pid = await _project(client)
    await _activity(client, pid, rig="10K Rig 1", location="LAND", well="W-1")
    # Case/whitespace variant of the same unit — must NOT create a second row.
    await _activity(client, pid, rig="  10k rig 1 ", location="LAND", well="W-2",
                    start="2026-03-01", end="2026-04-01")
    # Same name in SWAMP = a DIFFERENT physical rig.
    await _activity(client, pid, rig="10K Rig 1", location="SWAMP", well="W-3")
    # HWUs are mobile: terrain is not part of their identity.
    await _activity(client, pid, hwu="HWU-1", location="SWAMP", well="W-4",
                    start="2026-05-01", end="2026-06-01")

    rows = await _resources(client, pid)
    keys = {(r["kind"], r["terrain"], r["name"]) for r in rows}
    assert keys == {
        ("rig", "LAND", "10K Rig 1"),
        ("rig", "SWAMP", "10K Rig 1"),
        ("hwu", "", "HWU-1"),
    }
    # New units start as unprocured placeholder slots.
    assert all(r["is_placeholder"] for r in rows)


@pytest.mark.asyncio
async def test_resource_writes_require_planner(
    client: AsyncClient, other_client: AsyncClient
) -> None:
    pid = await _project(client)
    await _activity(client, pid, rig="10K Rig 1")
    rid = (await _resources(client, pid))[0]["id"]

    # A non-member may read (org-wide) but not write.
    assert (await other_client.get(f"/api/projects/{pid}/resources")).status_code == 200
    r = await other_client.patch(
        f"/api/projects/{pid}/resources/{rid}", json={"capability_class": "10K"}
    )
    assert r.status_code == 403, r.text
    r = await other_client.post(
        f"/api/projects/{pid}/resources/{rid}/rename", json={"new_name": "T999"}
    )
    assert r.status_code == 403, r.text


@pytest.mark.asyncio
async def test_edit_attributes_never_identity(client: AsyncClient) -> None:
    pid = await _project(client)
    await _activity(client, pid, rig="10K Rig 1")
    rid = (await _resources(client, pid))[0]["id"]

    r = await client.patch(
        f"/api/projects/{pid}/resources/{rid}",
        json={"capability_class": "10K", "is_placeholder": False},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["capability_class"] == "10K"
    assert body["is_placeholder"] is False
    assert body["name"] == "10K Rig 1"  # identity untouched


@pytest.mark.asyncio
async def test_rename_on_award_moves_the_lane_and_only_the_lane(
    client: AsyncClient,
) -> None:
    pid = await _project(client)
    await _activity(client, pid, rig="10K Rig 1", location="LAND", well="W-L1")
    await _activity(client, pid, rig="10K Rig 1", location="LAND", well="W-L2",
                    start="2026-03-01", end="2026-04-01")
    # Same name, different terrain = a different physical rig — must NOT rename.
    await _activity(client, pid, rig="10K Rig 1", location="SWAMP", well="W-S")
    # Contract for the LAND unit (terrain-qualified).
    r = await client.put(
        f"/api/projects/{pid}/contracts/10K Rig 1",
        json={"status": "Completed", "contract_end": "2030-01-01", "terrain": "LAND"},
    )
    assert r.status_code == 200, r.text

    land = next(
        r for r in await _resources(client, pid)
        if r["kind"] == "rig" and r["terrain"] == "LAND"
    )
    r = await client.post(
        f"/api/projects/{pid}/resources/{land['id']}/rename", json={"new_name": "T209"}
    )
    assert r.status_code == 200, r.text
    assert r.json()["name"] == "T209"
    assert r.json()["is_placeholder"] is False  # an awarded name is a procured unit

    acts = (await client.get(f"/api/projects/{pid}/activities")).json()
    by_well = {a["well_name"]: a["rig_name"] for a in acts}
    assert by_well["W-L1"] == "T209" and by_well["W-L2"] == "T209"
    assert by_well["W-S"] == "10K Rig 1"  # the swamp unit keeps its slot name

    contracts = (await client.get(f"/api/projects/{pid}/contracts")).json()
    assert {(c["rig_name"], c["terrain"]) for c in contracts} == {("T209", "LAND")}

    # Governance audit trail records the rename.
    audit = (await client.get(f"/api/projects/{pid}/audit")).json()
    entry = next(
        (e for e in audit if e["entity_type"] == "resource" and e["field"] == "resource_renamed"),
        None,
    )
    assert entry is not None
    assert entry["old_value"] == "10K Rig 1"
    assert "T209" in entry["new_value"]


@pytest.mark.asyncio
async def test_rename_conflicts_with_existing_unit_on_same_terrain(
    client: AsyncClient,
) -> None:
    pid = await _project(client)
    await _activity(client, pid, rig="10K Rig 1", location="LAND", well="W-1")
    await _activity(client, pid, rig="T209", location="LAND", well="W-2",
                    start="2026-03-01", end="2026-04-01")
    slot = next(
        r for r in await _resources(client, pid) if r["name"] == "10K Rig 1"
    )
    r = await client.post(
        f"/api/projects/{pid}/resources/{slot['id']}/rename", json={"new_name": "t209"}
    )
    assert r.status_code == 409, r.text


@pytest.mark.asyncio
async def test_rename_blocked_while_plan_locked(client: AsyncClient) -> None:
    pid = await _project(client)
    await _activity(client, pid, rig="10K Rig 1", location="LAND")
    rid = (await _resources(client, pid))[0]["id"]

    # Creating a revision freezes the plan — renames change plan data.
    r = await client.post(f"/api/projects/{pid}/revisions", json={})
    assert r.status_code in (200, 201), r.text

    r = await client.post(
        f"/api/projects/{pid}/resources/{rid}/rename", json={"new_name": "T209"}
    )
    assert r.status_code == 423, r.text


@pytest.mark.asyncio
async def test_contract_upsert_resolves_terrain_or_asks(client: AsyncClient) -> None:
    pid = await _project(client)
    await _activity(client, pid, rig="Solo Rig", location="OFFSHORE", well="W-1")
    await _activity(client, pid, rig="10K Rig 1", location="LAND", well="W-2")
    await _activity(client, pid, rig="10K Rig 1", location="SWAMP", well="W-3")

    # Unambiguous name: terrain resolves from the registry — old clients keep working.
    r = await client.put(
        f"/api/projects/{pid}/contracts/Solo Rig",
        json={"status": "Completed", "contract_end": "2030-06-30"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["terrain"] == "OFFSHORE"

    # Ambiguous name: the server must not guess which physical rig is meant.
    r = await client.put(
        f"/api/projects/{pid}/contracts/10K Rig 1",
        json={"status": "Completed", "contract_end": "2030-06-30"},
    )
    assert r.status_code == 409, r.text
    assert "terrain" in r.json()["detail"].lower()

    # Explicit terrain: one contract per physical rig.
    for terrain, end in [("LAND", "2030-01-01"), ("SWAMP", "2031-01-01")]:
        r = await client.put(
            f"/api/projects/{pid}/contracts/10K Rig 1",
            json={"status": "Completed", "contract_end": end, "terrain": terrain},
        )
        assert r.status_code == 200, r.text
    contracts = (await client.get(f"/api/projects/{pid}/contracts")).json()
    pairs = {(c["rig_name"], c["terrain"], c["contract_end"]) for c in contracts}
    assert ("10K Rig 1", "LAND", "2030-01-01") in pairs
    assert ("10K Rig 1", "SWAMP", "2031-01-01") in pairs

    # Delete needs the same disambiguation.
    assert (
        await client.delete(f"/api/projects/{pid}/contracts/10K Rig 1")
    ).status_code == 409
    assert (
        await client.delete(f"/api/projects/{pid}/contracts/10K Rig 1?terrain=SWAMP")
    ).status_code == 204


@pytest.mark.asyncio
async def test_import_registers_units_and_terrain_contracts(client: AsyncClient) -> None:
    pid = await _project(client, "ImportReg")
    header = (
        "Location,Rig Name,HWU Name,Activity Type,Plan Type,Project,Well Name,"
        "Start Date,End Date,Rig Contract Expiry Date,HWU Contract Expiry Date,Risk,"
        "Readiness Check,Readiness Check Status,Comment"
    )
    rows = [
        f"LAND,10K Rig 1,,Oil Development,In Plan (Firm),PX,W-L,05/01/2026,15/03/2026,31/12/2030,,No Flood Risk,BUD,On track,",
        f"SWAMP,10K Rig 1,,Oil Development,In Plan (Firm),PX,W-S,01/04/2026,30/06/2026,30/06/2031,,Flood Risk,BUD,On track,",
    ]
    content = ("\n".join([header, *rows]) + "\n").encode()
    r = await client.post(
        f"/api/projects/{pid}/activities/import?replace=true",
        files={"file": ("schedule.csv", io.BytesIO(content), "text/csv")},
    )
    assert r.status_code == 200, r.text

    keys = {(x["kind"], x["terrain"], x["name"]) for x in await _resources(client, pid)}
    assert ("rig", "LAND", "10K Rig 1") in keys
    assert ("rig", "SWAMP", "10K Rig 1") in keys

    contracts = (await client.get(f"/api/projects/{pid}/contracts")).json()
    pairs = {(c["terrain"], c["contract_end"]) for c in contracts}
    assert pairs == {("LAND", "2030-12-31"), ("SWAMP", "2031-06-30")}
