"""Tests for the revision comparison feature: diff engine + compare endpoint."""
import pytest
from httpx import AsyncClient

from app.services.revision_diff import diff_snapshots


def _act(aid: str, atype: str, start: str, end: str, **extra) -> dict:
    base = {
        "id": aid,
        "activity_type": atype,
        "start_date": start,
        "end_date": end,
        "well_name": None,
        "rig_name": None,
        "location": None,
        "plan_type": None,
        "risk": None,
        "comment": None,
        "readiness": {},
    }
    base.update(extra)
    return base


# ── Pure diff engine ────────────────────────────────────────────────────────


def test_diff_detects_added_removed_modified() -> None:
    base = [
        _act("a", "Drilling", "2026-01-01", "2026-01-31"),
        _act("b", "Casing", "2026-02-01", "2026-02-15"),
    ]
    target = [
        _act("a", "Drilling", "2026-01-01", "2026-02-10"),  # end moved
        _act("c", "Completion", "2026-03-01", "2026-03-20"),  # added
    ]  # b removed

    diff = diff_snapshots(base, target)
    s = diff["summary"]
    assert s["added"] == 1
    assert s["removed"] == 1
    assert s["modified"] == 1
    assert s["unchanged"] == 0

    by_change = {a["change"]: a for a in diff["activities"]}
    assert by_change["added"]["activity_id"] == "c"
    assert by_change["removed"]["activity_id"] == "b"
    mod = by_change["modified"]
    assert mod["activity_id"] == "a"
    assert any(f["field"] == "End date" and f["new"] == "2026-02-10" for f in mod["fields"])


def test_diff_unchanged_not_listed() -> None:
    base = [_act("a", "Drilling", "2026-01-01", "2026-01-31")]
    target = [_act("a", "Drilling", "2026-01-01", "2026-01-31")]
    diff = diff_snapshots(base, target)
    assert diff["summary"]["unchanged"] == 1
    assert diff["activities"] == []


# ── Rig-level contract diff ─────────────────────────────────────────────────


def _rig_act(aid: str, rig: str, status: str, end: str | None) -> dict:
    return _act(
        aid, "Drilling", "2026-01-01", "2026-01-31",
        rig_name=rig, rig_contract_status=status, rig_contract_end=end,
    )


def test_diff_reports_rig_contract_change() -> None:
    base = [_rig_act("a", "Rig Alpha", "Completed", "2026-06-30")]
    target = [_rig_act("a", "Rig Alpha", "In Progress", "2026-06-30")]
    diff = diff_snapshots(base, target)

    assert len(diff["contracts"]) == 1
    c = diff["contracts"][0]
    assert c["resource"] == "Rig Alpha"
    assert any(
        f["field"] == "Status" and f["old"] == "Completed" and f["new"] == "In Progress"
        for f in c["fields"]
    )
    # Contract changes are resource-level, never per-activity.
    assert all(
        f["field"] not in {"Status", "Contract start", "Contract end"}
        for a in diff["activities"]
        for f in a.get("fields", [])
    )


def _hwu_act(aid: str, hwu: str, status: str, end: str | None) -> dict:
    return _act(
        aid, "Workover", "2026-01-01", "2026-01-31",
        rig_name=None, hwu_name=hwu, rig_contract_status=status, rig_contract_end=end,
    )


def test_diff_reports_hwu_contract_change() -> None:
    # The HWU contract is captured generically (rig_contract_* keys); the diff
    # groups it under the HWU resource, tagged "HWU · <name>".
    base = [_hwu_act("h", "Unit-9", "Completed", "2026-06-30")]
    target = [_hwu_act("h", "Unit-9", "In Progress", "2026-06-30")]
    diff = diff_snapshots(base, target)

    assert len(diff["contracts"]) == 1
    c = diff["contracts"][0]
    assert c["resource"] == "HWU · Unit-9"
    assert any(
        f["field"] == "Status" and f["old"] == "Completed" and f["new"] == "In Progress"
        for f in c["fields"]
    )


