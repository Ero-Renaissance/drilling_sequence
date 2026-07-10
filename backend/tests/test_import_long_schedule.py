"""Import of the long-format schedule upload (one row per readiness gate).

Exercises the collapse (rows → activities), the value mappings (plan type,
readiness status, day-first dates), readiness + rig-contract ingestion, replace
semantics, and validation rejection.
"""

import io

import pytest
from httpx import AsyncClient

LONG_HEADER = (
    "Location,Rig Name,HWU Name,Activity Type,Plan Type,Project,Well Name,"
    "Start Date,End Date,Rig Contract Expiry Date,HWU Contract Expiry Date,Risk,"
    "Readiness Check,Readiness Check Status,Comment"
)
GATES = ["FDP", "LLI", "LOC", "FE", "FID", "EIA", "BUD"]


async def _create_project(client: AsyncClient, name: str = "Schedule") -> dict:
    resp = await client.post("/api/projects", json={"name": name})
    assert resp.status_code == 201, resp.text
    return resp.json()


def _well_rows(*, well, project, atype, plan, risk, start, end, expiry="", statuses=None,
               rig="RIG_1", hwu="", hwu_expiry="", loc="LAND"):
    """One well-activity expanded into its 7 readiness rows (the long format)."""
    statuses = statuses or {}
    return [
        f"{loc},{rig},{hwu},{atype},{plan},{project},{well},{start},{end},"
        f"{expiry},{hwu_expiry},{risk},{g},{statuses.get(g, 'On track')},note"
        for g in GATES
    ]


def _long_csv(*row_groups) -> bytes:
    lines = [LONG_HEADER]
    for group in row_groups:
        lines.extend(group)
    return ("\n".join(lines) + "\n").encode()


async def _upload(client: AsyncClient, project_id: str, content: bytes, replace: bool = True):
    return await client.post(
        f"/api/projects/{project_id}/activities/import?replace={str(replace).lower()}",
        files={"file": ("schedule.csv", io.BytesIO(content), "text/csv")},
    )


@pytest.mark.asyncio
async def test_long_schedule_collapses_rows_and_maps_values(client: AsyncClient) -> None:
    pid = (await _create_project(client))["id"]
    csv = _long_csv(
        _well_rows(well="WELL_A", project="PROJECT_X", atype="Gas Development",
                   plan="In Plan (Firm)", risk="No Flood Risk",
                   start="05/01/2026", end="15/07/2026", expiry="31/12/2030"),
        _well_rows(well="WELL_B", project="PROJECT_Y", atype="Oil Development",
                   plan="In Plan (Option)", risk="Flood Risk",
                   start="01/02/2026", end="01/08/2026", expiry="31/12/2030",
                   statuses={"BUD": "Completed"}),
    )
    resp = await _upload(client, pid, csv)
    assert resp.status_code == 200, resp.text
    assert resp.json()["imported"] == 2  # 14 rows collapse into 2 well-activities

    acts = (await client.get(f"/api/projects/{pid}/activities")).json()
    assert len(acts) == 2
    by_well = {a["well_name"]: a for a in acts}
    assert by_well["WELL_A"]["well_project"] == "PROJECT_X"
    assert by_well["WELL_A"]["plan_type"] == "Firm"          # "In Plan (Firm)" mapped
    assert by_well["WELL_A"]["risk"] == "No Flood Risk"
    assert by_well["WELL_A"]["start_date"] == "2026-01-05"   # 05/01/2026 read day-first
    assert by_well["WELL_A"]["end_date"] == "2026-07-15"
    assert by_well["WELL_B"]["well_project"] == "PROJECT_Y"
    assert by_well["WELL_B"]["plan_type"] == "Option"

    # Readiness imported, with "On track" -> On Track (the collapsed canonical).
    readiness = (await client.get(f"/api/projects/{pid}/readiness")).json()
    checks = {r["well_name"]: r["checks"] for r in readiness}
    assert set(GATES) <= set(checks["WELL_A"])
    assert all(checks["WELL_A"][g]["status"] == "On Track" for g in GATES)
    assert checks["WELL_B"]["BUD"]["status"] == "Completed"
    assert checks["WELL_B"]["FDP"]["status"] == "On Track"

    # Rig contract upserted with its expiry (a contract IS its end date).
    contracts = (await client.get(f"/api/projects/{pid}/contracts")).json()
    rig1 = next(c for c in contracts if c["rig_name"] == "RIG_1")
    assert rig1["contract_end"] == "2030-12-31"


