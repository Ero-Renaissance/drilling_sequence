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
    # New units auto-register as PLANNED slots; this rig is a real, procured one.
    unit = (await client.get(f"/api/projects/{pid}/resources")).json()[0]
    await client.patch(
        f"/api/projects/{pid}/resources/{unit['id']}", json={"is_placeholder": False}
    )
    # A contract that ends well out → not "at risk".
    await client.put(
        f"/api/projects/{pid}/contracts/R",
        json={"contract_end": (TODAY + timedelta(days=200)).isoformat()},
    )
    await client.post(
        f"/api/projects/{pid}/approvers", json={"email": "other@company.com", "role_label": "GM"}
    )
    rev = (await client.post(f"/api/projects/{pid}/revisions", json={})).json()
    signed = await other_client.put(
        f"/api/projects/{pid}/revisions/{rev['id']}/sign", json={"role_label": "GM", "attested": True}
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
    assert k["hwus_in_use"] == 0
    assert k["planned_rigs"] == 0  # the unit was marked procured before approval
    assert k["planned_hwus"] == 0
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
        json={"contract_end": (TODAY + timedelta(days=40)).isoformat()},
    )
    await client.post(
        f"/api/projects/{pid}/approvers", json={"email": "other@company.com", "role_label": "GM"}
    )
    rev = (await client.post(f"/api/projects/{pid}/revisions", json={})).json()
    await other_client.put(
        f"/api/projects/{pid}/revisions/{rev['id']}/sign", json={"role_label": "GM", "attested": True}
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
    """Visibility is org-wide: the home dashboard spans every active campaign,
    member or not."""
    await _approved_project(client, other_client)
    d = (await other_client.get("/api/me/last-approved-dashboard")).json()
    assert d["available"] is True


# ── compute_snapshot_kpis (pure) — fleet split semantics ─────────────────────


def _snap_act(**over) -> dict:
    return {
        "start_date": "2026-01-05",
        "end_date": "2026-02-05",
        "completed_at": None,
        **over,
    }


def test_snapshot_kpis_split_fleet_by_kind_and_planned() -> None:
    from datetime import date as _date

    from app.services.dashboard import compute_snapshot_kpis

    snapshot = [
        # Terrain twins are two physical rigs — one planned, one procured.
        _snap_act(rig_name="10K Rig 1", location="LAND", resource_planned=True),
        _snap_act(rig_name="10K Rig 1", location="SWAMP", resource_planned=False),
        # A procured HWU (mobile — no terrain in its identity).
        _snap_act(hwu_name="HL19", resource_planned=False),
        # Completed work no longer holds its unit "in use".
        _snap_act(rig_name="Done Rig", location="LAND", completed_at="2026-01-20T00:00:00Z"),
    ]
    k = compute_snapshot_kpis(snapshot, _date(2026, 1, 1))
    assert k.rigs_in_use == 1  # the SWAMP twin
    assert k.planned_rigs == 1  # the LAND twin
    assert k.hwus_in_use == 1
    assert k.planned_hwus == 0


def test_snapshot_kpis_legacy_snapshot_counts_everything_in_use() -> None:
    """Snapshots approved before the planned flag was captured lack the key —
    every unit reads as procured rather than guessing."""
    from datetime import date as _date

    from app.services.dashboard import compute_snapshot_kpis

    snapshot = [_snap_act(rig_name="R", location="LAND")]
    k = compute_snapshot_kpis(snapshot, _date(2026, 1, 1))
    assert k.rigs_in_use == 1
    assert k.planned_rigs == 0