def test_diff_dedupes_contract_to_rig_level() -> None:
    base = [
        _rig_act("a", "Rig Alpha", "Completed", "2026-06-30"),
        _rig_act("b", "Rig Alpha", "Completed", "2026-06-30"),
    ]
    target = [
        _rig_act("a", "Rig Alpha", "Completed", "2026-04-30"),
        _rig_act("b", "Rig Alpha", "Completed", "2026-04-30"),
    ]
    diff = diff_snapshots(base, target)
    assert len(diff["contracts"]) == 1  # one rig, not two activities
    assert any(f["field"] == "Contract end" for f in diff["contracts"][0]["fields"])


def test_diff_skips_contracts_when_a_side_predates_capture() -> None:
    base = [_act("a", "Drilling", "2026-01-01", "2026-01-31", rig_name="Rig Alpha")]
    target = [_rig_act("a", "Rig Alpha", "Completed", None)]
    assert diff_snapshots(base, target)["contracts"] == []


def test_diff_no_contract_change_when_equal() -> None:
    base = [_rig_act("a", "Rig Alpha", "Completed", "2026-06-30")]
    target = [_rig_act("a", "Rig Alpha", "Completed", "2026-06-30")]
    assert diff_snapshots(base, target)["contracts"] == []


def test_diff_readiness_change_reported() -> None:
    base = [_act("a", "Drilling", "2026-01-01", "2026-01-31", readiness={"BUD": "Not Started"})]
    target = [_act("a", "Drilling", "2026-01-01", "2026-01-31", readiness={"BUD": "Completed"})]
    diff = diff_snapshots(base, target)
    assert diff["summary"]["modified"] == 1
    fields = diff["activities"][0]["fields"]
    assert fields == [{"field": "Readiness: BUD", "old": "Not Started", "new": "Completed"}]


def test_diff_date_range_and_duration_shift() -> None:
    base = [_act("a", "Drilling", "2026-01-01", "2026-01-31")]
    target = [_act("a", "Drilling", "2026-01-01", "2026-02-12")]  # +12 days at end
    s = diff_snapshots(base, target)["summary"]
    assert s["base_start"] == "2026-01-01"
    assert s["target_end"] == "2026-02-12"
    assert s["start_shift_days"] == 0
    assert s["end_shift_days"] == 12
    assert s["duration_shift_days"] == 12


def test_diff_blank_equals_none() -> None:
    base = [_act("a", "Drilling", "2026-01-01", "2026-01-31", comment="")]
    target = [_act("a", "Drilling", "2026-01-01", "2026-01-31", comment=None)]
    diff = diff_snapshots(base, target)
    assert diff["summary"]["unchanged"] == 1


# ── Lineage matching (cross-project) ─────────────────────────────────────────


def test_lineage_match_treats_rig_change_as_modified() -> None:
    # Same lineage, rig reassigned to a different rig → one modified row, not add+remove.
    base = [_act("q1-1", "Drilling", "2026-01-01", "2026-01-31",
                 lineage_id="L1", well_name="W-1", rig_name="Rig A")]
    target = [_act("q2-9", "Drilling", "2026-04-01", "2026-04-30",
                   lineage_id="L1", well_name="W-1", rig_name="Rig B")]
    diff = diff_snapshots(base, target, match_by="lineage")
    s = diff["summary"]
    assert (s["added"], s["removed"], s["modified"]) == (0, 0, 1)
    fields = {f["field"]: (f["old"], f["new"]) for f in diff["activities"][0]["fields"]}
    assert fields["Rig"] == ("Rig A", "Rig B")


def test_lineage_falls_back_to_natural_key() -> None:
    # No shared lineage (unrelated schedules) → match on well + activity type.
    base = [_act("x", "Drilling", "2026-01-01", "2026-01-31",
                 lineage_id="A", well_name="W-1", rig_name="Rig A")]
    target = [_act("y", "Drilling", "2026-04-01", "2026-04-30",
                   lineage_id="B", well_name="W-1", rig_name="Rig A")]
    diff = diff_snapshots(base, target, match_by="lineage")
    assert diff["summary"]["modified"] == 1
    assert diff["summary"]["added"] == 0 and diff["summary"]["removed"] == 0


