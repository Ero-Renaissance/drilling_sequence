"""The one readiness rollup every figure uses (docs/readiness-framework-spec.md §3.7).

Pure tests pin the definition (severity, Complete / On track / Behind, ready,
rounding, snapshot targets); API tests pin that the Overview tiles, the
"starting soon, not ready" warning, the last-approved KPIs and the revision
compare % all read it.
"""
from datetime import date, timedelta

import pytest
from httpx import AsyncClient

from app.models.readiness import STATUS_SETS
from app.services.dashboard import compute_snapshot_kpis
from app.services.readiness_rollup import (
    pct,
    rollup,
    severity_of,
    snapshot_gate_targets,
    target_ready,
)
from app.services.revision_diff import diff_snapshots

TODAY = date.today()
SEVEN = ["FDP", "LLI", "LOC", "FE", "FID", "EIA", "BUD"]


def _gates(**statuses: str) -> dict[str, str]:
    """The seven gates, unset ones at their default (On Track)."""
    return {c: statuses.get(c, "On Track") for c in SEVEN}


# ── The definition (pure) ───────────────────────────────────────────────────


def test_worked_example_from_the_spec() -> None:
    # 3 Completed, 2 On Track, 1 Behind, 1 N/A → 6 counted.
    f = rollup([_gates(FDP="Completed", LLI="Completed", LOC="Completed", FID="Behind", BUD="N/A")])
    assert (f.counted, f.done, f.in_progress, f.behind) == (6, 3, 2, 1)
    assert f.complete_pct == 50  # the headline counts only what is done
    assert f.on_track_pct == 83  # Completed or On Track — nothing behind
    assert (f.ready, f.ready_of, f.targets) == (0, 1, 1)


def test_an_untouched_target_is_on_track_but_not_complete() -> None:
    f = rollup([_gates()])
    assert (f.complete_pct, f.on_track_pct, f.behind, f.ready) == (0, 100, 0, 0)


def test_all_na_target_is_left_out_of_the_ready_count() -> None:
    f = rollup([{c: "N/A" for c in SEVEN}, _gates(**{c: "Completed" for c in SEVEN})])
    assert (f.targets, f.ready, f.ready_of) == (2, 1, 1)
    assert f.complete_pct == 100
    assert rollup([{c: "N/A" for c in SEVEN}]).complete_pct is None  # "—", never 0%


def test_nothing_to_count_reads_none() -> None:
    f = rollup([])
    assert (f.complete_pct, f.on_track_pct, f.targets) == (None, None, 0)


def test_rollups_read_severity_not_status_text() -> None:
    # Equipment: Available is done, Pending on track, Not available behind.
    f = rollup([{"NEQ": "Available"}, {"NEQ": "Pending"}, {"NEQ": "Not available"}])
    assert (f.done, f.in_progress, f.behind, f.ready) == (1, 1, 1, 1)
    assert severity_of("Not Started") == "in_progress"  # a retired legacy status


def test_every_status_set_default_is_on_track() -> None:
    for spec in STATUS_SETS.values():
        assert spec["statuses"][spec["default"]] == "in_progress"
    assert STATUS_SETS["availability"]["default"] == "Pending"


def test_percentages_round_half_up() -> None:
    assert pct(1, 8) == 13  # 12.5 — Python's round() would give 12
    assert pct(5, 6) == 83
    assert pct(2, 3) == 67
    assert pct(0, 4) == 0
    assert pct(3, 0) is None


def test_target_ready_needs_a_counted_cell_all_done() -> None:
    assert target_ready({"FDP": "Completed", "BUD": "N/A"})
    assert not target_ready({"FDP": "Completed", "BUD": "On Track"})
    assert not target_ready({"BUD": "N/A"})
    assert not target_ready({})


def test_by_check_buckets_follow_severity() -> None:
    f = rollup([{"FDP": "Completed", "NEQ": "Pending"}, {"FDP": "N/A", "NEQ": "Not available"}], ["FDP", "NEQ"])
    assert f.by_check["FDP"] == {"completed": 1, "on_track": 0, "behind": 0, "na": 1}
    assert f.by_check["NEQ"] == {"completed": 0, "on_track": 1, "behind": 1, "na": 0}


