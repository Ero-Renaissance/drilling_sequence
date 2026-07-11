"""Resource scheduling conflicts (rigs and HWUs).

A rig or an HWU is one physical asset and can't run two activities at once. Two
non-completed activities on the SAME resource whose dates overlap is therefore
physically impossible. This is enforced server-side (see create_revision) to
hard-block submitting such a plan for approval — the frontend warning alone
isn't trustworthy.

RIG identity is (kind, TERRAIN, name) — the planner convention: rig classes are
terrain-locked (a land rig can't float, a swamp barge can't drill on land, a
jack-up fits neither), and the fleet reuses class-style names per terrain, so a
LAND "10K Rig 1" and a SWAMP "10K Rig 1" are two different physical rigs.
Keying on name alone once produced 74 false conflicts on a real campaign.

HWU identity is (kind, name) WITHOUT terrain — HWUs are modular units that move
across terrains (spec decision Q1), so the same HWU name in LAND and SWAMP is
ONE unit and CAN double-book itself across terrains.

A completed activity has already released the resource, so it's excluded.
"""
from app.models.activity import Activity
from app.models.resource_registry import normalize_resource_name


def _label(a: Activity) -> str:
    return a.well_name or a.activity_type


def _resource(a: Activity) -> tuple[str, str, str] | None:
    """The activity's resource lane as (kind, terrain, name_key), or None when it
    has neither a rig nor an HWU. Kind keeps a rig and an HWU that share a name
    apart; terrain keeps same-named RIGS in different terrains apart and is ""
    for HWUs — they are mobile, one lane per name (see module doc).

    Keyed like the registry — name trimmed + case-folded, terrain stripped ("" =
    unset) — so casing/whitespace variants of ONE physical unit can never split
    into two lanes and hide a real double-booking from this check."""
    if a.rig_name:
        return ("rig", (a.location or "").strip(), normalize_resource_name(a.rig_name))
    if a.hwu_name:
        return ("hwu", "", normalize_resource_name(a.hwu_name))
    return None


def detect_resource_conflicts(activities: list[Activity]) -> list[dict]:
    """Same-resource date overlaps among non-completed activities, worst first.

    Each conflict: {resource, kind, terrain, a, b, overlap_days} — `resource` is
    the terrain-qualified lane label (e.g. "SWAMP – 10K Rig 1") so messages name
    the physical unit unambiguously; the display name keeps the first casing the
    schedule uses. `terrain` is None when the lane isn't terrain-bound.
    """
    by_resource: dict[tuple[str, str, str], list[Activity]] = {}
    for a in activities:
        if a.completed_at is not None:
            continue
        key = _resource(a)
        if key is None:
            continue
        by_resource.setdefault(key, []).append(a)

    conflicts: list[dict] = []
    for (kind, terrain, _name_key), acts in by_resource.items():
        name = ((acts[0].rig_name if kind == "rig" else acts[0].hwu_name) or "").strip()
        for i in range(len(acts)):
            for j in range(i + 1, len(acts)):
                a, b = acts[i], acts[j]
                overlap_start = max(a.start_date, b.start_date)
                overlap_end = min(a.end_date, b.end_date)
                if overlap_end > overlap_start:
                    conflicts.append(
                        {
                            "resource": f"{terrain} – {name}" if terrain else name,
                            "kind": kind,
                            "terrain": terrain or None,
                            "a": _label(a),
                            "b": _label(b),
                            "overlap_days": (overlap_end - overlap_start).days,
                        }
                    )
    conflicts.sort(key=lambda c: c["overlap_days"], reverse=True)
    return conflicts