def test_lineage_dropped_activity_reads_as_removed() -> None:
    # A completed Q1 activity not carried into Q2 shows as removed.
    base = [
        _act("a", "Drilling", "2026-01-01", "2026-01-31", lineage_id="L1", well_name="W-1"),
        _act("b", "Casing", "2026-02-01", "2026-02-15", lineage_id="L2", well_name="W-2"),
    ]
    target = [_act("c", "Drilling", "2026-04-01", "2026-04-30", lineage_id="L1", well_name="W-1")]
    diff = diff_snapshots(base, target, match_by="lineage")
    by_change = {a["change"]: a for a in diff["activities"]}
    assert "removed" in by_change and by_change["removed"]["well_name"] == "W-2"


def test_removed_reason_distinguishes_completed_from_dropped() -> None:
    # Two activities leave the schedule: one was finished (completed_at set),
    # the other deleted while still open. The diff should label them apart.
    base = [
        _act("a", "Drilling", "2026-01-01", "2026-01-31", lineage_id="L1",
             well_name="W-done", completed_at="2026-01-30T00:00:00"),
        _act("b", "Casing", "2026-02-01", "2026-02-15", lineage_id="L2",
             well_name="W-cut"),
    ]
    target: list[dict] = []
    diff = diff_snapshots(base, target, match_by="lineage")
    by_well = {a["well_name"]: a for a in diff["activities"]}
    assert by_well["W-done"]["removal_reason"] == "completed"
    assert by_well["W-cut"]["removal_reason"] == "dropped"


def test_completion_of_surviving_activity_reads_as_modified() -> None:
    # An activity that stays in both schedules but got marked done shows as a
    # modified row (Open → Completed) carrying the completed flag — it must not
    # hide in "unchanged".
    base = [_act("a", "Drilling", "2026-01-01", "2026-01-31", lineage_id="L1", well_name="W-1")]
    target = [_act("a", "Drilling", "2026-01-01", "2026-01-31", lineage_id="L1",
                   well_name="W-1", completed_at="2026-01-25T00:00:00")]
    diff = diff_snapshots(base, target, match_by="lineage")
    assert diff["summary"]["modified"] == 1 and diff["summary"]["unchanged"] == 0
    row = diff["activities"][0]
    assert row["completed"] is True
    assert {"field": "Completion", "old": "Open", "new": "Completed"} in row["fields"]


# ── Compare endpoint ────────────────────────────────────────────────────────


async def _project_with_activity(client: AsyncClient, name: str = "Diff Project") -> tuple[str, str]:
    r = await client.post("/api/projects", json={"name": name})
    project_id = r.json()["id"]
    a = await client.post(
        f"/api/projects/{project_id}/activities",
        json={
            "activity_type": "Drilling",
            "start_date": "2026-01-01",
            "end_date": "2026-01-31",
            "well_name": "Well-1",
            "location": "OFFSHORE",
            "plan_type": "Firm",
            "risk": "No Flood Risk",
        },
    )
    return project_id, a.json()["id"]