# ── Frozen snapshots (pure) ─────────────────────────────────────────────────


def _snap(project: str | None, start: str = "2026-03-01", **extra) -> dict:
    return {
        "start_date": start,
        "end_date": start,
        "well_project": project,
        "completed_at": None,
        "readiness_required": True,
        "readiness": _gates(BUD="Completed"),
        **extra,
    }


def test_snapshot_targets_count_each_field_project_once() -> None:
    targets = snapshot_gate_targets([_snap("P1"), _snap("P1"), _snap("P2")], SEVEN)
    assert len(targets) == 2


def test_snapshot_targets_skip_what_carries_no_readiness() -> None:
    snapshot = [
        _snap("P1"),
        _snap(None),  # no field project → no project gates
        _snap(""),
        _snap("DONE", completed_at="2026-02-01T00:00:00Z"),
        _snap("OPT", readiness_required=False),
        _snap("LATE", start="2027-06-01"),
    ]
    assert len(snapshot_gate_targets(snapshot, SEVEN, date(2026, 12, 31))) == 1
    assert len(snapshot_gate_targets(snapshot, SEVEN)) == 2  # no window: LATE counts


def test_snapshot_too_old_for_well_project_reads_as_one_plan() -> None:
    legacy = {k: v for k, v in _snap(None).items() if k != "well_project"}
    assert snapshot_gate_targets([legacy, dict(legacy)], SEVEN) == [_gates(BUD="Completed")]


def test_snapshot_gate_missing_from_a_block_reads_on_track() -> None:
    [cells] = snapshot_gate_targets([_snap("P1", readiness={"FDP": "Completed"})], ["FDP", "NEW"])
    assert cells == {"FDP": "Completed", "NEW": "On Track"}


def test_snapshot_kpis_ignore_activities_without_a_field_project() -> None:
    start = (TODAY + timedelta(days=30)).isoformat()
    snapshot = [_snap("P1", start=start), _snap(None, start=start)]
    k = compute_snapshot_kpis(snapshot, TODAY, gate_codes=SEVEN)
    assert k.readiness_focus_count == 1  # no phantom "" project
    assert (k.readiness_pct, k.readiness_on_track_pct) == (14, 100)  # BUD done of 7
    assert (k.readiness_ready, k.readiness_ready_of, k.readiness_behind) == (0, 1, 0)


def test_compare_pct_counts_each_field_project_once() -> None:
    def act(aid: str, project: str, gates: dict[str, str]) -> dict:
        return {"id": aid, **_snap(project, readiness=gates), "activity_type": "Drilling"}

    done = {c: "Completed" for c in SEVEN}
    # P1 (done) has five activities, P2 (untouched) one: per activity this read
    # 5×7 done of 6×7 = 83%; per field project it is 7 of 14 = 50%.
    snapshot = [act(f"a{i}", "P1", done) for i in range(5)] + [act("b", "P2", _gates())]
    summary = diff_snapshots(snapshot, snapshot)["summary"]
    assert summary["base_readiness_pct"] == summary["target_readiness_pct"] == 50


# ── The Overview (API) ──────────────────────────────────────────────────────


async def _campaign(client: AsyncClient, name: str = "Rollup") -> str:
    return (await client.post("/api/projects", json={"name": name})).json()["id"]


async def _activity(
    client: AsyncClient, pid: str, project: str | None, well: str, start: date
) -> dict:
    r = await client.post(
        f"/api/projects/{pid}/activities",
        json={
            "activity_type": "Oil Development",
            "start_date": start.isoformat(),
            "end_date": (start + timedelta(days=10)).isoformat(),
            "rig_name": f"R-{well}",
            "well_name": well,
            "well_project": project,
            "location": "OFFSHORE",
            "plan_type": "Firm",
            "risk": "No Flood Risk",
        },
    )
    assert r.status_code == 201, r.text
    return r.json()


