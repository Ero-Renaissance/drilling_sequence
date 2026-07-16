"""Import of the schedule workbook.

The Schedule sheet is ONE ROW PER ACTIVITY; readiness is per FIELD-DEVELOPMENT
PROJECT and arrives on a separate "Readiness" sheet (one row per project, one
column per gate). Legacy files that repeated a well once per gate still
collapse to one activity — their retired gate columns are simply ignored.
Exercises the collapse, value mappings (plan type, day-first dates), per-project
readiness ingestion, rig/HWU contract capture, replace semantics, and rejection.
"""

import io

import pytest
from httpx import AsyncClient
from openpyxl import Workbook

LEGACY_HEADER = (
    "Location,Rig Name,HWU Name,Activity Type,Plan Type,Project,Well Name,"
    "Start Date,End Date,Rig Contract Expiry Date,HWU Contract Expiry Date,Risk,"
    "Readiness Check,Readiness Check Status,Comment"
)
SCHEDULE_HEADER = [
    "Location", "Rig Name", "HWU Name", "Activity Type", "Plan Type", "Project",
    "Well Name", "Start Date", "End Date", "Rig Contract Expiry Date",
    "HWU Contract Expiry Date", "Risk", "Comment",
]
GATES = ["FDP", "LLI", "LOC", "FE", "FID", "EIA", "BUD"]


async def _create_project(client: AsyncClient, name: str = "Schedule") -> dict:
    resp = await client.post("/api/projects", json={"name": name})
    assert resp.status_code == 201, resp.text
    return resp.json()


def _well_rows(*, well, project, atype, plan, risk, start, end, expiry="", statuses=None,
               rig="RIG_1", hwu="", hwu_expiry="", loc="LAND"):
    """LEGACY format: one well-activity expanded into its 7 readiness rows."""
    statuses = statuses or {}
    return [
        f"{loc},{rig},{hwu},{atype},{plan},{project},{well},{start},{end},"
        f"{expiry},{hwu_expiry},{risk},{g},{statuses.get(g, 'On track')},note"
        for g in GATES
    ]


def _long_csv(*row_groups) -> bytes:
    lines = [LEGACY_HEADER]
    for group in row_groups:
        lines.extend(group)
    return ("\n".join(lines) + "\n").encode()


def _activity_row(*, well, project, atype, plan, risk, start, end, expiry=None,
                  rig="RIG_1", hwu=None, hwu_expiry=None, loc="LAND", comment=None):
    """NEW format: one Schedule-sheet row per activity."""
    return [loc, rig, hwu, atype, plan, project, well, start, end, expiry, hwu_expiry,
            risk, comment]


def _xlsx(schedule_rows: list[list], readiness_rows: "list[list] | None" = None) -> bytes:
    """Build the two-sheet workbook the importer reads: Schedule (one row per
    activity) + optionally Readiness (one row per project × the 7 gates)."""
    wb = Workbook()
    ws = wb.active
    ws.title = "Schedule"
    ws.append(SCHEDULE_HEADER)
    for row in schedule_rows:
        ws.append(row)
    if readiness_rows is not None:
        rd = wb.create_sheet("Readiness")
        rd.append(["Project", *GATES])
        for row in readiness_rows:
            rd.append(row)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


async def _upload(client: AsyncClient, project_id: str, content: bytes,
                  replace: bool = True, filename: str = "schedule.csv"):
    return await client.post(
        f"/api/projects/{project_id}/activities/import?replace={str(replace).lower()}",
        files={"file": (filename, io.BytesIO(content), "application/octet-stream")},
    )


