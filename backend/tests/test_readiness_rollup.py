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
        # No field project → no project gates. A per-field-project snapshot
        # stored only defaults for such an activity.
        _snap(None, readiness=_gates()),
        _snap("", readiness=_gates()),
        _snap("DONE", completed_at="2026-02-01T00:00:00Z"),
        _snap("OPT", readiness_required=False),
        _snap("LATE", start="2027-06-01"),
    ]
    assert len(snapshot_gate_targets(snapshot, SEVEN, date(2026, 12, 31))) == 1
    assert len(snapshot_gate_targets(snapshot, SEVEN)) == 2  # no window: LATE counts


def test_snapshot_too_old_for_well_project_reads_per_activity() -> None:
    """Before 2026-06-19 gates were PER ACTIVITY: every activity is its own target
    (not just the first one), as the old compare % read them."""
    legacy = {k: v for k, v in _snap(None).items() if k != "well_project"}
    other = {**legacy, "readiness": _gates(**{c: "Completed" for c in SEVEN})}
    targets = snapshot_gate_targets([legacy, other], SEVEN)
    assert targets == [_gates(BUD="Completed"), _gates(**{c: "Completed" for c in SEVEN})]
    # Compare %: 1 + 7 done of 14 — not 1 of 7 (first activity only).
    assert rollup(targets).complete_pct == 57


def test_snapshot_gate_missing_from_a_block_reads_on_track() -> None:
    [cells] = snapshot_gate_targets([_snap("P1", readiness={"FDP": "Completed"})], ["FDP", "NEW"])
    assert cells == {"FDP": "Completed", "NEW": "On Track"}


def test_snapshot_kpis_ignore_activities_without_a_field_project() -> None:
    start = (TODAY + timedelta(days=30)).isoformat()
    snapshot = [_snap("P1", start=start), _snap(None, start=start, readiness=_gates())]
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


# ── The Readiness tab rows carry the same rollup (step 2) ──────────────────


def _sum_rows(rows: list[dict], window_end: date | None) -> dict:
    """What the Readiness tab does: keep the rows in scope for the window, add
    their server-computed figures, divide (half up)."""
    shown = [
        r for r in rows
        if r["focus_in_days"] is not None
        and (window_end is None or r["focus_in_days"] <= (window_end - TODAY).days)
    ]
    figs = [r["figures"] for r in shown]
    counted = sum(f["counted"] for f in figs)
    done = sum(f["done"] for f in figs)
    return {
        "targets": len(shown),
        "complete": pct(done, counted),
        "on_track": pct(done + sum(f["in_progress"] for f in figs), counted),
        "behind": sum(f["behind"] for f in figs),
        "ready": sum(1 for f in figs if f["ready"]),
        "ready_of": sum(1 for f in figs if f["counted"]),
    }


@pytest.mark.asyncio
async def test_readiness_rows_carry_their_figures(client: AsyncClient) -> None:
    pid = await _campaign(client)
    await _activity(client, pid, "P1", "W1", TODAY + timedelta(days=10))
    done = await _activity(client, pid, "Finished", "W2", TODAY + timedelta(days=10))
    await client.post(f"/api/projects/{pid}/activities/{done['id']}/complete")
    await _gate(client, pid, "P1", "BUD", "Completed")
    await _gate(client, pid, "P1", "EIA", "N/A")

    rows = {r["well_project"]: r for r in (await client.get(f"/api/projects/{pid}/readiness")).json()}
    assert rows["P1"]["figures"] == {
        "counted": 6, "done": 1, "in_progress": 5, "behind": 0, "na": 1, "ready": False,
    }
    # The window signal comes on the server's calendar.
    assert rows["P1"]["focus_in_days"] == 10
    # Still listed (the chart and panels read gates from here), but with nothing
    # left to be ready for — the tab drops it.
    assert rows["Finished"]["focus_start"] is None
    assert rows["Finished"]["focus_in_days"] is None


@pytest.mark.asyncio
async def test_the_tab_adds_up_to_the_tile(client: AsyncClient) -> None:
    """The Readiness tab, adding up the rows it shows for a window, reads exactly
    what the Overview tile reads for that window."""
    pid = await _campaign(client)
    await _activity(client, pid, "Soon", "W1", TODAY + timedelta(days=20))
    await _activity(client, pid, "Later", "W2", TODAY + timedelta(days=500))
    await _activity(client, pid, "Overdue", "W3", TODAY - timedelta(days=30))
    await _activity(client, pid, None, "W4", TODAY + timedelta(days=5))
    for code in SEVEN:
        await _gate(client, pid, "Soon", code, "Completed")
    await _gate(client, pid, "Later", "FID", "Behind")
    await _gate(client, pid, "Overdue", "BUD", "N/A")

    rows = (await client.get(f"/api/projects/{pid}/readiness")).json()
    for months, window_end in ((12, TODAY + timedelta(days=365)), (0, None)):
        tile = (
            await client.get(f"/api/projects/{pid}/dashboard?readiness_horizon_months={months}")
        ).json()["readiness"]
        assert _sum_rows(rows, window_end) == {
            "targets": tile["focus_count"],
            "complete": tile["overall_pct"],
            "on_track": tile["on_track_pct"],
            "behind": tile["behind_cells"],
            "ready": tile["ready"],
            "ready_of": tile["ready_of"],
        }, months