@pytest.mark.asyncio
async def test_long_schedule_imports_hwu_contract(client: AsyncClient) -> None:
    pid = (await _create_project(client))["id"]
    csv = _long_csv(
        _well_rows(well="WELL_R", project="PX", atype="Drilling",
                   plan="In Plan (Firm)", risk="No Flood Risk",
                   start="05/01/2026", end="30/06/2026", expiry="31/12/2030", rig="RIG_1"),
        _well_rows(well="WELL_H", project="PX", atype="Well Repair/Safety",
                   plan="In Plan (Firm)", risk="No Flood Risk",
                   start="01/03/2026", end="31/08/2026",
                   rig="", hwu="HWU_9", hwu_expiry="30/06/2031"),
    )
    resp = await _upload(client, pid, csv)
    assert resp.status_code == 200, resp.text
    assert resp.json()["imported"] == 2

    # The HWU activity carries its hwu_name and no rig.
    acts = {a["well_name"]: a for a in (await client.get(f"/api/projects/{pid}/activities")).json()}
    assert acts["WELL_H"]["hwu_name"] == "HWU_9"
    assert acts["WELL_H"]["rig_name"] is None

    # The HWU contract was upserted from its expiry column.
    hwu_contracts = (await client.get(f"/api/projects/{pid}/hwu-contracts")).json()
    h9 = next(c for c in hwu_contracts if c["hwu_name"] == "HWU_9")
    assert h9["contract_end"] == "2031-06-30"

    # The rig contract still imports alongside it.
    rigs = (await client.get(f"/api/projects/{pid}/contracts")).json()
    assert any(c["rig_name"] == "RIG_1" for c in rigs)


@pytest.mark.asyncio
async def test_long_schedule_replace_resets_activities_and_readiness(client: AsyncClient) -> None:
    pid = (await _create_project(client))["id"]
    first = _long_csv(_well_rows(well="WELL_A", project="P1", atype="Gas Development",
                                 plan="In Plan (Firm)", risk="No Flood Risk",
                                 start="05/01/2026", end="15/07/2026", expiry="31/12/2030"))
    assert (await _upload(client, pid, first)).status_code == 200
    second = _long_csv(_well_rows(well="WELL_C", project="P2", atype="Oil Development",
                                  plan="In Plan (Option)", risk="Flood Risk",
                                  start="01/03/2026", end="01/09/2026", expiry="31/12/2031"))
    assert (await _upload(client, pid, second, replace=True)).status_code == 200

    acts = (await client.get(f"/api/projects/{pid}/activities")).json()
    assert [a["well_name"] for a in acts] == ["WELL_C"]      # WELL_A fully replaced
    readiness = (await client.get(f"/api/projects/{pid}/readiness")).json()
    assert {r["well_name"] for r in readiness} == {"WELL_C"}  # no orphaned WELL_A readiness


@pytest.mark.asyncio
async def test_long_schedule_drops_invalid_readiness_cell(client: AsyncClient) -> None:
    # A non-canonical readiness status drops just that gate; the well still imports.
    pid = (await _create_project(client))["id"]
    csv = _long_csv(_well_rows(well="WELL_A", project="P", atype="Gas Development",
                               plan="In Plan (Firm)", risk="No Flood Risk",
                               start="05/01/2026", end="15/07/2026", expiry="31/12/2030",
                               statuses={"BUD": "Frozen"}))  # not mappable / not canonical
    resp = await _upload(client, pid, csv)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["imported"] == 1
    assert body["skipped"] == 0  # the well imported; only the gate dropped
    assert any("BUD" in w for w in body["warnings"])
    checks = (await client.get(f"/api/projects/{pid}/readiness")).json()[0]["checks"]
    assert checks["BUD"]["status"] == "On Track"  # dropped gate falls back to default
    assert checks["FDP"]["status"] == "On Track"


@pytest.mark.asyncio
async def test_long_schedule_skips_invalid_well_imports_rest(client: AsyncClient) -> None:
    pid = (await _create_project(client))["id"]
    csv = _long_csv(
        _well_rows(well="GOOD", project="P", atype="Gas Development",
                   plan="In Plan (Firm)", risk="No Flood Risk",
                   start="05/01/2026", end="15/07/2026", expiry="31/12/2030"),
        _well_rows(well="BADDATES", project="P", atype="Oil Development",
                   plan="In Plan (Option)", risk="Flood Risk",
                   start="15/07/2026", end="05/01/2026", expiry="31/12/2030"),  # end < start
    )
    resp = await _upload(client, pid, csv)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["imported"] == 1 and body["skipped"] == 1
    assert any(r["well"] == "BADDATES" for r in body["skipped_rows"])
    acts = (await client.get(f"/api/projects/{pid}/activities")).json()
    assert [a["well_name"] for a in acts] == ["GOOD"]


@pytest.mark.asyncio
async def test_long_schedule_replace_with_all_invalid_preserves_existing(client: AsyncClient) -> None:
    pid = (await _create_project(client))["id"]
    good = _long_csv(_well_rows(well="KEEP", project="P", atype="Gas Development",
                                plan="In Plan (Firm)", risk="No Flood Risk",
                                start="05/01/2026", end="15/07/2026", expiry="31/12/2030"))
    assert (await _upload(client, pid, good)).status_code == 200
    # Replace with an entirely-invalid file → must NOT wipe the existing schedule.
    all_bad = _long_csv(_well_rows(well="BAD", project="P", atype="Oil Development",
                                   plan="In Plan (Option)", risk="Flood Risk",
                                   start="15/07/2026", end="05/01/2026", expiry="31/12/2030"))
    resp = await _upload(client, pid, all_bad, replace=True)
    assert resp.status_code == 200, resp.text
    assert resp.json()["imported"] == 0 and resp.json()["skipped"] == 1
    acts = (await client.get(f"/api/projects/{pid}/activities")).json()
    assert [a["well_name"] for a in acts] == ["KEEP"]  # existing preserved, not wiped


