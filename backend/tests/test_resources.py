"""Resource registry: auto-registration, attribute edits, rename-on-award,
terrain-qualified contracts (docs/rig-registry-spec.md)."""
import io
import uuid
from datetime import date

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.rig_contract import RigContract


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
        json={"contract_end": "2030-01-01", "terrain": "LAND"},
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
        json={"contract_end": "2030-06-30"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["terrain"] == "OFFSHORE"

    # Ambiguous name: the server must not guess which physical rig is meant.
    r = await client.put(
        f"/api/projects/{pid}/contracts/10K Rig 1",
        json={"contract_end": "2030-06-30"},
    )
    assert r.status_code == 409, r.text
    assert "terrain" in r.json()["detail"].lower()

    # Explicit terrain: one contract per physical rig.
    for terrain, end in [("LAND", "2030-01-01"), ("SWAMP", "2031-01-01")]:
        r = await client.put(
            f"/api/projects/{pid}/contracts/10K Rig 1",
            json={"contract_end": end, "terrain": terrain},
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
        "LAND,10K Rig 1,,Oil Development,In Plan (Firm),PX,W-L,05/01/2026,15/03/2026,31/12/2030,,No Flood Risk,BUD,On track,",
        "SWAMP,10K Rig 1,,Oil Development,In Plan (Firm),PX,W-S,01/04/2026,30/06/2026,30/06/2031,,Flood Risk,BUD,On track,",
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


@pytest.mark.asyncio
async def test_contract_is_its_end_date(client: AsyncClient) -> None:
    """No workflow status: a contract exists iff an end date is on file. A
    date-less upsert is rejected (422) — removing a contract is DELETE, which is
    audited — so no zombie "record without a contract" rows can exist."""
    pid = await _project(client)
    await _activity(client, pid, rig="Solo Rig", location="LAND")

    # A contract without an end date is not a contract.
    r = await client.put(f"/api/projects/{pid}/contracts/Solo Rig", json={})
    assert r.status_code == 422, r.text
    r = await client.put(
        f"/api/projects/{pid}/contracts/Solo Rig", json={"notes": "negotiating"}
    )
    assert r.status_code == 422, r.text
    assert (await client.get(f"/api/projects/{pid}/contracts")).json() == []

    # With an end date it binds; the response carries no status field.
    r = await client.put(
        f"/api/projects/{pid}/contracts/Solo Rig", json={"contract_end": "2027-03-31"}
    )
    assert r.status_code == 200, r.text
    assert "status" not in r.json()

    # Correcting a fake date = removing the contract, first-class and audited.
    assert (
        await client.delete(f"/api/projects/{pid}/contracts/Solo Rig")
    ).status_code == 204
    assert (await client.get(f"/api/projects/{pid}/contracts")).json() == []
    audit = (await client.get(f"/api/projects/{pid}/audit")).json()
    deleted = next(
        (e for e in audit if e["entity_type"] == "contract" and e["field"] == "contract_deleted"),
        None,
    )
    assert deleted is not None
    assert "ends 2027-03-31" in deleted["new_value"]

    # Same rule for HWU contracts.
    assert (
        await client.put(f"/api/projects/{pid}/hwu-contracts/HWU-1", json={})
    ).status_code == 422


# ── Contract endpoints must accept names containing "/" ──────────────────────
# The fleet is full of them ("HL27/Replacement", "T209/Replacement", "Rigless
# Clean/Well") — a plain path segment param can never match a slash, so every
# contract save/delete for those units 404'd until the routes used `:path`.


@pytest.mark.asyncio
async def test_contract_endpoints_accept_slash_names(client: AsyncClient) -> None:
    pid = await _project(client)
    await _activity(client, pid, rig="Rigless Clean/Well", location="LAND")

    r = await client.put(
        f"/api/projects/{pid}/contracts/Rigless Clean/Well",
        json={"contract_end": "2027-01-01"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["rig_name"] == "Rigless Clean/Well"

    r = await client.delete(f"/api/projects/{pid}/contracts/Rigless Clean/Well")
    assert r.status_code == 204, r.text
    assert (await client.get(f"/api/projects/{pid}/contracts")).json() == []


@pytest.mark.asyncio
async def test_hwu_contract_endpoints_accept_slash_names(client: AsyncClient) -> None:
    pid = await _project(client)
    await _activity(client, pid, hwu="HL27/Replacement", location="LAND")

    r = await client.put(
        f"/api/projects/{pid}/hwu-contracts/HL27/Replacement",
        json={"contract_end": "2027-06-30"},
    )
    assert r.status_code == 200, r.text
    r = await client.delete(f"/api/projects/{pid}/hwu-contracts/HL27/Replacement")
    assert r.status_code == 204, r.text


@pytest.mark.asyncio
async def test_delete_contract_targets_the_named_terrain(client: AsyncClient) -> None:
    """With contracts on both terrain twins, a delete must say WHICH physical
    rig it means (409 bare) and remove only that one."""
    pid = await _project(client)
    await _activity(client, pid, rig="HL19", location="LAND")
    await _activity(client, pid, rig="HL19", location="SWAMP",
                    start="2026-03-01", end="2026-04-01")
    for terrain, end in (("LAND", "2027-01-01"), ("SWAMP", "2028-06-30")):
        r = await client.put(
            f"/api/projects/{pid}/contracts/HL19",
            json={"contract_end": end, "terrain": terrain},
        )
        assert r.status_code == 200, r.text

    r = await client.delete(f"/api/projects/{pid}/contracts/HL19")
    assert r.status_code == 409, r.text  # ambiguous — twins both carry contracts

    r = await client.delete(f"/api/projects/{pid}/contracts/HL19", params={"terrain": "LAND"})
    assert r.status_code == 204, r.text
    remaining = (await client.get(f"/api/projects/{pid}/contracts")).json()
    assert [(c["terrain"], c["contract_end"]) for c in remaining] == [("SWAMP", "2028-06-30")]


# ── Remove from fleet — spreadsheet artifacts that were never physical units ─


@pytest.mark.asyncio
async def test_remove_unit_blocked_until_lane_is_empty(client: AsyncClient) -> None:
    pid = await _project(client)
    act = await _activity(client, pid, rig="Rigless Clean/Well", location="LAND")
    unit = await _unit(client, pid, "Rigless Clean/Well")

    # Still referenced by an activity → refused, nothing orphaned.
    r = await client.delete(f"/api/projects/{pid}/resources/{unit['id']}")
    assert r.status_code == 409, r.text
    assert "activit" in r.json()["detail"].lower()

    # Lane emptied (the planner made the work resource-free / deleted it).
    await client.delete(f"/api/projects/{pid}/activities/{act['id']}")
    r = await client.delete(f"/api/projects/{pid}/resources/{unit['id']}")
    assert r.status_code == 204, r.text
    assert all(u["name"] != "Rigless Clean/Well" for u in await _resources(client, pid))

    # Governance trail records the removal.
    audit = (await client.get(f"/api/projects/{pid}/audit")).json()
    assert any(
        e["entity_type"] == "resource" and e["field"] == "resource_removed" for e in audit
    )


@pytest.mark.asyncio
async def test_remove_unit_blocked_while_contract_on_file(client: AsyncClient) -> None:
    pid = await _project(client)
    act = await _activity(client, pid, rig="Ghost Rig", location="LAND")
    await client.put(
        f"/api/projects/{pid}/contracts/Ghost Rig", json={"contract_end": "2027-01-01"}
    )
    await client.delete(f"/api/projects/{pid}/activities/{act['id']}")

    unit = await _unit(client, pid, "Ghost Rig")
    r = await client.delete(f"/api/projects/{pid}/resources/{unit['id']}")
    assert r.status_code == 409, r.text
    assert "contract" in r.json()["detail"].lower()

    # Contract removed explicitly (audited on its own) → the unit can go.
    await client.delete(f"/api/projects/{pid}/contracts/Ghost Rig")
    r = await client.delete(f"/api/projects/{pid}/resources/{unit['id']}")
    assert r.status_code == 204, r.text


@pytest.mark.asyncio
async def test_remove_unit_denied_for_non_planner(
    client: AsyncClient, other_client: AsyncClient
) -> None:
    pid = await _project(client)
    act = await _activity(client, pid, rig="Ghost Rig", location="LAND")
    await client.delete(f"/api/projects/{pid}/activities/{act['id']}")
    unit = await _unit(client, pid, "Ghost Rig")
    r = await other_client.delete(f"/api/projects/{pid}/resources/{unit['id']}")
    assert r.status_code == 403, r.text


# ── Convert (rig ↔ HWU) — the fix for HWUs imported through the Rig column ───


async def _unit(client: AsyncClient, pid: str, name: str, kind: str = "rig") -> dict:
    return next(
        u for u in await _resources(client, pid) if u["name"] == name and u["kind"] == kind
    )


@pytest.mark.asyncio
async def test_convert_rig_to_hwu_moves_lane_contract_and_identity(
    client: AsyncClient,
) -> None:
    pid = await _project(client)
    await _activity(client, pid, rig="HL19", location="LAND", well="W-1")
    r = await client.put(
        f"/api/projects/{pid}/contracts/HL19", json={"contract_end": "2027-01-01"}
    )
    assert r.status_code == 200, r.text

    unit = await _unit(client, pid, "HL19")
    r = await client.post(
        f"/api/projects/{pid}/resources/{unit['id']}/convert", json={"to": "hwu"}
    )
    assert r.status_code == 200, r.text
    assert r.json()["kind"] == "hwu"
    assert r.json()["terrain"] == ""  # mobile — never terrain-bound

    # The lane's activities moved; the location stays (it's the WELL's terrain).
    acts = (await client.get(f"/api/projects/{pid}/activities")).json()
    assert acts[0]["rig_name"] is None
    assert acts[0]["hwu_name"] == "HL19"
    assert acts[0]["location"] == "LAND"

    # The contract followed into the HWU table.
    assert (await client.get(f"/api/projects/{pid}/contracts")).json() == []
    hwu_contracts = (await client.get(f"/api/projects/{pid}/hwu-contracts")).json()
    assert [(c["hwu_name"], c["contract_end"]) for c in hwu_contracts] == [
        ("HL19", "2027-01-01")
    ]

    # Governance trail records the reclassification.
    audit = (await client.get(f"/api/projects/{pid}/audit")).json()
    entry = next(
        (e for e in audit if e["entity_type"] == "resource" and e["field"] == "resource_converted"),
        None,
    )
    assert entry is not None
    assert "HWU" in entry["new_value"]


@pytest.mark.asyncio
async def test_convert_merges_terrain_twins_and_surfaces_conflicts(
    client: AsyncClient,
) -> None:
    """Converting both terrain 'twins' of a misclassified HWU merges them into
    ONE mobile unit — and their overlapping work then reads as a real conflict
    (exactly what rig classification was hiding)."""
    pid = await _project(client)
    # Overlapping windows on the two terrains.
    await _activity(client, pid, rig="HL19", location="LAND", well="W-L",
                    start="2026-01-01", end="2026-03-01")
    await _activity(client, pid, rig="HL19", location="SWAMP", well="W-S",
                    start="2026-02-01", end="2026-04-01")
    assert (await client.get(f"/api/projects/{pid}/dashboard")).json()["rigs"]["conflicts"] == 0

    for terrain in ("LAND", "SWAMP"):
        unit = next(
            u for u in await _resources(client, pid)
            if u["kind"] == "rig" and u["terrain"] == terrain
        )
        r = await client.post(
            f"/api/projects/{pid}/resources/{unit['id']}/convert", json={"to": "hwu"}
        )
        assert r.status_code == 200, r.text

    rows = await _resources(client, pid)
    assert [(u["kind"], u["terrain"], u["name"]) for u in rows] == [("hwu", "", "HL19")]
    acts = (await client.get(f"/api/projects/{pid}/activities")).json()
    assert all(a["hwu_name"] == "HL19" and a["rig_name"] is None for a in acts)
    # The merged unit is double-booked across terrains — now visible.
    assert (await client.get(f"/api/projects/{pid}/dashboard")).json()["rigs"]["conflicts"] == 1


@pytest.mark.asyncio
async def test_convert_refuses_to_guess_between_differing_contracts(
    client: AsyncClient,
) -> None:
    pid = await _project(client)
    await _activity(client, pid, rig="HL19", location="LAND", well="W-L")
    await _activity(client, pid, rig="HL19", location="SWAMP", well="W-S",
                    start="2026-03-01", end="2026-04-01")
    for terrain, end in (("LAND", "2027-01-01"), ("SWAMP", "2028-06-30")):
        await client.put(
            f"/api/projects/{pid}/contracts/HL19",
            json={"contract_end": end, "terrain": terrain},
        )

    land = next(
        u for u in await _resources(client, pid) if u["kind"] == "rig" and u["terrain"] == "LAND"
    )
    r = await client.post(
        f"/api/projects/{pid}/resources/{land['id']}/convert", json={"to": "hwu"}
    )
    assert r.status_code == 200, r.text

    # The second twin carries a DIFFERENT contract end — the server must not guess.
    swamp = next(
        u for u in await _resources(client, pid) if u["kind"] == "rig" and u["terrain"] == "SWAMP"
    )
    r = await client.post(
        f"/api/projects/{pid}/resources/{swamp['id']}/convert", json={"to": "hwu"}
    )
    assert r.status_code == 409, r.text
    assert "contract" in r.json()["detail"].lower()


@pytest.mark.asyncio
async def test_convert_hwu_to_rig_needs_a_single_terrain(client: AsyncClient) -> None:
    pid = await _project(client)
    await _activity(client, pid, hwu="HWU-1", location="SWAMP", well="W-1")
    unit = await _unit(client, pid, "HWU-1", kind="hwu")
    r = await client.post(
        f"/api/projects/{pid}/resources/{unit['id']}/convert", json={"to": "rig"}
    )
    assert r.status_code == 200, r.text
    assert r.json()["kind"] == "rig"
    assert r.json()["terrain"] == "SWAMP"  # inherited from its activities
    acts = (await client.get(f"/api/projects/{pid}/activities")).json()
    assert acts[0]["rig_name"] == "HWU-1" and acts[0]["hwu_name"] is None

    # A unit whose work spans terrains cannot become a terrain-locked rig.
    await _activity(client, pid, hwu="HWU-2", location="LAND", well="W-2",
                    start="2026-03-01", end="2026-04-01")
    await _activity(client, pid, hwu="HWU-2", location="SWAMP", well="W-3",
                    start="2026-05-01", end="2026-06-01")
    unit2 = await _unit(client, pid, "HWU-2", kind="hwu")
    r = await client.post(
        f"/api/projects/{pid}/resources/{unit2['id']}/convert", json={"to": "rig"}
    )
    assert r.status_code == 409, r.text
    assert "terrain" in r.json()["detail"].lower()


@pytest.mark.asyncio
async def test_convert_denied_for_non_planner_and_locked_plan(
    client: AsyncClient, other_client: AsyncClient
) -> None:
    pid = await _project(client)
    await _activity(client, pid, rig="HL19", location="LAND")
    unit = await _unit(client, pid, "HL19")

    r = await other_client.post(
        f"/api/projects/{pid}/resources/{unit['id']}/convert", json={"to": "hwu"}
    )
    assert r.status_code == 403, r.text

    # A pending revision freezes the plan — conversion moves plan data.
    r = await client.post(f"/api/projects/{pid}/revisions", json={})
    assert r.status_code in (200, 201), r.text
    r = await client.post(
        f"/api/projects/{pid}/resources/{unit['id']}/convert", json={"to": "hwu"}
    )
    assert r.status_code == 423, r.text


@pytest.mark.asyncio
async def test_clone_copies_resource_registry(client: AsyncClient) -> None:
    """The clone carries the fleet: identity, capability class and the
    placeholder flag — otherwise next quarter's Fleet view starts empty."""
    pid = await _project(client)
    await _activity(client, pid, rig="10K Rig 1", location="SWAMP")
    rid = (await _resources(client, pid))[0]["id"]
    r = await client.patch(
        f"/api/projects/{pid}/resources/{rid}",
        json={"capability_class": "10K", "is_placeholder": False},
    )
    assert r.status_code == 200, r.text

    clone = await client.post(f"/api/projects/{pid}/clone", json={"name": "Q2"})
    assert clone.status_code == 201, clone.text
    rows = await _resources(client, clone.json()["id"])
    assert [
        (x["kind"], x["terrain"], x["name"], x["capability_class"], x["is_placeholder"])
        for x in rows
    ] == [("rig", "SWAMP", "10K Rig 1", "10K", False)]


# ── Contract identity matches the registry: trimmed, case-insensitive ─────────
# The registry treats "10k rig 1" and "10K Rig 1" as ONE physical unit; the
# contract endpoints must too, or one unit's contract splits into case-variant
# rows that dashboards double-count and renames trip over.


@pytest.mark.asyncio
async def test_contract_upsert_matches_names_case_insensitively(
    client: AsyncClient,
) -> None:
    pid = await _project(client)
    await _activity(client, pid, rig="10K Rig 1", location="LAND")

    r = await client.put(
        f"/api/projects/{pid}/contracts/10K Rig 1", json={"contract_end": "2030-01-01"}
    )
    assert r.status_code == 200, r.text
    # A casing variant of the same physical unit updates the SAME row.
    r = await client.put(
        f"/api/projects/{pid}/contracts/10k RIG 1", json={"contract_end": "2031-06-30"}
    )
    assert r.status_code == 200, r.text

    contracts = (await client.get(f"/api/projects/{pid}/contracts")).json()
    assert [(c["rig_name"], c["terrain"], c["contract_end"]) for c in contracts] == [
        ("10K Rig 1", "LAND", "2031-06-30")  # display keeps the first casing
    ]


@pytest.mark.asyncio
async def test_hwu_contract_upsert_matches_names_case_insensitively(
    client: AsyncClient,
) -> None:
    pid = await _project(client)
    await _activity(client, pid, hwu="HWU-1", location="SWAMP")

    r = await client.put(
        f"/api/projects/{pid}/hwu-contracts/HWU-1", json={"contract_end": "2030-01-01"}
    )
    assert r.status_code == 200, r.text
    r = await client.put(
        f"/api/projects/{pid}/hwu-contracts/hwu-1", json={"contract_end": "2031-06-30"}
    )
    assert r.status_code == 200, r.text

    contracts = (await client.get(f"/api/projects/{pid}/hwu-contracts")).json()
    assert [(c["hwu_name"], c["contract_end"]) for c in contracts] == [
        ("HWU-1", "2031-06-30")
    ]


@pytest.mark.asyncio
async def test_delete_clears_case_variant_duplicate_contracts(
    client: AsyncClient, db: AsyncSession
) -> None:
    """Legacy state: the old byte-for-byte upsert could split one physical
    unit's contract into case-variant rows. Writes through that state 409 with
    an actionable message; DELETE is the healing path — one audited sweep
    removes every variant."""
    pid = await _project(client)
    await _activity(client, pid, rig="HL19", location="LAND")
    db.add(RigContract(project_id=uuid.UUID(pid), rig_name="HL19", terrain="LAND",
                       contract_end=date(2027, 1, 1)))
    db.add(RigContract(project_id=uuid.UUID(pid), rig_name="hl19", terrain="LAND",
                       contract_end=date(2028, 1, 1)))
    await db.commit()

    r = await client.put(
        f"/api/projects/{pid}/contracts/HL19", json={"contract_end": "2030-01-01"}
    )
    assert r.status_code == 409, r.text
    assert "casing" in r.json()["detail"]

    assert (await client.delete(f"/api/projects/{pid}/contracts/HL19")).status_code == 204
    assert (await client.get(f"/api/projects/{pid}/contracts")).json() == []


@pytest.mark.asyncio
async def test_rename_refuses_case_variant_duplicate_contracts(
    client: AsyncClient, db: AsyncSession
) -> None:
    """Bulk-renaming case-variant duplicate contract rows would collapse them
    onto one name and trip the unique constraint mid-flight (a raw 500) —
    refuse with an actionable 409 and change nothing."""
    pid = await _project(client)
    await _activity(client, pid, rig="10K Rig 1", location="LAND")
    db.add(RigContract(project_id=uuid.UUID(pid), rig_name="10K Rig 1", terrain="LAND",
                       contract_end=date(2027, 1, 1)))
    db.add(RigContract(project_id=uuid.UUID(pid), rig_name="10k rig 1", terrain="LAND",
                       contract_end=date(2028, 1, 1)))
    await db.commit()
    rid = (await _resources(client, pid))[0]["id"]

    r = await client.post(
        f"/api/projects/{pid}/resources/{rid}/rename", json={"new_name": "T209"}
    )
    assert r.status_code == 409, r.text
    assert "casing" in r.json()["detail"]
    # Nothing was half-renamed.
    names = {c["rig_name"] for c in (await client.get(f"/api/projects/{pid}/contracts")).json()}
    assert names == {"10K Rig 1", "10k rig 1"}
    assert (await _resources(client, pid))[0]["name"] == "10K Rig 1"


@pytest.mark.asyncio
async def test_rename_refuses_target_with_contract_on_file(
    client: AsyncClient, db: AsyncSession
) -> None:
    """The registry clash check can't see a contract for a name with no
    activities (no registry row) — without a contract-level guard the rename
    would collide two rows on the unique constraint (a raw 500)."""
    pid = await _project(client)
    await _activity(client, pid, rig="10K Rig 3", location="LAND")
    r = await client.put(
        f"/api/projects/{pid}/contracts/10K Rig 3", json={"contract_end": "2027-01-01"}
    )
    assert r.status_code == 200, r.text
    # A contract already on file under the TARGET name, with no activities.
    db.add(RigContract(project_id=uuid.UUID(pid), rig_name="T209", terrain="LAND",
                       contract_end=date(2030, 1, 1)))
    await db.commit()
    rid = (await _resources(client, pid))[0]["id"]

    r = await client.post(
        f"/api/projects/{pid}/resources/{rid}/rename", json={"new_name": "T209"}
    )
    assert r.status_code == 409, r.text
    assert "contract" in r.json()["detail"].lower()


@pytest.mark.asyncio
async def test_upsert_adopts_legacy_unassigned_contract_row(
    client: AsyncClient, db: AsyncSession
) -> None:
    """A ""-terrain row (legacy/unassigned) describes the same physical unit —
    a save that resolves a real terrain upgrades that row in place instead of
    shadowing it with a second one."""
    pid = await _project(client)
    db.add(RigContract(project_id=uuid.UUID(pid), rig_name="HL27", terrain="",
                       contract_end=date(2027, 1, 1)))
    await db.commit()
    await _activity(client, pid, rig="HL27", location="SWAMP")

    r = await client.put(
        f"/api/projects/{pid}/contracts/HL27", json={"contract_end": "2029-12-31"}
    )
    assert r.status_code == 200, r.text
    contracts = (await client.get(f"/api/projects/{pid}/contracts")).json()
    assert [(c["rig_name"], c["terrain"], c["contract_end"]) for c in contracts] == [
        ("HL27", "SWAMP", "2029-12-31")
    ]


@pytest.mark.asyncio
async def test_delete_reaches_legacy_unassigned_contract_row(
    client: AsyncClient, db: AsyncSession
) -> None:
    pid = await _project(client)
    db.add(RigContract(project_id=uuid.UUID(pid), rig_name="HL27", terrain="",
                       contract_end=date(2027, 1, 1)))
    await db.commit()
    await _activity(client, pid, rig="HL27", location="SWAMP")

    # Terrain resolves to SWAMP; the row sits at "" — the fallback reaches it.
    assert (await client.delete(f"/api/projects/{pid}/contracts/HL27")).status_code == 204
    assert (await client.get(f"/api/projects/{pid}/contracts")).json() == []


@pytest.mark.asyncio
async def test_import_updates_contract_across_case_variants(client: AsyncClient) -> None:
    """A re-imported sheet whose rig casing drifted from an earlier save must
    update the SAME physical unit's contract row, not split it in two."""
    pid = await _project(client, "ImportCase")
    header = (
        "Location,Rig Name,HWU Name,Activity Type,Plan Type,Project,Well Name,"
        "Start Date,End Date,Rig Contract Expiry Date,HWU Contract Expiry Date,Risk,"
        "Readiness Check,Readiness Check Status,Comment"
    )

    def sheet(rig: str, expiry: str) -> bytes:
        row = (
            f"LAND,{rig},,Oil Development,In Plan (Firm),PX,W-L,"
            f"05/01/2026,15/03/2026,{expiry},,No Flood Risk,BUD,On track,"
        )
        return ("\n".join([header, row]) + "\n").encode()

    for rig, expiry in (("10K Rig 1", "31/12/2030"), ("10K RIG 1", "30/06/2031")):
        r = await client.post(
            f"/api/projects/{pid}/activities/import?replace=true",
            files={"file": ("schedule.csv", io.BytesIO(sheet(rig, expiry)), "text/csv")},
        )
        assert r.status_code == 200, r.text

    contracts = (await client.get(f"/api/projects/{pid}/contracts")).json()
    assert [(c["rig_name"], c["terrain"], c["contract_end"]) for c in contracts] == [
        ("10K Rig 1", "LAND", "2031-06-30")
    ]


def test_contract_resolution_matches_registry_identity() -> None:
    """The snapshot/dashboard contract maps are keyed by normalized identity —
    an activity typed "10k RIG 1" must resolve the contract saved as
    "10K Rig 1" (and fall back to a ""-terrain legacy row)."""
    from app.models.activity import Activity
    from app.services.readiness import resolve_activity_contract

    contract = RigContract(rig_name="10K Rig 1", terrain="LAND")
    a = Activity(rig_name="  10k RIG 1 ", location="LAND")
    assert resolve_activity_contract(a, {("10k rig 1", "LAND"): contract}, {}) is contract
    assert resolve_activity_contract(a, {("10k rig 1", ""): contract}, {}) is contract


# ── Plan lock covers snapshot-relevant registry attributes ─────────────────────


@pytest.mark.asyncio
async def test_placeholder_flip_blocked_while_plan_locked(client: AsyncClient) -> None:
    """is_placeholder is captured into every snapshot (resource_planned) and
    splits the approved record's fleet KPIs — plan data, frozen under a pending
    revision exactly like readiness and contracts. capability_class is fleet
    metadata outside the snapshot and stays editable under lock."""
    pid = await _project(client)
    await _activity(client, pid, rig="10K Rig 1", location="LAND")
    rid = (await _resources(client, pid))[0]["id"]

    r = await client.post(f"/api/projects/{pid}/revisions", json={})
    assert r.status_code in (200, 201), r.text

    r = await client.patch(
        f"/api/projects/{pid}/resources/{rid}", json={"is_placeholder": False}
    )
    assert r.status_code == 423, r.text

    r = await client.patch(
        f"/api/projects/{pid}/resources/{rid}", json={"capability_class": "10K"}
    )
    assert r.status_code == 200, r.text
    assert r.json()["is_placeholder"] is True  # untouched by the metadata edit
