"""Home dashboard: KPIs of the most-recently-approved sequence across the
caller's projects, computed from the approved revision's frozen snapshot."""
from datetime import date, timedelta

import pytest
from httpx import AsyncClient

TODAY = date.today()


async def _approved_project(
    client: AsyncClient, other_client: AsyncClient, name: str = "Home"
) -> tuple[str, dict]:
    """A project with one rig activity (BUD Completed, a covering contract) whose
    Rev 1 is approved by other@company.com. Returns (project_id, revision)."""
    pid = (await client.post("/api/projects", json={"name": name})).json()["id"]
    a = (
        await client.post(
            f"/api/projects/{pid}/activities",
            json={
                "activity_type": "Oil Development",
                "start_date": (TODAY + timedelta(days=10)).isoformat(),
                "end_date": (TODAY + timedelta(days=20)).isoformat(),
                "rig_name": "R",
                "well_name": "Well-1",
                "location": "OFFSHORE",
                "plan_type": "Firm",
                "risk": "No Flood Risk",
            },
        )
    ).json()
    await client.put(
        f"/api/projects/{pid}/activities/{a['id']}/readiness/BUD", json={"status": "Completed"}
    )
    # A Completed contract that ends well out → not "at risk".
    await client.put(
        f"/api/projects/{pid}/contracts/R",
        json={"status": "Completed", "contract_end": (TODAY + timedelta(days=200)).isoformat()},
    )
    await client.post(
        f"/api/projects/{pid}/approvers", json={"email": "other@company.com", "role_label": "GM"}
    )
    rev = (await client.post(f"/api/projects/{pid}/revisions", json={})).json()
    signed = await other_client.put(
        f"/api/projects/{pid}/revisions/{rev['id']}/sign", json={"role_label": "GM"}
    )
    assert signed.json()["status"] == "approved", signed.text
    return pid, rev


@pytest.mark.asyncio
async def test_unavailable_without_approval(client: AsyncClient) -> None:
    """A project with no approved revision → the home dashboard is unavailable."""
    await client.post("/api/projects", json={"name": "Draft only"})
    d = (await client.get("/api/me/last-approved-dashboard")).json()
    assert d["available"] is False
    assert d["kpis"] is None


@pytest.mark.asyncio
async def test_unavailable_with_no_projects(client: AsyncClient) -> None:
    d = (await client.get("/api/me/last-approved-dashboard")).json()
    assert d["available"] is False


@pytest.mark.asyncio
async def test_last_approved_kpis(client: AsyncClient, other_client: AsyncClient) -> None:
    pid, rev = await _approved_project(client, other_client)
    d = (await client.get("/api/me/last-approved-dashboard")).json()

    assert d["available"] is True
    assert d["project_id"] == pid
    assert d["rev_number"] == rev["rev_number"]
    assert d["approved_by"] == "Other User"  # the approver who signed it off
    assert d["approved_at"] is not None

    k = d["kpis"]
    assert k["activities_total"] == 1
    assert k["rigs_in_use"] == 1
    assert k["contracts_at_risk"] == 0  # contract ends +200d → healthy
    # The snapshot materialises all 7 gates (unset → On Track), so BUD Completed
    # out of 7 applicable = 14%.
    assert k["readiness_pct"] == 14
    by_gate = {g["code"]: g for g in k["by_gate"]}
    assert by_gate["BUD"]["completed"] == 1
    assert by_gate["LLI"]["on_track"] == 1


@pytest.mark.asyncio
async def test_contracts_at_risk_counted(client: AsyncClient, other_client: AsyncClient) -> None:
    """A contract expiring inside the 90-day window shows up as at-risk."""
    pid = (await client.post("/api/projects", json={"name": "Expiring"})).json()["id"]
    a = (
        await client.post(
            f"/api/projects/{pid}/activities",
            json={
                "activity_type": "Oil Development",
                "start_date": (TODAY + timedelta(days=5)).isoformat(),
                "end_date": (TODAY + timedelta(days=15)).isoformat(),
                "rig_name": "R",
                "well_name": "Well-1",
                "location": "OFFSHORE",
                "plan_type": "Firm",
                "risk": "No Flood Risk",
            },
        )
    ).json()
    assert a  # created
    await client.put(
        f"/api/projects/{pid}/contracts/R",
        json={"status": "Completed", "contract_end": (TODAY + timedelta(days=40)).isoformat()},
    )
    await client.post(
        f"/api/projects/{pid}/approvers", json={"email": "other@company.com", "role_label": "GM"}
    )
    rev = (await client.post(f"/api/projects/{pid}/revisions", json={})).json()
    await other_client.put(
        f"/api/projects/{pid}/revisions/{rev['id']}/sign", json={"role_label": "GM"}
    )

    d = (await client.get("/api/me/last-approved-dashboard")).json()
    assert d["kpis"]["contracts_at_risk"] == 1


@pytest.mark.asyncio
async def test_most_recently_approved_wins(
    client: AsyncClient, other_client: AsyncClient
) -> None:
    """With two approved projects, the one approved most recently is featured."""
    await _approved_project(client, other_client, "Older")
    pid2, _ = await _approved_project(client, other_client, "Newer")

    d = (await client.get("/api/me/last-approved-dashboard")).json()
    assert d["project_id"] == pid2  # signed off second → most recent


@pytest.mark.asyncio
async def test_membership_scoped(client: AsyncClient, other_client: AsyncClient) -> None:
    """other@ is a designated approver (by email) but not a project member, so the
    approval doesn't appear on their home dashboard."""
    await _approved_project(client, other_client)
    d = (await other_client.get("/api/me/last-approved-dashboard")).json()
    assert d["available"] is False
