"""Import of the schedule workbook.

The Schedule sheet is ONE ROW PER ACTIVITY. Readiness is NOT part of the
upload — it is per-project state managed in the app, survives replace imports,
and a legacy workbook's "Readiness" tab is ignored. Legacy files that repeated
a well once per gate still collapse to one activity. Exercises the collapse,
value mappings (plan type, day-first dates), readiness persistence, rig/HWU
contract capture, replace semantics, and rejection.
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
    """Build the schedule workbook: Schedule (one row per activity) +
    optionally a LEGACY Readiness tab — the importer ignores it; tests pass it
    to prove exactly that."""
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
    per project now, managed in the app — never read from an upload)."""
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
async def test_legacy_readiness_tab_is_ignored(client: AsyncClient) -> None:
    """Readiness is managed in the app, not the upload: a legacy two-tab workbook
    still imports its Schedule, but the Readiness tab sets nothing — every gate
    stays at its default."""
    pid = (await _create_project(client))["id"]
    content = _xlsx(
        [
            _activity_row(well="W-1", project="Bonga Phase 3", atype="Gas Development",
                          plan="In Plan (Firm)", risk="No Flood Risk",
                          start="05/01/2026", end="15/07/2026", expiry="31/12/2030"),
        ],
        readiness_rows=[["Bonga Phase 3", "Behind", "Behind", "Behind", "Behind",
                         "Behind", "Behind", "Behind"]],
    )
    resp = await _upload(client, pid, content, filename="schedule.xlsx")
    assert resp.status_code == 200, resp.text
    assert resp.json()["imported"] == 1

    readiness = (await client.get(f"/api/projects/{pid}/readiness")).json()
    assert [r["well_project"] for r in readiness] == ["Bonga Phase 3"]
    assert all(c["status"] == "On Track" for c in readiness[0]["checks"].values())

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
async def test_replace_import_preserves_app_set_readiness(client: AsyncClient) -> None:
    """THE decoupling regression: gate statuses set in the app survive a replace
    import (they describe the field project, not the schedule rows). A project
    that drops out of the schedule stops being listed, and resurfaces with its
    statuses intact when the project returns."""
    pid = (await _create_project(client))["id"]
    first = _xlsx([
        _activity_row(well="W-1", project="P1", atype="Gas Development",
                      plan="In Plan (Firm)", risk="No Flood Risk",
                      start="05/01/2026", end="15/07/2026"),
    ])
    assert (await _upload(client, pid, first, filename="s.xlsx")).status_code == 200

    # Planner sets a gate in the app…
    put = await client.put(
        f"/api/projects/{pid}/readiness/P1/FID", json={"status": "Behind"}
    )
    assert put.status_code == 200, put.text

    # …then re-imports the schedule in replace mode (new well, same project).
    again = _xlsx([
        _activity_row(well="W-2", project="P1", atype="Oil Development",
                      plan="In Plan (Option)", risk="Flood Risk",
                      start="01/03/2026", end="01/09/2026"),
    ])
    assert (await _upload(client, pid, again, filename="s.xlsx")).status_code == 200
    readiness = (await client.get(f"/api/projects/{pid}/readiness")).json()
    assert readiness[0]["checks"]["FID"]["status"] == "Behind"  # survived

    # Replace with a DIFFERENT project: P1 unlisted (no orphan gates shown)…
    other = _xlsx([
        _activity_row(well="W-3", project="P2", atype="Gas Development",
                      plan="In Plan (Firm)", risk="No Flood Risk",
                      start="01/04/2026", end="01/10/2026"),
    ])
    assert (await _upload(client, pid, other, filename="s.xlsx")).status_code == 200
    listed = (await client.get(f"/api/projects/{pid}/readiness")).json()
    assert [r["well_project"] for r in listed] == ["P2"]

    # …and P1's statuses resurface intact when the project returns (append mode).
    back = _xlsx([
        _activity_row(well="W-1", project="P1", atype="Gas Development",
                      plan="In Plan (Firm)", risk="No Flood Risk",
                      start="05/01/2026", end="15/07/2026"),
    ])
    assert (await _upload(client, pid, back, replace=False,
                          filename="s.xlsx")).status_code == 200
    by_project = {
        r["well_project"]: r["checks"]
        for r in (await client.get(f"/api/projects/{pid}/readiness")).json()
    }
    assert by_project["P1"]["FID"]["status"] == "Behind"



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