async def _gate(client: AsyncClient, pid: str, project: str, code: str, status: str) -> None:
    r = await client.put(
        f"/api/projects/{pid}/readiness/{code}",
        json={"well_project": project, "status": status},
    )
    assert r.status_code == 200, r.text


@pytest.mark.asyncio
async def test_overview_counts_unset_gates_as_on_track(client: AsyncClient) -> None:
    """The bug this rollup fixes: with only BUD set, the tile used to read 100%
    and "1/1 ready" while the Readiness tab showed 1/7."""
    pid = await _campaign(client)
    await _activity(client, pid, "P1", "W1", TODAY + timedelta(days=10))
    await _gate(client, pid, "P1", "BUD", "Completed")

    d = (await client.get(f"/api/projects/{pid}/dashboard")).json()
    rd = d["readiness"]
    assert (rd["overall_pct"], rd["on_track_pct"]) == (14, 100)
    assert (rd["ready"], rd["ready_of"], rd["behind_cells"], rd["focus_count"]) == (0, 1, 0, 1)
    # The warning agrees: the field project isn't ready.
    assert d["watchlist"]["near_term_not_ready"] == 1


@pytest.mark.asyncio
async def test_overview_ready_project_and_the_spec_example(client: AsyncClient) -> None:
    pid = await _campaign(client)
    await _activity(client, pid, "Ready", "W1", TODAY + timedelta(days=10))
    await _activity(client, pid, "Mixed", "W2", TODAY + timedelta(days=20))
    for code in SEVEN:
        await _gate(client, pid, "Ready", code, "N/A" if code == "BUD" else "Completed")
    for code, status in (("FDP", "Completed"), ("LLI", "Completed"), ("LOC", "Completed"),
                         ("FID", "Behind"), ("BUD", "N/A")):
        await _gate(client, pid, "Mixed", code, status)

    d = (await client.get(f"/api/projects/{pid}/dashboard")).json()
    rd = d["readiness"]
    # 6 + 3 done of 6 + 6 counted; on track: 6 + 5.
    assert (rd["overall_pct"], rd["on_track_pct"], rd["behind_cells"]) == (75, 92, 1)
    assert (rd["ready"], rd["ready_of"]) == (1, 2)
    fid = next(g for g in rd["by_gate"] if g["code"] == "FID")
    assert (fid["completed"], fid["behind"]) == (1, 1)
    assert d["watchlist"]["near_term_not_ready"] == 1  # only "Mixed"


@pytest.mark.asyncio
async def test_completed_and_opted_out_work_drops_out(client: AsyncClient) -> None:
    pid = await _campaign(client)
    done = await _activity(client, pid, "Done", "W1", TODAY + timedelta(days=5))
    await client.post(f"/api/projects/{pid}/activities/{done['id']}/complete")
    opt = await _activity(client, pid, "OptOut", "W2", TODAY + timedelta(days=5))
    r = await client.patch(
        f"/api/projects/{pid}/activities/{opt['id']}", json={"readiness_required": False}
    )
    assert r.status_code == 200, r.text

    d = (await client.get(f"/api/projects/{pid}/dashboard?readiness_horizon_months=0")).json()
    assert d["readiness"]["focus_count"] == 0
    assert d["readiness"]["overall_pct"] is None  # "—", never 0%
    assert d["watchlist"]["near_term_not_ready"] == 0


@pytest.mark.asyncio
async def test_no_field_project_is_never_not_ready(client: AsyncClient) -> None:
    """An activity with no field project carries no project gates (§3.7), so the
    warning doesn't flag it and no "" project enters the tile."""
    pid = await _campaign(client)
    await _activity(client, pid, None, "W1", TODAY + timedelta(days=10))
    d = (await client.get(f"/api/projects/{pid}/dashboard")).json()
    assert d["watchlist"]["near_term_not_ready"] == 0
    assert d["readiness"]["focus_count"] == 0
