"""Compute a human-readable diff between two project snapshots.

Snapshots are lists of activity dicts produced by
`app.services.snapshot.build_project_snapshot` (and stored in
`Revision.snapshot_json`). Activities are matched by their stable `id`, so a
moved/renamed activity reads as "modified", not add+remove.
"""
from datetime import date

# Scalar activity fields compared field-for-field, with human labels.
_SCALAR_FIELDS: list[tuple[str, str]] = [
    ("activity_type", "Activity type"),
    ("start_date", "Start date"),
    ("end_date", "End date"),
    ("well_name", "Well"),
    ("rig_name", "Rig"),
    ("location", "Location"),
    ("plan_type", "Plan type"),
    ("risk", "Risk"),
    ("comment", "Comment"),
]


def _label(activity: dict) -> dict:
    return {
        "activity_id": activity.get("id", ""),
        "activity_type": activity.get("activity_type") or "",
        "well_name": activity.get("well_name"),
        "rig_name": activity.get("rig_name"),
        "start_date": activity.get("start_date"),
        "end_date": activity.get("end_date"),
    }


def _norm(value) -> str | None:
    """Normalise a scalar for comparison/display: treat blank as None."""
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _is_done(activity: dict) -> bool:
    return bool(_norm(activity.get("completed_at")))


def _field_changes(base: dict, target: dict) -> list[dict]:
    changes: list[dict] = []
    for key, label in _SCALAR_FIELDS:
        old, new = _norm(base.get(key)), _norm(target.get(key))
        if old != new:
            changes.append({"field": label, "old": old, "new": new})

    base_readiness = base.get("readiness") or {}
    target_readiness = target.get("readiness") or {}
    for code in sorted(set(base_readiness) | set(target_readiness)):
        old, new = _norm(base_readiness.get(code)), _norm(target_readiness.get(code))
        if old != new:
            changes.append({"field": f"Readiness: {code}", "old": old, "new": new})

    # An activity that's still in the schedule but got marked done (or reopened)
    # reads as a change, so it surfaces instead of hiding in "unchanged".
    if _is_done(base) != _is_done(target):
        changes.append({
            "field": "Completion",
            "old": "Completed" if _is_done(base) else "Open",
            "new": "Completed" if _is_done(target) else "Open",
        })
    return changes


def _parse(d: str | None) -> date | None:
    if not d:
        return None
    try:
        return date.fromisoformat(d[:10])
    except ValueError:
        return None


def _range(snapshot: list[dict]) -> tuple[date | None, date | None]:
    starts = [p for a in snapshot if (p := _parse(a.get("start_date")))]
    ends = [p for a in snapshot if (p := _parse(a.get("end_date")))]
    return (min(starts) if starts else None, max(ends) if ends else None)


def _days(a: date | None, b: date | None) -> int | None:
    if a is None or b is None:
        return None
    return (b - a).days


def _natural_key(a: dict) -> tuple[str | None, str | None]:
    """Identity for cross-project matching when no lineage link exists:
    a moved rig is the same activity, so rig is deliberately excluded."""
    return (_norm(a.get("well_name")), _norm(a.get("activity_type")))


def _match_pairs(
    base: list[dict], target: list[dict], match_by: str
) -> tuple[list[tuple[dict, dict]], list[dict], list[dict]]:
    """Pair base↔target activities. Returns (matched_pairs, added, removed),
    where matched_pairs preserves target order and removed preserves base order.

    - "id": match on the per-row id (within-project revision history).
    - "lineage": match on lineage_id (the same logical activity across clones),
      then fall back to natural key (well + activity type) for any leftovers, so
      two unrelated schedules still line up sensibly.
    """
    key = (lambda a: a.get("lineage_id") or a.get("id")) if match_by == "lineage" \
        else (lambda a: a.get("id"))

    base_pool: dict[object, list[dict]] = {}
    for b in base:
        base_pool.setdefault(key(b), []).append(b)

    matched: list[tuple[dict, dict]] = []
    used: set[int] = set()
    leftover_target: list[dict] = []
    for t in target:
        bucket = base_pool.get(key(t))
        if bucket:
            b = bucket.pop(0)
            matched.append((b, t))
            used.add(id(b))
        else:
            leftover_target.append(t)

    if match_by == "lineage":
        nat_pool: dict[object, list[dict]] = {}
        for b in base:
            if id(b) not in used:
                nat_pool.setdefault(_natural_key(b), []).append(b)
        still_added: list[dict] = []
        for t in leftover_target:
            bucket = nat_pool.get(_natural_key(t))
            if bucket:
                b = bucket.pop(0)
                matched.append((b, t))
                used.add(id(b))
            else:
                still_added.append(t)
        leftover_target = still_added

    removed = [b for b in base if id(b) not in used]
    return matched, leftover_target, removed


def diff_snapshots(
    base: list[dict], target: list[dict], match_by: str = "id"
) -> dict:
    """Return a layered diff: a headline summary plus per-activity changes
    (added / removed / modified with field-level old→new). `base` is the older
    side, `target` the newer one. `match_by` selects how rows are paired —
    "id" for revision history, "lineage" for cross-project (Q1 vs Q2)."""
    matched, added_acts, removed_acts = _match_pairs(base, target, match_by)

    activities: list[dict] = []
    added = removed = modified = unchanged = 0

    for base_act, act in matched:
        changes = _field_changes(base_act, act)
        if changes:
            modified += 1
            activities.append(
                {"change": "modified", **_label(act), "fields": changes,
                 "completed": _is_done(act)}
            )
        else:
            unchanged += 1

    for act in added_acts:
        added += 1
        activities.append(
            {"change": "added", **_label(act), "fields": [], "completed": _is_done(act)}
        )

    for act in removed_acts:
        removed += 1
        # A removed activity that carried a completion timestamp left because it
        # was finished (clone drops completed work); otherwise it was deleted.
        reason = "completed" if _norm(act.get("completed_at")) else "dropped"
        activities.append(
            {"change": "removed", **_label(act), "fields": [], "removal_reason": reason}
        )

    # Stable ordering: modified/changed first by start date, added, then removed.
    order = {"modified": 0, "added": 1, "removed": 2}
    activities.sort(key=lambda a: (order.get(a["change"], 9), a.get("start_date") or ""))

    base_start, base_end = _range(base)
    target_start, target_end = _range(target)

    def iso(d: date | None) -> str | None:
        return d.isoformat() if d else None

    base_duration = _days(base_start, base_end)
    target_duration = _days(target_start, target_end)
    duration_shift = (
        target_duration - base_duration
        if base_duration is not None and target_duration is not None
        else None
    )

    summary = {
        "added": added,
        "removed": removed,
        "modified": modified,
        "unchanged": unchanged,
        "base_start": iso(base_start),
        "base_end": iso(base_end),
        "target_start": iso(target_start),
        "target_end": iso(target_end),
        "start_shift_days": _days(base_start, target_start),
        "end_shift_days": _days(base_end, target_end),
        "base_duration_days": base_duration,
        "target_duration_days": target_duration,
        "duration_shift_days": duration_shift,
    }
    return {"summary": summary, "activities": activities}