@pytest.mark.asyncio
async def test_legacy_per_gate_rows_still_collapse(client: AsyncClient) -> None:
    """A legacy file repeating each well once per readiness gate collapses to one
    activity per well; its retired per-row gate values are ignored (readiness is
    per project now and comes from the Readiness sheet, which a CSV can't carry)."""
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
    assert by_well["WELL_A"]["start_date"] == "2026-01-05"   # 05/01/2026 read day-first
    assert by_well["WELL_B"]["plan_type"] == "Option"

    # Readiness view: one entry per field project, gates at their default.
    readiness = (await client.get(f"/api/projects/{pid}/readiness")).json()
    assert [(r["well_project"], r["activity_count"]) for r in readiness] == [
        ("PROJECT_X", 1), ("PROJECT_Y", 1),
    ]
    assert all(
        c["status"] == "On Track" for r in readiness for c in r["checks"].values()
    )

    # Rig contract upserted with its expiry (a contract IS its end date).
    contracts = (await client.get(f"/api/projects/{pid}/contracts")).json()
    rig1 = next(c for c in contracts if c["rig_name"] == "RIG_1")
    assert rig1["contract_end"] == "2030-12-31"


@pytest.mark.asyncio
async def test_readiness_sheet_imports_per_project(client: AsyncClient) -> None:
    """The Readiness sheet (one row per project × gates) sets each project's
    shared gates; rows for projects with no imported activity are ignored."""
    pid = (await _create_project(client))["id"]
    content = _xlsx(
        [
            _activity_row(well="W-1", project="Bonga Phase 3", atype="Gas Development",
                          plan="In Plan (Firm)", risk="No Flood Risk",
                          start="05/01/2026", end="15/07/2026", expiry="31/12/2030"),
            _activity_row(well="W-2", project="Egina North", atype="Oil Development",
                          plan="In Plan (Option)", risk="Flood Risk",
                          start="01/02/2026", end="01/08/2026", rig="RIG_2"),
        ],
        readiness_rows=[
            ["Bonga Phase 3", "Completed", "On track", "Behind", "On Track",
             "Behind Schedule", "N/A", "Completed"],
            ["Egina North"] + ["On Track"] * 7,
            ["Ghost Project"] + ["Completed"] * 7,  # no activities → ignored
        ],
    )
    resp = await _upload(client, pid, content, filename="schedule.xlsx")
    assert resp.status_code == 200, resp.text
    assert resp.json()["imported"] == 2

    readiness = (await client.get(f"/api/projects/{pid}/readiness")).json()
    by_project = {r["well_project"]: r["checks"] for r in readiness}
    assert set(by_project) == {"Bonga Phase 3", "Egina North"}  # Ghost ignored
    bonga = by_project["Bonga Phase 3"]
    assert bonga["FDP"]["status"] == "Completed"
    assert bonga["LLI"]["status"] == "On Track"        # "On track" mapped
    assert bonga["LOC"]["status"] == "Behind"
    assert bonga["FID"]["status"] == "Behind"          # "Behind Schedule" mapped
    assert bonga["EIA"]["status"] == "N/A"
    assert all(c["status"] == "On Track" for c in by_project["Egina North"].values())


@pytest.mark.asyncio
async def test_long_schedule_imports_hwu_contract(client: AsyncClient) -> None:
    pid = (await _create_project(client))["id"]
    content = _xlsx([
        _activity_row(well="WELL_R", project="PX", atype="Gas Development",
                      plan="In Plan (Firm)", risk="No Flood Risk",
                      start="05/01/2026", end="30/06/2026", expiry="31/12/2030"),
        _activity_row(well="WELL_H", project="PX", atype="Well Repair/Safety",
                      plan="In Plan (Firm)", risk="No Flood Risk",
                      start="01/03/2026", end="31/08/2026",
                      rig=None, hwu="HWU_9", hwu_expiry="30/06/2031"),
    ])
    resp = await _upload(client, pid, content, filename="schedule.xlsx")
    assert resp.status_code == 200, resp.text
    assert resp.json()["imported"] == 2

    acts = {a["well_name"]: a for a in (await client.get(f"/api/projects/{pid}/activities")).json()}
    assert acts["WELL_H"]["hwu_name"] == "HWU_9"
    assert acts["WELL_H"]["rig_name"] is None

    hwu_contracts = (await client.get(f"/api/projects/{pid}/hwu-contracts")).json()
    h9 = next(c for c in hwu_contracts if c["hwu_name"] == "HWU_9")
    assert h9["contract_end"] == "2031-06-30"
    rigs = (await client.get(f"/api/projects/{pid}/contracts")).json()
    assert any(c["rig_name"] == "RIG_1" for c in rigs)


