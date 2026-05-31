"""Rig scheduling conflicts.

A rig is one physical asset — it can relocate (land / swamp / offshore) over time
but can't run two activities at once. Two non-completed activities on the same rig
whose dates overlap is therefore physically impossible. This is enforced
server-side (see create_revision) to hard-block submitting such a plan for
approval — the frontend warning alone isn't trustworthy.

A completed activity has already released the rig, so it's excluded.
"""
from app.models.activity import Activity


def _label(a: Activity) -> str:
    return a.well_name or a.activity_type


def detect_rig_conflicts(activities: list[Activity]) -> list[dict]:
    """Same-rig date overlaps among non-completed activities, worst overlap first.

    Each conflict: {rig, a, b, overlap_days}.
    """
    by_rig: dict[str, list[Activity]] = {}
    for a in activities:
        if not a.rig_name or a.completed_at is not None:
            continue
        by_rig.setdefault(a.rig_name, []).append(a)

    conflicts: list[dict] = []
    for rig, acts in by_rig.items():
        for i in range(len(acts)):
            for j in range(i + 1, len(acts)):
                a, b = acts[i], acts[j]
                overlap_start = max(a.start_date, b.start_date)
                overlap_end = min(a.end_date, b.end_date)
                if overlap_end > overlap_start:
                    conflicts.append(
                        {
                            "rig": rig,
                            "a": _label(a),
                            "b": _label(b),
                            "overlap_days": (overlap_end - overlap_start).days,
                        }
                    )
    conflicts.sort(key=lambda c: c["overlap_days"], reverse=True)
    return conflicts
