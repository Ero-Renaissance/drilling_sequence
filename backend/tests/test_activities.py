import io

import pytest
from httpx import AsyncClient

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _create_project(client: AsyncClient, name: str = "Test Project") -> dict:
    response = await client.post("/api/projects", json={"name": name})
    assert response.status_code == 201, response.text
    return response.json()


async def _create_activity(client: AsyncClient, project_id: str, **overrides) -> dict:
    payload = {
        "activity_type": "Oil Well Drilling",
        "start_date": "2026-01-01",
        "end_date": "2026-03-31",
        "well_name": "Well-A1",
        "rig_name": "Rig Alpha",
        "location": "OFFSHORE",
        **overrides,
    }
    response = await client.post(f"/api/projects/{project_id}/activities", json=payload)
    assert response.status_code == 201, response.text
    return response.json()


# ---------------------------------------------------------------------------
# Create
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_create_activity_minimal(client: AsyncClient) -> None:
    project = await _create_project(client)
    response = await client.post(
        f"/api/projects/{project['id']}/activities",
        json={"activity_type": "Oil Well Drilling", "start_date": "2026-01-01", "end_date": "2026-06-30"},
    )
    assert response.status_code == 201
    data = response.json()
    assert data["activity_type"] == "Oil Well Drilling"
    assert data["start_date"] == "2026-01-01"
    assert data["end_date"] == "2026-06-30"
    assert data["project_id"] == project["id"]


@pytest.mark.asyncio
async def test_create_activity_full(client: AsyncClient) -> None:
    project = await _create_project(client)
    activity = await _create_activity(
        client, project["id"],
        comment="Phase 1 drilling",
        plan_type="Firm",
        risk="Flood Risk",
    )
    assert activity["well_name"] == "Well-A1"
    assert activity["rig_name"] == "Rig Alpha"
    assert activity["location"] == "OFFSHORE"
    assert activity["plan_type"] == "Firm"
    assert activity["risk"] == "Flood Risk"


@pytest.mark.asyncio
async def test_create_activity_non_member_denied(
    client: AsyncClient, other_client: AsyncClient
) -> None:
    project = await _create_project(client)
    response = await other_client.post(
        f"/api/projects/{project['id']}/activities",
        json={"activity_type": "Gas Well Drilling", "start_date": "2026-01-01", "end_date": "2026-06-30"},
    )
    assert response.status_code == 403


# ---------------------------------------------------------------------------
# List
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_list_activities_empty(client: AsyncClient) -> None:
    project = await _create_project(client)
    response = await client.get(f"/api/projects/{project['id']}/activities")
    assert response.status_code == 200
    assert response.json() == []


@pytest.mark.asyncio
async def test_list_activities_returns_created(client: AsyncClient) -> None:
    project = await _create_project(client)
    await _create_activity(client, project["id"], well_name="Well-1")
    await _create_activity(client, project["id"], well_name="Well-2")
    response = await client.get(f"/api/projects/{project['id']}/activities")
    assert response.status_code == 200
    assert len(response.json()) == 2


@pytest.mark.asyncio
async def test_list_activities_non_member_denied(
    client: AsyncClient, other_client: AsyncClient
) -> None:
    project = await _create_project(client)
    response = await other_client.get(f"/api/projects/{project['id']}/activities")
    assert response.status_code == 403