@pytest.mark.asyncio
async def test_compare_two_revisions(
    client: AsyncClient, other_client: AsyncClient
) -> None:
    project_id, activity_id = await _project_with_activity(client)
    await client.post(f"/api/projects/{project_id}/approvers", json={"email": "other@company.com"})

    rev1 = (await client.post(f"/api/projects/{project_id}/revisions", json={})).json()
    # other@ signs to approve + unlock so the plan can be edited.
    await other_client.put(
        f"/api/projects/{project_id}/revisions/{rev1['id']}/sign",
        json={"role_label": "Approver"},
    )
    await client.patch(
        f"/api/projects/{project_id}/activities/{activity_id}",
        json={"end_date": "2026-02-15"},
    )
    rev2 = (await client.post(f"/api/projects/{project_id}/revisions", json={})).json()

    r = await client.get(
        f"/api/projects/{project_id}/revisions/compare",
        params={"base": rev1["id"], "target": rev2["id"]},
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["base"]["kind"] == "revision"
    assert data["base"]["rev_number"] == 1
    assert data["target"]["rev_number"] == 2
    assert data["summary"]["modified"] == 1
    assert data["summary"]["end_shift_days"] == 15


@pytest.mark.asyncio
async def test_compare_revision_vs_live(
    client: AsyncClient, other_client: AsyncClient
) -> None:
    project_id, activity_id = await _project_with_activity(client)
    await client.post(f"/api/projects/{project_id}/approvers", json={"email": "other@company.com"})
    rev1 = (await client.post(f"/api/projects/{project_id}/revisions", json={})).json()
    await other_client.put(
        f"/api/projects/{project_id}/revisions/{rev1['id']}/sign",
        json={"role_label": "Approver"},
    )
    # Edit the live plan after approval.
    await client.patch(
        f"/api/projects/{project_id}/activities/{activity_id}",
        json={"activity_type": "Sidetrack"},
    )

    r = await client.get(
        f"/api/projects/{project_id}/revisions/compare",
        params={"base": rev1["id"]},  # target defaults to "live"
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["target"]["kind"] == "live"
    assert data["summary"]["modified"] == 1
    assert any(
        f["field"] == "Activity type" and f["new"] == "Sidetrack"
        for f in data["activities"][0]["fields"]
    )


@pytest.mark.asyncio
async def test_compare_invalid_ref_returns_422(client: AsyncClient) -> None:
    project_id, _ = await _project_with_activity(client)
    r = await client.get(
        f"/api/projects/{project_id}/revisions/compare",
        params={"base": "not-a-uuid"},
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_compare_denied_for_non_member(
    client: AsyncClient, other_client: AsyncClient
) -> None:
    project_id, _ = await _project_with_activity(client)
    rev1 = (await client.post(f"/api/projects/{project_id}/revisions", json={})).json()
    r = await other_client.get(
        f"/api/projects/{project_id}/revisions/compare",
        params={"base": rev1["id"]},
    )
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_compare_surfaces_rig_contract_change(client: AsyncClient) -> None:
    """End-to-end: the snapshot captures rig contract state and the compare
    endpoint reports a rig-level contract change."""
    project = (await client.post("/api/projects", json={"name": "Contract Diff"})).json()
    pid = project["id"]
    await client.post(
        f"/api/projects/{pid}/activities",
        json={
            "activity_type": "Oil Well Drilling",
            "start_date": "2026-01-01",
            "end_date": "2026-02-01",
            "rig_name": "RigAlpha",
            "well_name": "Well-1",
            "location": "OFFSHORE",
            "plan_type": "Firm",
            "risk": "No Flood Risk",
        },
    )
    await client.put(f"/api/projects/{pid}/contracts/RigAlpha", json={"status": "Not Started"})

    rev1 = (await client.post(f"/api/projects/{pid}/revisions", json={})).json()
    # Discard to unlock, change the contract, then snapshot again.
    await client.delete(f"/api/projects/{pid}/revisions/{rev1['id']}")
    await client.put(f"/api/projects/{pid}/contracts/RigAlpha", json={"status": "In Progress"})
    rev2 = (await client.post(f"/api/projects/{pid}/revisions", json={})).json()

    diff = (
        await client.get(
            f"/api/projects/{pid}/revisions/compare?base={rev1['id']}&target={rev2['id']}"
        )
    ).json()
    assert len(diff["contracts"]) == 1
    contract = diff["contracts"][0]
    assert contract["resource"] == "RigAlpha"
    assert any(
        f["field"] == "Status" and f["new"] == "In Progress" for f in contract["fields"]
    )