@pytest.mark.asyncio
async def test_long_schedule_missing_required_column(client: AsyncClient) -> None:
    pid = (await _create_project(client))["id"]
    header = "Activity Type,Start Date,End Date,Readiness Check,Readiness Check Status"
    body = (header + "\nGas Development,05/01/2026,15/07/2026,BUD,On track\n").encode()
    resp = await _upload(client, pid, body)
    assert resp.status_code == 422
    assert "Well Name" in str(resp.json())


@pytest.mark.asyncio
async def test_long_schedule_rejects_wrong_date_format(client: AsyncClient) -> None:
    """A month-first date (07/15/2026 — month 15 isn't valid day-first) rejects the
    whole upload with a clear, actionable message, rather than being silently
    misread as a different day."""
    pid = (await _create_project(client))["id"]
    csv = _long_csv(_well_rows(well="WELL_A", project="P", atype="Gas Development",
                               plan="In Plan (Firm)", risk="No Flood Risk",
                               start="07/15/2026", end="31/07/2026", expiry="31/12/2030"))
    resp = await _upload(client, pid, csv)
    assert resp.status_code == 422, resp.text
    detail = str(resp.json())
    assert "Start Date" in detail and "DD/MM/YYYY" in detail
    # A rejected upload imports nothing.
    assert (await client.get(f"/api/projects/{pid}/activities")).json() == []


@pytest.mark.asyncio
async def test_long_schedule_warns_on_non_canonical_activity_type(client: AsyncClient) -> None:
    """An activity type outside the canonical catalogue imports fine (free-form
    field) but the response WARNS that it will chart in neutral grey — one
    warning per distinct type, none for canonical types."""
    pid = (await _create_project(client))["id"]
    csv = _long_csv(
        _well_rows(well="WELL_A", project="PX", atype="Gas Development",
                   plan="In Plan (Firm)", risk="No Flood Risk",
                   start="05/01/2026", end="15/07/2026"),
        _well_rows(well="WELL_B", project="PX", atype="Coiled Tubing Cleanout",
                   plan="In Plan (Firm)", risk="No Flood Risk",
                   start="01/08/2026", end="01/09/2026"),
        _well_rows(well="WELL_C", project="PX", atype="Coiled Tubing Cleanout",
                   plan="In Plan (Firm)", risk="No Flood Risk",
                   start="10/09/2026", end="10/10/2026"),
    )
    resp = await _upload(client, pid, csv)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["imported"] == 3  # the unknown type is imported, not blocked

    type_warnings = [w for w in body["warnings"] if "canonical catalogue" in w]
    assert len(type_warnings) == 1  # deduped: one warning per distinct type
    assert "Coiled Tubing Cleanout" in type_warnings[0]
    assert not any("Gas Development" in w for w in type_warnings)


@pytest.mark.asyncio
async def test_long_schedule_warns_when_a_rig_name_spans_terrains(client: AsyncClient) -> None:
    """Rig identity is (terrain, name): the same name in two terrains is two
    physical rigs, which is legal — but it can also hide a location typo, so
    the import WARNS (never blocks). A single-terrain rig draws no warning."""
    pid = (await _create_project(client))["id"]
    csv = _long_csv(
        _well_rows(well="W_LAND", project="PX", atype="Oil Development",
                   plan="In Plan (Firm)", risk="No Flood Risk",
                   start="05/01/2026", end="15/03/2026", rig="10K Rig 1", loc="LAND"),
        _well_rows(well="W_SWAMP", project="PX", atype="Oil Development",
                   plan="In Plan (Firm)", risk="Flood Risk",
                   start="20/01/2026", end="30/03/2026", rig="10K Rig 1", loc="SWAMP"),
        _well_rows(well="W_OTHER", project="PX", atype="Oil Development",
                   plan="In Plan (Firm)", risk="No Flood Risk",
                   start="01/04/2026", end="01/06/2026", rig="RIG_SOLO", loc="LAND"),
    )
    resp = await _upload(client, pid, csv)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["imported"] == 3  # cross-terrain overlap imports fine (two rigs)

    terrain_warnings = [w for w in body["warnings"] if "multiple terrains" in w]
    assert len(terrain_warnings) == 1
    assert "10K Rig 1" in terrain_warnings[0]
    assert "LAND" in terrain_warnings[0] and "SWAMP" in terrain_warnings[0]
    assert not any("RIG_SOLO" in w for w in terrain_warnings)