def test_one_scope_rule_for_every_target() -> None:
    """carries_readiness / in_scope / focus_start_of are the single rule the tile,
    the tab rows and the team lens all use (spec §3.7)."""
    from types import SimpleNamespace

    from app.services.readiness_rollup import (
        carries_readiness,
        days_until,
        focus_start_of,
        in_scope,
    )

    def act(start: date, *, done: bool = False, required: bool = True) -> SimpleNamespace:
        return SimpleNamespace(
            start_date=start, completed_at="x" if done else None, readiness_required=required
        )

    soon, later = TODAY + timedelta(days=5), TODAY + timedelta(days=50)
    acts = [act(soon, done=True), act(later), act(TODAY, required=False)]
    assert [carries_readiness(a) for a in acts] == [False, True, False]
    assert focus_start_of(acts) == later  # completed and opted-out work don't count
    assert focus_start_of([act(soon, done=True)]) is None
    assert in_scope(acts[1], TODAY + timedelta(days=60)) and not in_scope(acts[1], soon)
    assert days_until(later, TODAY) == 50 and days_until(None, TODAY) is None



# ── Snapshots follow the same rules (step 3) ───────────────────────────────


@pytest.mark.asyncio
async def test_snapshot_records_no_gates_without_a_field_project(client: AsyncClient) -> None:
    import json

    pid = await _campaign(client)
    await _activity(client, pid, "P1", "W1", TODAY + timedelta(days=10))
    await _activity(client, pid, None, "W2", TODAY + timedelta(days=12))
    rev = await client.post(f"/api/projects/{pid}/revisions", json={})
    assert rev.status_code in (200, 201), rev.text
    detail = (await client.get(f"/api/projects/{pid}/revisions/{rev.json()['id']}")).json()
    by_well = {a["well_name"]: a for a in json.loads(detail["snapshot_json"])}
    assert list(by_well["W1"]["readiness"]) == SEVEN
    assert by_well["W2"]["readiness"] == {}  # no field project → no project gates


def test_compare_ignores_stored_defaults_for_activities_without_a_field_project() -> None:
    """Older snapshots stored default gates for an activity with no field project;
    newer ones store none. Comparing the two must not report gate changes."""
    old = {"id": "a", **_snap(None, readiness=_gates()), "activity_type": "Drilling"}
    new = {**old, "readiness": {}}
    diff = diff_snapshots([old], [new])
    assert diff["summary"]["modified"] == 0
    # Legacy per-activity snapshots (no well_project key) still compare their gates.
    legacy_old = {k: v for k, v in old.items() if k != "well_project"}
    legacy_new = {**legacy_old, "readiness": _gates(BUD="Completed")}
    fields = diff_snapshots([legacy_old], [legacy_new])["activities"][0]["fields"]
    assert fields == [{"field": "Readiness: BUD", "old": "On Track", "new": "Completed"}]


# ── Per-activity snapshots (before 2026-07-16; PR #21 review) ──────────────


def test_per_activity_snapshots_are_told_apart_by_their_shape() -> None:
    from app.services.readiness_rollup import per_activity_readiness

    project = [_snap("P1"), _snap("P1"), _snap(None, readiness=_gates())]  # one copy; defaults
    assert per_activity_readiness(project) is False
    assert per_activity_readiness([*project[:2], _snap(None, readiness={})]) is False  # phase 5
    # Two copies of P1 that disagree can only have been recorded per activity…
    mixed = [_snap("P1", readiness=_gates(BUD="Completed")), _snap("P1", readiness=_gates(BUD="Behind"))]
    assert per_activity_readiness(mixed) is True
    # …as can a real (non-default) gate on an activity with no field project,
    assert per_activity_readiness([_snap(None, readiness=_gates(FID="Behind"))]) is True
    # …or a snapshot from before well_project existed.
    assert per_activity_readiness([{k: v for k, v in _snap("P1").items() if k != "well_project"}])


def test_mixed_per_activity_gates_keep_their_recorded_aggregation() -> None:
    """Copilot's case: two legacy activities under P1, BUD Completed and Behind —
    50% whatever the order, not 100% (or 0%) from the first activity alone."""
    def act(aid: str, bud: str) -> dict:
        return {"id": aid, **_snap("P1", readiness={"BUD": bud}), "activity_type": "Drilling"}

    for snapshot in ([act("a", "Completed"), act("b", "Behind")], [act("b", "Behind"), act("a", "Completed")]):
        assert diff_snapshots(snapshot, snapshot)["summary"]["base_readiness_pct"] == 50
        k = compute_snapshot_kpis(snapshot, date(2026, 1, 1), gate_codes=["BUD"])
        assert (k.readiness_pct, k.readiness_focus_count, k.readiness_behind) == (50, 2, 1)


def test_per_activity_snapshot_still_diffs_gates_without_a_field_project() -> None:
    """In a per-activity snapshot an activity with no field project carried real
    gates — a change to them is a real change, not stored defaults to ignore."""
    base = [{"id": "a", **_snap(None, readiness={"FID": "Behind"}), "activity_type": "Drilling"}]
    target = [{**base[0], "readiness": {"FID": "Completed"}}]
    fields = diff_snapshots(base, target)["activities"][0]["fields"]
    assert fields == [{"field": "Readiness: FID", "old": "Behind", "new": "Completed"}]