@pytest.mark.asyncio
async def test_replace_resets_activities_and_project_readiness(client: AsyncClient) -> None:
    pid = (await _create_project(client))["id"]
    first = _xlsx(
        [_activity_row(well="WELL_A", project="P1", atype="Gas Development",
                       plan="In Plan (Firm)", risk="No Flood Risk",
                       start="05/01/2026", end="15/07/2026", expiry="31/12/2030")],
        readiness_rows=[["P1", "Completed", "Completed", "Completed", "Completed",
                         "Completed", "Completed", "Completed"]],
    )
    assert (await _upload(client, pid, first, filename="s.xlsx")).status_code == 200
    second = _xlsx(
        [_activity_row(well="WELL_C", project="P2", atype="Oil Development",
                       plan="In Plan (Option)", risk="Flood Risk",
                       start="01/03/2026", end="01/09/2026", expiry="31/12/2031")],
        readiness_rows=[["P2", "Behind", "On Track", "On Track", "On Track",
                         "On Track", "On Track", "On Track"]],
    )
    assert (await _upload(client, pid, second, replace=True, filename="s.xlsx")).status_code == 200

    acts = (await client.get(f"/api/projects/{pid}/activities")).json()
    assert [a["well_name"] for a in acts] == ["WELL_C"]      # WELL_A fully replaced
    readiness = (await client.get(f"/api/projects/{pid}/readiness")).json()
    assert [r["well_project"] for r in readiness] == ["P2"]  # P1 gates gone with it
    assert readiness[0]["checks"]["FDP"]["status"] == "Behind"


@pytest.mark.asyncio
async def test_invalid_readiness_status_drops_gate_with_warning(client: AsyncClient) -> None:
    pid = (await _create_project(client))["id"]
    content = _xlsx(
        [_activity_row(well="WELL_A", project="P", atype="Gas Development",
                       plan="In Plan (Firm)", risk="No Flood Risk",
                       start="05/01/2026", end="15/07/2026", expiry="31/12/2030")],
        readiness_rows=[["P", "On Track", "On Track", "On Track", "On Track",
                         "On Track", "On Track", "Frozen"]],  # BUD not mappable
    )
    resp = await _upload(client, pid, content, filename="s.xlsx")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["imported"] == 1
    assert any("BUD" in w for w in body["warnings"])
    checks = (await client.get(f"/api/projects/{pid}/readiness")).json()[0]["checks"]
    assert checks["BUD"]["status"] == "On Track"  # dropped gate falls back to default
    assert checks["FDP"]["status"] == "On Track"


@pytest.mark.asyncio
async def test_long_schedule_missing_required_column(client: AsyncClient) -> None:
    # Missing End Date: not the rich format (routes wide), and the wide validator
    # names the missing column.
    pid = (await _create_project(client))["id"]
    header = "Activity Type,Start Date,Well Name"
    body = (header + "\nGas Development,05/01/2026,W-1\n").encode()
    resp = await _upload(client, pid, body)
    assert resp.status_code == 422
    assert "End Date" in str(resp.json())


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
    assert "Start Date" in detail and "07/15/2026" in detail


@pytest.mark.asyncio
async def test_long_schedule_skips_invalid_well_imports_rest(client: AsyncClient) -> None:
    pid = (await _create_project(client))["id"]
    content = _xlsx([
        _activity_row(well="GOOD", project="P", atype="Gas Development",
                      plan="In Plan (Firm)", risk="No Flood Risk",
                      start="05/01/2026", end="15/07/2026", expiry="31/12/2030"),
        _activity_row(well="BADDATES", project="P", atype="Oil Development",
                      plan="In Plan (Option)", risk="Flood Risk",
                      start="15/07/2026", end="05/01/2026", expiry="31/12/2030"),  # end < start
    ])
    resp = await _upload(client, pid, content, filename="s.xlsx")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["imported"] == 1 and body["skipped"] == 1
    assert body["skipped_rows"][0]["well"] == "BADDATES"
