"""Resource scheduling conflicts (rigs and HWUs).

A rig or an HWU is one physical asset and can't run two activities at once. Two
non-completed activities on the SAME resource whose dates overlap is therefore
physically impossible. This is enforced server-side (see create_revision) to
hard-block submitting such a plan for approval — the frontend warning alone
isn't trustworthy.

Resource identity is (kind, TERRAIN, name) — the planner convention: rig classes
are terrain-locked (a land rig can't float, a swamp barge can't drill on land,
a jack-up fits neither), and the fleet reuses class-style names per terrain, so
a LAND "10K Rig 1" and a SWAMP "10K Rig 1" are two different physical rigs.
Keying on name alone once produced 74 false conflicts on a real campaign.

A completed activity has already released the resource, so it's excluded.
"""
from app.models.activity import Activity


def _label(a: Activity) -> str:
    return a.well_name or a.activity_type


def _resource(a: Activity) -> tuple[str, str | None, str] | None:
    """The activity's resource lane as (kind, terrain, name), or None when it has
    neither a rig nor an HWU. Kind keeps a rig and an HWU that share a name apart;
    terrain keeps same-named units in different terrains apart (see module doc)."""
    if a.rig_name:
        return ("rig", a.location, a.rig_name)
    if a.hwu_name:
        return ("hwu", a.location, a.hwu_name)
    return None


def detect_resource_conflicts(activities: list[Activity]) -> list[dict]:
    """Same-resource date overlaps among non-completed activities, worst first.

    Each conflict: {resource, kind, terrain, a, b, overlap_days} — `resource` is
    the terrain-qualified lane label (e.g. "SWAMP – 10K Rig 1") so messages name
    the physical unit unambiguously.
    """
    by_resource: dict[tuple[str, str | None, str], list[Activity]] = {}
    for a in activities:
        if a.completed_at is not None:
            continue
        key = _resource(a)
        if key is None:
            continue
        by_resource.setdefault(key, []).append(a)

    conflicts: list[dict] = []
    for (kind, terrain, name), acts in by_resource.items():
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
                            "terrain": terrain,
                            "a": _label(a),
                            "b": _label(b),
                            "overlap_days": (overlap_end - overlap_start).days,
                        }
                    )
    conflicts.sort(key=lambda c: c["overlap_days"], reverse=True)
    return conflicts