# ---------------------------------------------------------------------------
# Update
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_update_activity(client: AsyncClient) -> None:
    project = await _create_project(client)
    activity = await _create_activity(client, project["id"])
    response = await client.patch(
        f"/api/projects/{project['id']}/activities/{activity['id']}",
        json={"well_name": "Updated Well", "plan_type": "Option"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["well_name"] == "Updated Well"
    assert data["plan_type"] == "Option"
    assert data["activity_type"] == "Oil Well Drilling"  # unchanged


@pytest.mark.asyncio
async def test_update_activity_not_found(client: AsyncClient) -> None:
    project = await _create_project(client)
    response = await client.patch(
        f"/api/projects/{project['id']}/activities/00000000-0000-0000-0000-000000000099",
        json={"well_name": "Ghost"},
    )
    assert response.status_code == 404


# ---------------------------------------------------------------------------
# Delete
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_delete_activity(client: AsyncClient) -> None:
    project = await _create_project(client)
    activity = await _create_activity(client, project["id"])
    response = await client.delete(
        f"/api/projects/{project['id']}/activities/{activity['id']}"
    )
    assert response.status_code == 204

    list_response = await client.get(f"/api/projects/{project['id']}/activities")
    assert list_response.json() == []


@pytest.mark.asyncio
async def test_delete_activity_not_found(client: AsyncClient) -> None:
    project = await _create_project(client)
    response = await client.delete(
        f"/api/projects/{project['id']}/activities/00000000-0000-0000-0000-000000000099"
    )
    assert response.status_code == 404


# ---------------------------------------------------------------------------
# CSV Import
# ---------------------------------------------------------------------------

CSV_VALID = (
    "Activity Type,Start Date,End Date,Well Name,Rig Name,Location\n"
    "Oil Well Drilling,2026-01-01,2026-03-31,Well-A1,Rig Alpha,OFFSHORE\n"
    "Gas Well Drilling,2026-04-01,2026-06-30,Well-B2,Rig Beta,LAND\n"
)

CSV_MISSING_COLS = "Activity Type,Well Name\nOil Well Drilling,Well-A1\n"


@pytest.mark.asyncio
async def test_import_csv(client: AsyncClient) -> None:
    project = await _create_project(client)
    response = await client.post(
        f"/api/projects/{project['id']}/activities/import",
        files={"file": ("activities.csv", io.BytesIO(CSV_VALID.encode()), "text/csv")},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["imported"] == 2
    assert data["replaced"] is True

    list_response = await client.get(f"/api/projects/{project['id']}/activities")
    assert len(list_response.json()) == 2


@pytest.mark.asyncio
async def test_import_csv_replaces_existing(client: AsyncClient) -> None:
    project = await _create_project(client)
    await _create_activity(client, project["id"], well_name="Old Well")

    response = await client.post(
        f"/api/projects/{project['id']}/activities/import",
        files={"file": ("activities.csv", io.BytesIO(CSV_VALID.encode()), "text/csv")},
        params={"replace": "true"},
    )
    assert response.status_code == 200
    assert response.json()["imported"] == 2

    list_response = await client.get(f"/api/projects/{project['id']}/activities")
    wells = {a["well_name"] for a in list_response.json()}
    assert "Old Well" not in wells


@pytest.mark.asyncio
async def test_import_csv_append_mode(client: AsyncClient) -> None:
    project = await _create_project(client)
    await _create_activity(client, project["id"], well_name="Existing Well")

    response = await client.post(
        f"/api/projects/{project['id']}/activities/import",
        files={"file": ("activities.csv", io.BytesIO(CSV_VALID.encode()), "text/csv")},
        params={"replace": "false"},
    )
    assert response.status_code == 200

    list_response = await client.get(f"/api/projects/{project['id']}/activities")
    assert len(list_response.json()) == 3  # 1 existing + 2 imported


@pytest.mark.asyncio
async def test_import_csv_missing_required_columns(client: AsyncClient) -> None:
    project = await _create_project(client)
    response = await client.post(
        f"/api/projects/{project['id']}/activities/import",
        files={"file": ("bad.csv", io.BytesIO(CSV_MISSING_COLS.encode()), "text/csv")},
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_import_csv_non_member_denied(
    client: AsyncClient, other_client: AsyncClient
) -> None:
    project = await _create_project(client)
    response = await other_client.post(
        f"/api/projects/{project['id']}/activities/import",
        files={"file": ("activities.csv", io.BytesIO(CSV_VALID.encode()), "text/csv")},
    )
    assert response.status_code == 403


# ---------------------------------------------------------------------------
# Domain enum enforcement (plan_type / risk / location / readiness codes)
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "field,value",
    [
        ("plan_type", "Speculative"),
        ("risk", "Critical"),
        ("location", "MARS"),
    ],
)
@pytest.mark.asyncio
async def test_create_activity_rejects_non_canonical_enum(
    client: AsyncClient, field: str, value: str
) -> None:
    project = await _create_project(client)
    response = await client.post(
        f"/api/projects/{project['id']}/activities",
        json={
            "activity_type": "Oil Well Drilling",
            "start_date": "2026-01-01",
            "end_date": "2026-02-01",
            field: value,
        },
    )
    assert response.status_code == 422, response.text


@pytest.mark.asyncio
async def test_update_activity_rejects_non_canonical_enum(client: AsyncClient) -> None:
    project = await _create_project(client)
    activity = await _create_activity(client, project["id"])
    response = await client.patch(
        f"/api/projects/{project['id']}/activities/{activity['id']}",
        json={"plan_type": "Whenever"},
    )
    assert response.status_code == 422, response.text


# ---------------------------------------------------------------------------
# CSV import validation (rows routed through ActivityCreate)
# ---------------------------------------------------------------------------

CSV_END_BEFORE_START = (
    "Activity Type,Start Date,End Date\n"
    "Oil Well Drilling,2026-03-01,2026-01-01\n"
)
CSV_BLANK_DATE = (
    "Activity Type,Start Date,End Date\n"
    "Oil Well Drilling,,2026-02-01\n"
)
CSV_BAD_PLAN_TYPE = (
    "Activity Type,Start Date,End Date,Plan Type\n"
    "Oil Well Drilling,2026-01-01,2026-02-01,Speculative\n"
)


@pytest.mark.parametrize(
    "csv_text", [CSV_END_BEFORE_START, CSV_BLANK_DATE, CSV_BAD_PLAN_TYPE]
)
@pytest.mark.asyncio
async def test_import_csv_rejects_invalid_rows(client: AsyncClient, csv_text: str) -> None:
    project = await _create_project(client)
    response = await client.post(
        f"/api/projects/{project['id']}/activities/import",
        files={"file": ("bad.csv", io.BytesIO(csv_text.encode()), "text/csv")},
    )
    assert response.status_code == 422, response.text
    # Nothing was inserted from a rejected import.
    listing = await client.get(f"/api/projects/{project['id']}/activities")
    assert listing.json() == []


@pytest.mark.asyncio
async def test_import_rejection_does_not_wipe_existing(client: AsyncClient) -> None:
    """A rejected replace-mode import must not delete the current schedule —
    validation happens before any write."""
    project = await _create_project(client)
    await _create_activity(client, project["id"], well_name="Keep Me")

    response = await client.post(
        f"/api/projects/{project['id']}/activities/import",
        files={"file": ("bad.csv", io.BytesIO(CSV_BLANK_DATE.encode()), "text/csv")},
        params={"replace": "true"},
    )
    assert response.status_code == 422

    listing = await client.get(f"/api/projects/{project['id']}/activities")
    wells = {a["well_name"] for a in listing.json()}
    assert "Keep Me" in wells
