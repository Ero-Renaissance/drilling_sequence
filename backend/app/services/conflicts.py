"""Resource scheduling conflicts (rigs and HWUs).

A rig or an HWU is one physical asset — it can relocate (land / swamp / offshore)
over time but can't run two activities at once. Two non-completed activities on
the SAME resource whose dates overlap is therefore physically impossible. This is
enforced server-side (see create_revision) to hard-block submitting such a plan
for approval — the frontend warning alone isn't trustworthy.

A completed activity has already released the resource, so it's excluded.
"""
from app.models.activity import Activity


def _label(a: Activity) -> str:
    return a.well_name or a.activity_type


def _resource(a: Activity) -> tuple[str, str] | None:
    """The activity's resource as (kind, name) — ("rig", …) or ("hwu", …), or None
    when it has neither. Keyed by (kind, name) so a rig and an HWU that happen to
    share a name are never conflated."""
    if a.rig_name:
        return ("rig", a.rig_name)
    if a.hwu_name:
        return ("hwu", a.hwu_name)
    return None


def detect_resource_conflicts(activities: list[Activity]) -> list[dict]:
    """Same-resource date overlaps among non-completed activities, worst first.

    Each conflict: {resource, kind, a, b, overlap_days}.
    """
    by_resource: dict[tuple[str, str], list[Activity]] = {}
    for a in activities:
        if a.completed_at is not None:
            continue
        key = _resource(a)
        if key is None:
            continue
        by_resource.setdefault(key, []).append(a)

    conflicts: list[dict] = []
    for (kind, name), acts in by_resource.items():
        for i in range(len(acts)):
            for j in range(i + 1, len(acts)):
                a, b = acts[i], acts[j]
                overlap_start = max(a.start_date, b.start_date)
                overlap_end = min(a.end_date, b.end_date)
                if overlap_end > overlap_start:
                    conflicts.append(
                        {
                            "resource": name,
                            "kind": kind,
                            "a": _label(a),
                            "b": _label(b),
                            "overlap_days": (overlap_end - overlap_start).days,
                        }
                    )
    conflicts.sort(key=lambda c: c["overlap_days"], reverse=True)
    return conflicts
